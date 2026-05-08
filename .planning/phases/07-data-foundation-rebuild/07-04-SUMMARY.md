---
phase: 07-data-foundation-rebuild
plan: 04
status: complete
artifacts:
  - src/db/schema.ts
  - src/lib/locations/same-name-detection.ts
  - src/lib/monday/import-location-products.ts
  - src/app/(app)/locations/page.tsx
  - src/app/(app)/admin/health/page.tsx
  - src/app/(app)/settings/audit-log/audit-log-table.tsx
  - scripts/backfill-normalised-names.ts
  - scripts/verify-same-name-guard.ts
  - migrations/0039_phase_07_normalised_name_and_merge_snapshots.sql
  - tests/locations/same-name-banner.spec.ts
  - tests/db/locations-same-name.integration.test.ts
  - tests/locations/same-name-detection.integration.test.ts
  - tests/monday/dry-import-warning.integration.test.ts
---

# Plan 07-04 — Same-name guardrails (SUMMARY)

## Outcome

Schema-level uniqueness for active `locations.normalised_name` enforced via
a partial unique index. Always-on detection surface on `/locations` and
`/admin/health` catches anything that slips past the index (manual SQL,
un-archive races, timing windows). Dry-import warning fires before any
write so operators see same-name candidates *before* they land.

Two add-ons not in the original plan body, landed in the same wave:

1. **Audit-log row-click navigation** — the existing `/settings/audit-log`
   list view now navigates rows to the new `/admin/audit-log/[id]` detail
   page from Plan 07-03. Closes the operator gap between Plan 07-03 and
   Plan 07-04.
2. **Phase 7 migration regen** — one consolidated migration file
   (`migrations/0039_phase_07_normalised_name_and_merge_snapshots.sql`)
   captures all three Phase 7 schema deltas so Plan E's prod cutover can
   apply them via `drizzle-kit migrate` instead of replaying raw SQL.

## Validation

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean (exit 0) |
| `npx vitest run --project unit` | 575 / 575 pass |
| Integration tests (3 new) | 6 / 6 pass via testcontainers + applied migration |
| `npx playwright test tests/locations/same-name-banner.spec.ts --list` | 3 tests listed |
| `npx tsx scripts/verify-same-name-guard.ts` against UAT | `PASS — partial unique index enforced` |
| Backfill on 357 active UAT rows | 0 rows updated (Plan B's runbook had populated them) |
| Dupe groups discovered before index | 0 |

## Schema delta

```sql
-- migrations/0039_phase_07_normalised_name_and_merge_snapshots.sql
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "normalised_name" text;

CREATE TABLE IF NOT EXISTS "location_merge_snapshots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "audit_log_id" uuid NOT NULL,
    "payload" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "location_merge_snapshots"
    ADD CONSTRAINT "location_merge_snapshots_audit_log_id_audit_logs_id_fk"
    FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id");

CREATE UNIQUE INDEX IF NOT EXISTS "locations_normalised_name_unique_active"
    ON "locations" ("normalised_name") WHERE archived_at IS NULL;
```

All three statements are `IF NOT EXISTS`-idempotent so prod cutover can
apply against any starting state safely.

## Sentinel `normalised_name` correctness fix

The plan body called this out as a discrepancy: Plan 07-02's runbook
inserted the sentinel with literal `normalised_name = 'LOCATION_NEEDED'`
(uppercase, underscore preserved), but
`normaliseName('LOCATION_NEEDED')` returns `'locationneeded'`
(lowercased, underscore stripped). The detection helper excludes the
latter form.

Fixed both surfaces:
- `scripts/v2-wipe-and-reseed.ts` STEP 3 — sentinel insert now passes
  `normaliseName(LOCATION_NEEDED_NAME)` instead of the literal name
- Live UAT row patched: `UPDATE locations SET normalised_name =
  'locationneeded' WHERE name = 'LOCATION_NEEDED'`

The bug was latent (no production hotel is named "LOCATION NEEDED") but
would have surfaced the sentinel as a same-name candidate against any
future hotel given that name.

## Deviations from the plan body

1. **`drizzle-kit generate` couldn't run cleanly.** Snapshots 0018-0021
   and 0024-0038 are missing from `migrations/meta/`, and `generate`
   prompts interactively for column-rename guesses. Hand-authored 0039
   instead. The Drizzle snapshot rebuild is its own scope of work
   tracked separately for Plan E or a follow-up.
2. **`runDryImport` doesn't exist.** Plan body said "extend
   `runDryImport` (or `runMondayImport({ dryRun: true })`)". Took the
   second path: `runMondayImport` now accepts `dryRun: boolean` +
   `persistWarnings: boolean` deps options. With `dryRun=true`, the
   function short-circuits before any DB write except (when
   `persistWarnings=true`) the single `dry_import_warning` audit-log
   entry, which is intentional per D-09.
3. **Filter wiring is RSC-only.** `?filter=same-name` constrains the
   page-level `LocationTable` data prop instead of adding a new prop on
   the client component. Cleaner — the filter is invisible to the
   table's URL-params logic.
4. **Backfill was a no-op on UAT.** Plan B's runbook had already
   populated `normalised_name` during the wipe-and-reseed. Backfill
   script kept as an idempotent maintenance op (`WHERE normalised_name
   IS NULL`) so it can re-run safely on any DB.
5. **Audit-log row-click nav was not in the original plan** — added per
   parent direction to close the operator gap left by Plan 07-03's
   detail page existing without inbound navigation.

## What's next

- **Task 4 (human checkpoint)** for both Plans 07-03 and 07-04 is
  outstanding: visual verify against UI-SPEC + live Playwright run
  against a Vercel preview alias. Plan E's preview-deploy provisioning
  is the natural place to satisfy this gate.
- **Plan 07-05 (Plan E)** — verification suite + UAT runbook + prod
  cutover. The migration regen done here means Plan E can run
  `drizzle-kit migrate` against prod instead of replaying raw SQL.
