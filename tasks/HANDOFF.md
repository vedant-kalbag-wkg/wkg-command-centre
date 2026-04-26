# Handoff — 2026-04-24

**Branch:** `fix/maturity-buckets-end-date`
**Session handed off at:** Phase 6 of 10 complete; Phase 7 next.
**Why handoff:** Token budget limit (~350k) reached; continuing in a fresh session.

---

## How to resume

1. Read this file end-to-end.
2. Read the two design + plan docs (authoritative — do not re-derive):
   - `docs/plans/2026-04-24-netsuite-etl-restructure-design.md`
   - `docs/plans/2026-04-24-netsuite-etl-restructure-plan.md`
3. Verify state with:
   ```bash
   git log --oneline 4db72c0..HEAD
   git status --short
   npx vitest run --project integration tests/etl/ tests/db/dimension-resolver.integration.test.ts
   npx vitest run --project unit src/lib/sales src/lib/csv
   npx tsc --noEmit 2>&1 | wc -l  # ~80 pre-existing errors expected, all in Phase 7/8/9 scope
   ```
4. Continue with Phase 7. The implementation plan (in `docs/plans/2026-04-24-netsuite-etl-restructure-plan.md`) has full code for each remaining task.

---

## What's been done (Phases 1–6)

### Phase 1 — Schema migration ✅
Commits: `bbed26c` + `853c1b6`
- `regions.code` made unique + NOT NULL; added nullable unique `azureCode` column (configurable Azure path → canonical region mapping).
- `locations`: dropped global-unique `outletCode`; added `primaryRegionId` FK + composite unique `(primaryRegionId, outletCode)`; dropped free-text `region` column.
- `products`: added `netsuiteCode` (unique nullable), `categoryCode`, `categoryName`.
- `salesRecords`: full rewrite. Dropped `grossAmount`, `quantity`, `discountCode`, `discountAmount`, `bookingFee`, `saleCommission`, and the natural unique on `(saleRef, transactionDate)`. Added `regionId` (NOT NULL FK), `vatAmount` (NOT NULL), `vatRate`, `isBookingFee` (NOT NULL), `netsuiteCode` (NOT NULL), `agent`, `businessDivision`, `categoryCode`, `categoryName`, `apiProductName`, `city`, `country`. `netAmount` now NOT NULL. Reindexed around `regionId`.
- Two new tables: `sales_blob_ingestions` (idempotency tracker), `product_code_fallbacks` (admin-editable map from CSV `Product Name` → synthetic `netsuiteCode` when the feed emits NULL `Code`).
- Migration `0018_restructure_salesrecords_region_scoped.sql` with:
  - Pre-schema safety gate: seeds canonical regions (UK/IE/DE/ES/CZ), backfills NULL `regions.code` from canonical names, raises if any unresolved; backfills `locations.primary_region_id` via temp `_loc_region_map` (memberships → `kiosks.regionGroup` → UK sentinel for archived locations) and raises if any active location is unresolvable; truncates `sales_records/import_stagings/sales_imports/commission_ledger` CASCADE.
  - Post-schema: populates `primary_region_id` then sets NOT NULL + composite unique; seeds `azureCode` defaults (UK→GB, IE→IE, DE→DE, ES→ES, CZ→CZ); drops `locations.region`; seeds `product_code_fallbacks` (Booking Fee → 9991, Cash Handling Fee → 9992); seeds `etl-system` user at id `00000000-0000-0000-0000-000000000001`; adds `sales_blob_ingestions_status_check`.
- Snapshot chain fix: repaired `0017_snapshot.json.prevId` from 0012's id to 0016's id (pre-existing drizzle-kit bug).

### Phase 2 — Parser rewrite ✅
Commits: `41c9b5b` + `91394d7`
- `src/lib/csv/sales-csv.ts` rewritten for 22-column NetSuite format.
- New signature: `parseSalesCsv(text, opts: { feeCodeFallbacks: Map<string, string> })`.
- New `ParsedSalesRow` with 23 fields including `isBookingFee`, `netsuiteCode` (required), `vatAmount` (signed), `vatRate`.
- `Date` column is authoritative (fixes the old `Din → transactionDate` bug).
- NULL sentinel (`"NULL"` string) treated as absent everywhere, including required identifier fields and currency.
- `parseDate` validates real calendar days (rejects 2026-02-31).
- Fee-code fallback: when `Code` is absent and `productName` matches a fallback entry, the parser assigns that code. Example: Booking Fee → 9991.
- 11 unit tests, all green.

### Phase 3 — Region-scoped dimension resolver ✅
Commits: `b63de0e` + `92b0f5f`
- `resolveDimensions(db, rows, { regionId })` — 3-arg signature.
- Outlet lookup scoped by `primary_region_id = regionId AND outlet_code IN (...)`. Same outlet code in different regions resolves to different locations.
- Product resolution: 3 passes — netsuiteCode match → name match with NULL netsuiteCode (back-fills the code + NULL category fields) → auto-create.
- Provider resolution: auto-creates by name.
- Pass 3 auto-create + provider auto-create batched via drizzle bulk insert.
- JSDoc documents concurrency precondition (caller must hold ETL advisory lock).
- 9 integration tests (Testcontainers), all green.

### Phase 4 — Azure Blob source ✅
Commit: `07b7522`
- Installed `@azure/storage-blob ^12.31.0`, `@azure/identity ^4.13.1` in dependencies.
- `src/lib/sales/azure-client.ts`: memoised `getAzureBlobClient()` factory. Three-branch auth: connection string → `AZURE_STORAGE_ACCOUNT_URL` + `DefaultAzureCredential` → throw.
- `src/lib/sales/azure-blob-source.ts`: `AzureBlobSource` class implementing `SalesDataSource`. Constructor takes injected `BlobServiceClient` for testability. `pull()` returns `{filename, sourceLabel, sourceHash, bytes, etag}` with quote-stripped etag.
- `resetAzureBlobClientCacheForTests` was exported as dead code; deleted in Phase 5 after Phase 4 review flagged it.
- 5 unit tests, all green.

### Phase 5 — ETL orchestrator ✅
Commits: `af92c61`, `0c8948c`, `9cc72f5`, `09731ad`
- `src/lib/sales/etl/advisory-lock.ts`: `pg_try_advisory_lock` wrapper with try/finally. Key: `738_294_105`.
- `src/app/(app)/settings/data-import/sales/pipeline.ts` extended:
  - `_stageImportForActor(source, actor, db, { regionId, feeCodeFallbacks })`.
  - `_commitImportForActor` reads `regionId` from the import row, propagates all new columns to `salesRecords` inserts.
  - All references to dropped columns removed.
- Migration `0019_sales_imports_region_id.sql`: additive `ADD COLUMN "region_id" uuid` (nullable) + FK to `regions.id` on `sales_imports`. Rationale: 0018 already truncated `sales_imports`, so no backfill needed; commit-time check enforces non-null before writing `salesRecords`.
- `src/lib/sales/etl/azure-etl.ts`: `runAzureEtl(db, { client? })` — acquires advisory lock, loads regions with `azureCode`, loads fallbacks, lists blobs under `{azureCode}/`, filters by path regex `^{azureCode}/YYYY/MM/DD/<file>.csv$`, skips already-processed blobs (`status='success'` in `sales_blob_ingestions`), pulls → stages → commits via existing helpers. On failure: upserts `sales_blob_ingestions` with `status='failed'` so a subsequent run can retry. Returns `{ status: "skipped-lock" }` or `{ status: "ok", processed, skipped, failed }`. `BlobServiceClient` is dependency-injectable for tests (defaults to `getAzureBlobClient()`).
- Server actions in `src/app/(app)/settings/data-import/sales/actions.ts` (stageImport/commitImport/cancelImport) stubbed to throw a clear deprecation error pointing at the Azure ETL — Phase 8 will delete them.
- Legacy `tests/db/sales-import-pipeline.integration.test.ts` has `@ts-nocheck` + `describe.skip` with a Phase 8 cleanup comment.
- 5 new integration tests (advisory lock: 3, azure-etl: 2), all green.

### Phase 6 — CLI + HTTP entry points ✅
Commit: `fab990d`
- `scripts/run-azure-etl.ts`: CLI with node-postgres Pool. Exit codes: 0 (ok), 1 (ok with failures), 2 (skipped-lock), non-zero on error.
- `npm run etl:azure` script added to `package.json`.
- `src/app/api/etl/azure/run/route.ts`: POST route. Auth via `x-etl-token` header OR `x-vercel-cron: 1` header. Gated by `ETL_AZURE_ENABLED === "true"` (returns 503 otherwise).
- Response codes: 200 (ok), 207 (ok with failures), 401 (unauthorized), 409 (skipped-lock), 503 (disabled).
- `vercel.json`: daily cron at `0 4 * * *` → `/api/etl/azure/run`. Preserved existing `$schema`/`framework`/`installCommand`/`buildCommand`.
- Drizzle client imported from `@/db` (canonical for this codebase — not `@/db/client` as the plan draft suggested).
- 7 unit tests, all green.

---

## Remaining work (Phases 7–10)

All phase details are in `docs/plans/2026-04-24-netsuite-etl-restructure-plan.md` with complete code.

### Phase 7 — Commission rewrite (Task 19)
- `src/lib/commission/processor.ts` currently uses `grossAmount`. Rewrite to `SUM(netAmount) WHERE isBookingFee = true`.
- Update tests to use the new dataset shape.
- ~80 TypeScript errors across `src/lib/analytics/queries/*` reference the dropped `grossAmount`/`quantity`/`saleRef` columns — many will clear up here, rest in Phase 8.
- **Expected tsc count after Phase 7:** should drop significantly (analytics queries are the bulk of the 80).
- **Context:** the commission model changed per Q-and-A: commission base = Net Amt on booking-fee rows, not gross on all rows.

### Phase 8 — UI removal + history view (Tasks 20–21)
- Delete `src/lib/sales/csv-file-source.ts` (CsvFileSource class — no longer used).
- Delete `src/app/(app)/settings/data-import/sales/sales-import-client.tsx` (upload form) and the deprecated server actions.
- Repurpose `src/app/(app)/settings/data-import/sales/page.tsx` as read-only history: recent `sales_blob_ingestions` joined with `salesImports`.
- Delete the skipped `tests/db/sales-import-pipeline.integration.test.ts`.
- Update `src/app/(app)/locations/actions.ts:313` and any other residual `locations.region` references (from Phase 1's deliberate compile-time-pressure break).

### Phase 9 — Fee fallback propagation helper (Task 22)
- `src/lib/sales/config/fee-fallbacks.ts`: `updateFeeCodeFallback(db, actor, productName, newCode)` in a single transaction:
  - Update `product_code_fallbacks` row.
  - Update matching `products.netsuiteCode`.
  - Update matching `salesRecords.netsuiteCode`.
  - Write audit log.
- Integration test covering: update propagates, second call with same new code is no-op, audit log entry present.

### Phase 10 — End-to-end validation (Tasks 23–25)
- `tests/etl/azure-etl-full.integration.test.ts`: load the real `WKG_NETSUITE_VK.csv` into a stub blob at `clientdata/GB/2026/01/01/sales.csv`; assert row counts, `isBookingFee=true` count (expect 1273 from the Jan 2026 sample), reversal-pair nets to zero for `refNo='2XA4558609'`, 1273 rows with `netsuiteCode='9991'` from the fallback.
- Playwright UAT: `tests/etl-history.spec.ts` (admin views ingestion history + failed-row errors). Optional: `tests/region-scoped-sales.spec.ts` if region-aware sales UI is reachable.
- Manual smoke checklist from the plan (build, tests, Azurite/staging run, auth paths, UI state).

---

## Known state / caveats

- **TypeScript tsc errors:** ~80 pre-existing errors, all scoped to Phase 7/8/9 territory (analytics queries, commission processor, old test fixtures, old sales-import UI). New Phase 1–6 code is 100% clean.
- **Vitest state:** all unit + integration tests for Phase 1–6 pass. Old integration tests that reference the retired schema (`sales-tables.integration.test.ts`, `locations-hotel-fields.integration.test.ts`, `scoped-query.integration.test.ts`) will still fail compile — Phase 8 cleanup.
- **Uncommitted working-tree files** (from BEFORE this session, NOT our work — do not touch):
  - `scripts/import-from-monday.ts`
  - `src/app/(app)/kiosks/actions.ts`
  - `src/components/kiosks/kiosk-detail-form.tsx`
- **Untracked files** (pre-existing): `WKG_NETSUITE_VK.csv`, `playwright-output/`, `playwright-report/`, `tasks/`, `temp.csv`.
- **Feature flag:** `ETL_AZURE_ENABLED` is required to be `"true"` for the HTTP route to run the ETL. Default off.
- **NetSuite dependency:** current sample CSV has NULL `Code` on 1273 Booking Fee + 38 Cash Handling Fee rows; parser fallback handles these (codes 9991/9992). Upstream should ideally populate Code for all rows.

---

## Workflow preferences active in this session

- **Subagent-driven development** (`superpowers:subagent-driven-development`) with per-task implementer + spec reviewer + code quality reviewer. Fix loops when reviewers find issues.
- **TDD** for parser (Phase 2) and resolver (Phase 3).
- **Karpathy guidelines** — surgical changes, no drive-by refactors, concrete failure modes.
- **Absolute paths in code, relative paths when referencing files to the user.**
- **Parallel reviewers where possible** (they're read-only).
- **Each commit is one conceptual change** with a specific message.
- Forbidden files list (the three pre-existing uncommitted ones) respected by every subagent.

---

## Decisions log (for context)

1. **Wipe-and-reimport** over data migration — old `salesRecords` shape is incompatible.
2. **Net-first schema** — `netAmount` + `vatAmount` replace `grossAmount` and `quantity`. Refunds are negative rows.
3. **`refNo` is line ID, `saleRef` is basket ID** — both required but neither unique; idempotency is blob-level only.
4. **Reversal pairs share refNo** — discovered by data inspection. No natural unique key on `salesRecords`; blob idempotency guards duplicates.
5. **Region codes configurable** — `regions.azureCode` (maps Azure path like `GB`) distinct from `regions.code` (canonical like `UK`).
6. **Fee-code fallbacks configurable** — `product_code_fallbacks` table, seeded with Booking Fee → 9991, Cash Handling Fee → 9992.
7. **Editing fallback codes requires backfill** — `updateFeeCodeFallback` helper in Phase 9.
8. **Editing region codes does NOT require backfill** — FK-based design (`regionId`) means display-value edits are free.
9. **Portable ETL core** — CLI + HTTP entry points; `DefaultAzureCredential` for future self-hosted move.
10. **Advisory lock** for concurrency; `sales_blob_ingestions(regionId, blobPath)` for idempotency.
11. **Feature flag gate** on HTTP route (`ETL_AZURE_ENABLED`).

---

## Outstanding minor / deferred items (not blockers)

- Phase 3 I2: Pass 2 UPDATE in resolver is still per-row (bulk pattern not applied). Cosmetic perf.
- Phase 3 M2–M5: resolver nullability casts, case-sensitivity of productName match — style only.
- Phase 4 M6: `path.basename` on Windows would behave oddly; prod is Linux so fine for now.
- Phase 5 migration 0019: `salesImports.regionId` is nullable at DB level; enforced at app level. Could tighten with a later migration once we're sure no gaps.
- Phase 1 critical-before-prod: capture a DB backup immediately before running the migration.

---

## Session artifacts committed

- `327132a` — design doc.
- `4db72c0` — implementation plan.
- Phase 1–6 commits listed above.

Total: 14 commits on this branch since `e29b034` (the maturity fix that was already landed at session start).
