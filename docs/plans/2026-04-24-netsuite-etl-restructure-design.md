# NetSuite ETL Restructure — Design

**Date:** 2026-04-24
**Branch:** `fix/maturity-buckets-end-date` (will rebase onto `optimisation` before merge)
**Author:** Vedant Kalbag + Claude
**Status:** Design approved, ready for implementation plan

---

## Problem

The current sales ingest pipeline accepts a single wide-format CSV (~74 columns mixing transactions + hotel/contract/kiosk metadata) uploaded manually via the admin UI. We need to:

1. Switch to a **lean, transactions-only NetSuite CSV** (37 columns) — hotel/kiosk metadata is already handled by `scripts/import-from-monday.ts`.
2. Ingest **daily files dropped into Azure Blob Storage** at a known path, keyed by region.
3. Support **cross-region outlet code collisions** (e.g. outlet `Q5` in `GB` ≠ `Q5` in `DE`).
4. Capture **new economic fields** (VAT rate/amount, business division, categories, etc.) and retire fields no longer in the source (gross `Amount`, `Quantity`, `Booking Fee`, `sale_cmmsn`, discount fields).
5. Stay **platform-agnostic** — the daily pipeline must run on Vercel today and on self-hosted infra tomorrow without rework.

## Non-goals

- The maturity age-bucket fix (commit `e29b034` on the current branch handles this).
- Admin UI for managing region codes / fee fallbacks / commission rates — data tables land in this phase; CRUD UIs are follow-ups.
- Migration of historical `sales_records` from the old schema — **we wipe and re-import** from the NetSuite feed (current file + backfill CSV provided separately).

---

## Architecture

```
┌──────────────────────────┐      ┌──────────────────────────┐
│  CLI                     │      │  HTTP                    │
│  scripts/run-azure-etl   │      │  POST /api/etl/azure/run │
│  (k8s CronJob / Docker / │      │  (Vercel cron,           │
│   GH Actions / any cron) │      │   x-etl-token header)    │
└───────────┬──────────────┘      └────────────┬─────────────┘
            └──────────────┬──────────────────┘
                           ▼
         ┌─────────────────────────────────────────┐
         │  src/lib/sales/etl/azure-etl.ts         │  ← platform-agnostic
         │  runAzureEtl(db, actor)                 │
         │   1. pg_try_advisory_lock               │
         │   2. list regions with azureCode        │
         │   3. for each region:                   │
         │      list blobs → for each unprocessed: │
         │      pull → parse → stage → commit      │
         │      → record sales_blob_ingestions     │
         │   4. release lock                       │
         └──────────┬────────────────────┬─────────┘
                    ▼                    ▼
   ┌──────────────────────────┐  ┌────────────────────────┐
   │ AzureBlobSource          │  │ existing pipeline      │
   │ (SalesDataSource impl,   │  │ _stageImportForActor   │
   │  DefaultAzureCredential) │  │ _commitImportForActor  │
   └──────────────────────────┘  └────────────────────────┘
```

**Key properties:**

- Core ETL has zero Next.js / Vercel imports — just `@azure/storage-blob`, `@azure/identity`, `drizzle-orm`, `pg`. Portable across hosting.
- Existing `_stageImportForActor` / `_commitImportForActor` stay and get a new `regionId` parameter. ETL calls them with a synthetic `etl-system` actor for audit-log attribution.
- **Concurrency:** Postgres advisory lock prevents two triggers double-ingesting.
- **Idempotency:** `sales_blob_ingestions(regionId, blobPath)` unique. A blob is processed at most once. User guarantees no overlap between daily files; reversals within a file land as legitimate negative rows.
- **Old upload UI deleted.** `CsvFileSource` deleted. One source of truth: Azure.

---

## Data model changes

### `regions` (edit)

```diff
- code:      text("code")                  // nullable, non-unique
+ code:      text("code").notNull().unique()   // canonical (UK, IE, DE, ES, CZ)
+ azureCode: text("azure_code").unique()       // configurable (GB, ES, DE) — matches blob path
```

Migration seeds canonical rows + sets `azureCode` defaults (`UK→GB`, `IE→IE`, `DE→DE`, `ES→ES`, `CZ→CZ`).

### `locations` (edit)

```diff
- outletCode: text("outlet_code").unique()
- region:     text("region")                   // deprecated — drop
+ primaryRegionId: uuid("primary_region_id").notNull().references(() => regions.id)
+ outletCode:      text("outlet_code").notNull()
+ unique (primaryRegionId, outletCode)
```

Free-text `locationGroup` stays for "Brighton"-style city labels. `region` drops.

**Backfill:** resolve `primaryRegionId` from `kiosks.regionGroup` via `kioskAssignments → kiosks`, mapped through `{UK→UK, Prague→CZ, Spain→ES, Germany→DE}`. Migration raises if any location is unresolvable — no silent defaults.

### `salesRecords` (rewrite)

Dropped: `grossAmount`, `quantity`, `discountCode`, `discountAmount`, `bookingFee`, `saleCommission`, `unique(saleRef, transactionDate)`.

Added:

| Column            | Type                    | Notes |
|-------------------|-------------------------|-------|
| `regionId`        | `uuid NOT NULL`         | FK → `regions.id`; denormalised from blob path |
| `refNo`           | `text NOT NULL`         | line identifier (can repeat for reversal pairs) |
| `netAmount`       | `numeric(12,2) NOT NULL`| signed; negative = reversal |
| `vatAmount`       | `numeric(12,2) NOT NULL`| signed; negative = reversal |
| `vatRate`         | `numeric(5,2)`          | percent (e.g. `20.00`) |
| `isBookingFee`    | `boolean NOT NULL`      | `productName === 'Booking Fee'` |
| `netsuiteCode`    | `text NOT NULL`         | from CSV `Code` or fee-fallback table |
| `agent`           | `text`                  | e.g. "Digital Sale" |
| `businessDivision`| `text`                  | e.g. "UberSSM" |
| `categoryCode`    | `text`                  | e.g. "TRNSCAR" |
| `categoryName`    | `text`                  | e.g. "UBER" |
| `apiProductName`  | `text`                  | e.g. "UberX" |
| `city`            | `text`                  | from CSV; denormalised; not used to enrich locations |
| `country`         | `text`                  | ISO2; from CSV |

Indexes:

```sql
index (regionId, transactionDate)
index (regionId, refNo)                 -- line-level queries
index (regionId, saleRef)               -- basket-level queries
index (locationId, transactionDate)
index (productId, transactionDate)
index (providerId, transactionDate)
index (transactionDate)
```

**No natural unique constraint.** Row identity is guaranteed by blob-level idempotency + user's "no overlap between days" guarantee. Reversal pairs legitimately share `refNo`.

### `products` (edit)

```diff
+ netsuiteCode:  text("netsuite_code").unique()  -- nullable; resolved by parser/dimension-resolver
+ categoryCode:  text("category_code")
+ categoryName:  text("category_name")
```

Dimension resolver prefers `netsuiteCode` match (strong), falls back to `productName`. Auto-creates new products with all fields populated.

### New: `sales_blob_ingestions`

```sql
CREATE TABLE sales_blob_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region_id uuid NOT NULL REFERENCES regions(id),
  blob_path text NOT NULL,
  blob_date date NOT NULL,
  etag text,
  processed_at timestamp NOT NULL DEFAULT now(),
  import_id uuid REFERENCES sales_imports(id),
  status text NOT NULL CHECK (status IN ('success', 'failed')),
  error_message text,
  UNIQUE (region_id, blob_path)
);
```

### New: `product_code_fallbacks`

```sql
CREATE TABLE product_code_fallbacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name text UNIQUE NOT NULL,
  netsuite_code text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
-- Seeded:
INSERT INTO product_code_fallbacks (product_name, netsuite_code) VALUES
  ('Booking Fee', '9991'),
  ('Cash Handling Fee', '9992');
```

Parser receives this map at start of run; if CSV `Code` is empty and `Product Name` matches a fallback row, assign that `netsuite_code` instead of erroring. Admin-editable via migration/UI (future).

**Config propagation on edit — explicit backfill.** `salesRecords.netsuiteCode` and `products.netsuiteCode` are denormalised text, not FKs — editing `product_code_fallbacks.netsuite_code` leaves history pointing at the stale value. A dedicated helper enforces propagation:

```ts
// src/lib/sales/config/fee-fallbacks.ts
export async function updateFeeCodeFallback(
  db: AnyDb,
  actor: ImportActor,
  productName: string,
  newCode: string,
): Promise<{ updatedProducts: number; updatedSalesRecords: number }>
```

Inside a single transaction:
1. `UPDATE product_code_fallbacks SET netsuite_code = $new WHERE product_name = $name` (fetch old value).
2. `UPDATE products SET netsuite_code = $new WHERE netsuite_code = $old AND name = $name`.
3. `UPDATE sales_records SET netsuite_code = $new WHERE netsuite_code = $old AND product_id IN (SELECT id FROM products WHERE name = $name)`.
4. Write audit log entry with old/new codes and affected row counts.

Any surface that edits `product_code_fallbacks` (admin UI, migration, ad-hoc script) **must** call this helper — direct SQL UPDATE on the config table is forbidden by convention (and can be enforced with a Drizzle lint rule, same pattern as the `salesRecords` raw-insert allow-list).

**Region code edits — no backfill needed.** `regions.code` (canonical) and `regions.azureCode` (Azure mapping) are display/lookup values. All downstream tables reference `regions.id` via FK. Edit freely; the next ETL run will list blobs under the new `azureCode` path. Existing `sales_blob_ingestions` rows keep their historical `blob_path` as an accurate record of what was processed.

### New: `etl-system` actor

Seeded `user` row (fixed UUID, name `"Azure ETL"`) used as `uploadedBy` for automated imports. Keeps audit-log schema unchanged.

---

## Parser + ETL runner

### `src/lib/csv/sales-csv.ts` — rewritten header map

Allow-listed columns (others silently ignored):

| CSV column         | Parsed field      | Required | Notes |
|--------------------|-------------------|----------|-------|
| `Saleref`          | `saleRef`         | yes      | basket ID |
| `Ref No`           | `refNo`           | yes      | line ID |
| `Code`             | `netsuiteCode`    | yes*     | *or fee fallback |
| `Product Name`     | `productName`     | yes      | drives `isBookingFee` |
| `Category Code`    | `categoryCode`    | no       | |
| `Category Name`    | `categoryName`    | no       | |
| `agent`            | `agent`           | no       | |
| `Outlet Code`      | `outletCode`      | yes      | |
| `Outlet Name`      | `outletName`      | no       | verification only |
| `Date`             | `transactionDate` | yes      | authoritative (replaces `Din` bug) |
| `Time`             | `transactionTime` | no       | |
| `Customer Code`    | `customerCode`    | no       | |
| `Customer Name`    | `customerName`    | no       | |
| `supp_nam`         | `providerName`    | no       | |
| `API Product Name` | `apiProductName`  | no       | |
| `City`             | `city`            | no       | |
| `Country`          | `country`         | no       | ISO2 |
| `Business Division`| `businessDivision`| no       | |
| `VAT Rate`         | `vatRate`         | no       | |
| `Net Amt`          | `netAmount`       | yes      | signed |
| `VAT Amt`          | `vatAmount`       | yes      | signed |
| `Currency`         | `currency`        | yes      | |

Signature:

```ts
parseSalesCsv(
  text: string,
  opts: { feeCodeFallbacks: Map<string, string> }
): ParseResult
```

Date parser handles both formats (`1-Jan-26`, `2026-01-01`) and treats `NULL` as absent. `NULL` `Code` with fallback hit → code assigned; without → validation error.

### `src/lib/csv/dimension-resolver.ts` — region-scoped

```ts
resolveDimensions(db, rows, opts: { regionId: string })
```

- Outlet: `WHERE primaryRegionId = $regionId AND outletCode = $code`. No auto-create (Monday is truth).
- Product: `netsuiteCode` match first, then `productName`. Auto-create with all dimensions.
- Provider: `supp_nam` match. Auto-create.

### `src/lib/sales/azure-blob-source.ts`

Implements `SalesDataSource`. Uses a shared `BlobServiceClient` from `src/lib/sales/azure-client.ts`:

- `AZURE_STORAGE_CONNECTION_STRING` if present (local/dev).
- Else `DefaultAzureCredential` + `AZURE_STORAGE_ACCOUNT_URL` (managed identity in Azure).

### `src/lib/sales/etl/azure-etl.ts`

```ts
export async function runAzureEtl(opts: { db, now }): Promise<EtlRunResult>
```

Flow:
1. `pg_try_advisory_lock(ETL_LOCK_KEY)` — fail fast if already running.
2. Load `regions WHERE azure_code IS NOT NULL`.
3. Load `product_code_fallbacks` into a map.
4. For each region:
   - Prefix-list blobs under `clientdata/{azureCode}/`.
   - Skip those present in `sales_blob_ingestions(regionId, blobPath)`.
   - Parse path → `blobDate`.
   - `AzureBlobSource.pull()` → stage → commit via existing helpers (scoped to `regionId`).
   - Record outcome in `sales_blob_ingestions`.
5. Release lock.
6. Return `{ processedBlobs, skippedBlobs, failedBlobs, errors }`.

**Failure semantics:** one bad blob fails only that blob; run continues. Failed blobs retried on next run (status is re-checked).

### Entry points

- CLI: `scripts/run-azure-etl.ts` — calls `runAzureEtl`, exits 0/1.
- HTTP: `src/app/api/etl/azure/run/route.ts` — `POST`, guarded by `x-etl-token` matching `ETL_SHARED_SECRET`.

Both are thin wrappers (<40 LoC each) calling the same core function.

### Environment

```
AZURE_STORAGE_CONNECTION_STRING=...      (optional, for local/dev)
AZURE_STORAGE_ACCOUNT_URL=https://...   (production, used with DefaultAzureCredential)
AZURE_BLOB_CONTAINER=clientdata
ETL_SHARED_SECRET=...                    (for HTTP entry point)
ETL_AZURE_ENABLED=true                   (feature flag, see rollback)
```

`vercel.json` cron adds:
```json
{ "crons": [{ "path": "/api/etl/azure/run", "schedule": "0 4 * * *" }] }
```
(4am UTC — after NetSuite drops the previous day's file; adjust when exact drop time known.)

---

## Commission processor rewrite

Existing calculator in `src/lib/commission/processor.ts` sums `grossAmount`. Under the new model:

- **Commission base** = `SUM(netAmount)` on rows where `isBookingFee = true`, grouped by the existing commission scope (location × period).
- Principal rows are pass-through product cost (not commissionable).
- Commission config tables (rates, tiers) stay unchanged; only the calculation function is updated.
- All existing `commission_*` rows are invalidated when `salesRecords` is wiped; they recompute on the first post-migration run of `calculateCommissionsForRecords`.

---

## Migration ordering (single branch, sequenced commits)

1. Schema migration SQL + regenerated drizzle types.
2. Parser rewrite + tests.
3. Dimension resolver region-scoping + tests.
4. `AzureBlobSource` + auth factory + tests.
5. `runAzureEtl` orchestrator + advisory lock + blob-ingestion tracking + tests.
6. CLI entry point.
7. HTTP entry point.
8. Commission processor rewrite.
9. Remove old upload UI + `CsvFileSource`; repurpose page as history view.
10. Env wiring, Vercel cron, docs update.

Each commit ships one conceptual change with tests and a summary message.

---

## Testing

**Unit (Vitest):**
- `sales-csv.test.ts` — new headers, allow-list, date parsing variants, negative amounts, NULL-Code with/without fallback, `isBookingFee` derivation, required fields.
- `dimension-resolver.test.ts` — region-scoped outlet resolution, cross-region collision, product match preference.
- `azure-blob-source.test.ts` — stubbed `BlobServiceClient`; `pull()` returns correct label/hash/bytes.
- `azure-etl.test.ts` — idempotency, advisory lock contention, partial failure doesn't stop good blobs, failed blob retried successfully on next run.

**Integration (Postgres + stub blob client):** full `runAzureEtl` against the NetSuite CSV fixture. Assert row counts, reversal pairs, `isBookingFee` count, `SUM(netAmount)` per basket.

**Playwright UAT (mandatory per CLAUDE.md):**
- `etl-history.spec.ts` — admin views blob ingestion history and row-level errors.
- `region-scoped-sales.spec.ts` — cross-region isolation: same outlet code in different regions never cross-contaminates.
- `commission-net.spec.ts` — dashboard reflects new net-based commission on a seeded dataset.

**Manual smoke pre-merge:**
- `npx tsx scripts/run-azure-etl.ts` against Azurite (local emulator) with fixture files.
- `POST /api/etl/azure/run` with shared secret returns identical result.
- Interrupt mid-run → next run resumes cleanly.

---

## Rollback

Migration truncates `salesRecords`; rollback = abort before cut-over, not "undo".

- Tested against staging DB clone on preview branch.
- **Full DB backup immediately before migration applies.**
- Feature flag `ETL_AZURE_ENABLED=false` by default — schema + code can ship safely; ingestion only begins when flag flipped and cron enabled.

---

## Open dependencies (not blockers, but pre-flight)

1. **NetSuite emits `Code` for fee rows.** Current file has 1273 Booking Fee + 38 Cash Handling Fee rows with `Code = NULL`. Parser fallback covers this for now (codes `9991`, `9992`); long-term, NetSuite should supply them.
2. **Backfill CSV availability.** User is providing the historical backfill CSV separately. Landing path: upload into the same Azure structure with historical dates, ETL picks them up.
3. **Azure storage account + container provisioning.** Container `clientdata` created; SAS / managed identity available per environment.
4. **Exact NetSuite drop time** — informs cron schedule.
