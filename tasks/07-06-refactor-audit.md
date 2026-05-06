# Phase 7 Plan 07-06 — locations.outlet_code Refactor Audit

Generated 2026-05-06 as part of Task 07-06-09. Categorises every remaining
`locations.outletCode` / `locations.outlet_code` reference in the codebase
after Tasks 01-08 land. Tasks 10-12 apply the categorised replacements.

Total references: **36** across 18 files (down from the headline ~187 grep
count, which included substring matches inside comments / identifiers /
string literals that aren't actually `locations.outlet_code` column reads).

References excluded from this audit:
- `kiosks.outletCode` / `kiosks.outlet_code` — the canonical post-07-06
  outlet-code home, untouched.
- `outletExclusions.outletCode` — the outlet_exclusions admin table; rows
  there hold an outlet_code STRING the operator wants to exclude. The
  STRING shape is unchanged; what changes is which COLUMN that string
  matches against (kiosks.outlet_code instead of locations.outlet_code).
- `kiosk_assignments.outletCode` — denormalised on assignment rows; not
  touched.
- The `outletExclusions.byOutletCode` index name in schema.ts.

## Categorisation key

- **DROP**: comment / docstring / log line; rewrite to mention customer_code
  or outlet_code-via-kiosks.
- **DISPLAY**: select clause whose value is rendered in a table header,
  KPI card, dropdown label, or report column. Replace with
  `locations.customerCode` (the new canonical hotel-level identifier).
- **FILTER**: where clause that decides which sales rows / locations are
  in scope. Replace with a kiosks-side join through kiosk_assignments.
- **DEDUP**: identity / ON CONFLICT / unique-key check. Already covered by
  Tasks 01-08 (importer rewrites). Any leftover here is a comment that
  needs cleanup.
- **TEST**: assertion in a test fixture; update or remove.

## Per-file plan

| # | File | Line(s) | Cat | Replacement |
|---|------|---------|-----|-------------|
| 1 | src/app/(app)/admin/health/page.tsx | 27, 46 | FILTER | Use `getSentinelLocationId(db)` from Plan 07-06-06 instead of the raw `outletCode + name` lookup. **Wave 4** (Task 11). |
| 2 | src/app/(app)/analytics/actions.ts | 11 | DISPLAY | Drop `outletCode: locations.outletCode` from the select; the dimension-options dropdown renders `name ?? outletCode ?? id` — replace fallback with `name ?? customerCode ?? id`. **Wave 4** (Task 10). |
| 3 | src/app/(app)/analytics/commission/actions.ts | 143, 152 | DISPLAY | `coalesce(name, outletCode, 'Unknown')` → `coalesce(name, customerCode, 'Unknown')`. groupBy stays the same shape. **Wave 4** (Task 10). |
| 4 | src/app/(app)/analytics/flags/actions.ts | 153 | DISPLAY | The flags table's `outletCode` column is rendered to operators triaging flag activity. Replace select clause with `customerCode: locations.customerCode`. The TS type at line 14 also has `outletCode: string \| null` — rename to `customerCode`. UI code consuming the flag rows surfaces in `/analytics/flags/page.tsx`. **Wave 4** (Task 10). |
| 5 | src/app/(app)/kiosk-config-groups/actions.ts | 133 | DISPLAY | Detail page lists locations in a config group. The `outletCode` shown next to each location name was the legacy hotel-level identifier — switch to customerCode. The TS shape `{ id, name, outletCode }` (line 111) renames. UI: `src/components/kiosk-config-groups/config-group-members-client.tsx`. **Wave 4** (Task 11). |
| 6 | src/app/(app)/settings/data-quality/actions.ts | 11, 34, 61 | DISPLAY | `DataQualityRow.outletCode: string \| null` is rendered in the data-quality report table next to each location's name. Switch the column to `customerCode`. **Wave 4** (Task 11). |
| 7 | src/app/(app)/settings/outlet-exclusions/actions.ts | 186, 190 | FILTER | The "Test pattern against outlet codes in this region" preview surface scans `locations.outletCode` to show the operator which codes match. With outlet codes now living on kiosks, the test should scan `kiosks.outlet_code` joined through `kiosk_assignments` to active locations in the region. **Wave 4** (Task 11). |
| 8 | src/app/(app)/settings/outlet-types/pipeline.ts | 119, 321, 337, 397, 421, 426 | MIXED | This file does several things: lists unclassified outlets with their outlet_code displayed (DISPLAY), uses outlet_code for the per-region uniqueness check on bulk region reassignment (FILTER), and one log-message reference. Per the plan: the `MONDAY-` prefix detection at line ~166 (review reason) — the prefix logic moves off `outletCode` (column gone) onto a different signal. The bulk-region pre-flight at lines 397-426 (composite-unique check on (region, outlet_code)) is no longer meaningful — the (region, customer_code) partial unique enforced by migration 0040 is what the operator actually cares about now. Pre-flight rewrites to check `(targetRegionId, customerCode) WHERE customerCode IS NOT NULL`. **Wave 4** (Task 11). |
| 9 | src/app/portal/analytics/actions.ts | 50, 163, 172, 173 | DISPLAY | Portal-side dimension options — same shape as src/app/(app)/analytics/actions.ts. Replace the outletCode select + the fallback rendering with customerCode. **Wave 4** (Task 10). |
| 10 | src/db/seed-kiosks.ts | 51, 55, 67-153, 157, 164-168 | TEST | Local-dev seed script. The script seeds 8 kiosks with hardcoded outlet codes and looks them up against locations to attach assignments. Pre-07-06 it expected `seed-sales-demo` to have inserted locations with matching outlet codes. The seed-sales-demo path also needs updating (file 11 below). **Wave 4** (Task 11). |
| 11 | src/db/seed-sales-demo.ts | 50 | TEST | Same family as seed-kiosks. Updates a location row by outletCode. **Wave 4** (Task 11). |
| 12 | src/lib/analytics/active-locations.ts | 10 (comment), 45, 46 | FILTER | The `getActiveLocationIds` cache excludes locations matching outlet exclusions. Outlet exclusions are now per-kiosk codes. A location is active iff it does NOT have any active kiosk assignment to a kiosk whose outlet_code matches an exclusion in the same region. Rewrite the NOT EXISTS to scan `kiosks` via `kiosk_assignments`. **Wave 4** (Task 10). |
| 13 | src/lib/analytics/pivot-engine.ts + .test.ts | 21, 57 | DISPLAY | The pivot ALLOWED_COLUMNS map exposes `outlet_code` as a logical pivot dimension wired to `locations.outlet_code`. Per the plan: drop or alias to a join-derived expression. Simplest fix: rewire the logical name `outlet_code` to `locations.customer_code`. The pivot UI's "Outlet Code" dimension label remains (operator-facing label is fine; the column it queries is now customer_code). Pivot test file's assertion updates accordingly. **Wave 4** (Task 10). |
| 14 | src/lib/analytics/queries/heat-map.ts | 176, 188 | DISPLAY | The heat-map's per-location SELECT/GROUP BY references `locations.outletCode` for the `outlet_code` output column. Switch to customerCode. **Wave 4** (Task 10). |
| 15 | src/lib/analytics/queries/hotel-groups.ts | 251, 260 | DISPLAY | Same shape — `outletCode` projected as `outlet_code` for the hotel-groups breakdown. Switch to customerCode. **Wave 4** (Task 10). |
| 16 | src/lib/analytics/queries/location-groups.ts | 248, 257 | DISPLAY | Same shape, location-groups breakdown. Switch to customerCode. **Wave 4** (Task 10). |
| 17 | src/lib/analytics/queries/portfolio.ts | 450, 461 | DISPLAY | Same shape, portfolio queries. Switch to customerCode. **Wave 4** (Task 10). |
| 18 | src/lib/analytics/queries/shared.ts | 26, 30 | FILTER | `buildExclusionCondition` uses `locations.outletCode` for exact + regex matches against outlet exclusions. Same as active-locations.ts above — rewire to scan kiosks via assignments. The only callers of `buildExclusionCondition` were already migrating to `getActiveLocationIds` per the existing migration plan, so this may degrade to a deprecated helper. **Wave 4** (Task 10). |
| 19 | src/lib/csv/dimension-resolver.ts | 84 (comment) | DROP | Comment is informative ("Pre-07-06 the first pass keyed off…"); LEAVE it (audit trail in code). |
| 20 | src/lib/monday/import-location-products.ts | 409 (comment), 626 (comment) | DROP | Comments explaining the pre-07-06 → post-07-06 transition; LEAVE them. |

## Display-vs-filter summary

- **DISPLAY (keeps a column called `outlet_code` in select results, source switches to `customerCode`):** rows 2, 3, 4, 5, 6, 9, 13, 14, 15, 16, 17 (and pivot logical-column source).
- **FILTER (rewrites the WHERE/EXISTS clause through kiosks join):** rows 1, 7, 8 (partly), 12, 18.
- **TEST seed scripts (operator-driven, low-risk):** rows 10, 11.
- **Documentation comments only (leave):** rows 19, 20.

## Out-of-scope by intent

The `locations.outletCode` mention in `src/components/kiosks/*` and
`src/components/locations/location-detail-form.tsx` (the create-location
form's `outletCode` field) — those are about the LOCATION row's previous
identifier on the create form. The user-facing form fields will need a
separate cleanup commit (Task 11) to remove the field from the React form
+ zod schema + actions.ts createLocation/updateLocationField paths. They
are categorised under Task 11 alongside the settings-pipeline refactor.
