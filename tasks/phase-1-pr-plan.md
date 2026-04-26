# Phase 1 — PR-Sized Work Items

Source: `tasks/todo.md` Phase 1 (1.1–1.9) + Resolved Decisions D1–D13.

Phase 1 unblocks the analytics correctness story. The 9 root-cause tasks decompose into **6 PRs** below — three of them shipped first to stop active misrepresentation (1.6, 1.1, 1.7) and the remainder sequenced behind a shared "fee + reversal + counts" PR that reshapes the SQL contract used by every dashboard.

---

## Task 1.1 — Filter archived locations from `getActiveLocationIds`

**Source decision**: Cross-cutting audit P0 #1 (no D-level decision; treat as pure bugfix). Archived hotels must not contribute to any analytics surface.
**Phase 1 task ref**: 1.1 in tasks/todo.md

### What this PR does
Adds `WHERE archived_at IS NULL` to `getActiveLocationIds()` so soft-archived locations stop leaking into every dashboard's "active" predicate. Single-line SQL change, big blast radius.

### Files to touch
- `src/lib/analytics/active-locations.ts:34-43` — add `WHERE archived_at IS NULL` (combined with the existing `NOT EXISTS` on `outlet_exclusions`).
- `src/lib/analytics/__tests__/active-locations.test.ts` — **new file**. Seed two locations (one with `archivedAt`), assert the archived id is missing from `getActiveLocationIds()`.

### Acceptance criteria (testable)
1. `SELECT COUNT(*) FROM locations WHERE archived_at IS NOT NULL` > 0 in the prod snapshot AND those ids do **not** appear in `getActiveLocationIds()` output.
2. Portfolio KPI strip "Total Sales" with date range `2024-01-01..2024-12-31` decreases (or stays equal) after the change vs main, never increases.
3. Heat Map composite — an archived hotel with historical sales that previously rendered as an `Emerging` row no longer appears in `allPerformers`.
4. New unit test passes; portfolio.test.ts and heat-map.test.ts continue to pass.

### Dependencies
- Depends on: none.
- Blocks: nothing strictly — but should land before 1.5 so re-validation of membership dedupe is against the post-archive cohort.

### Risk / blast radius
Affects every dashboard (every `build*Where` calls `buildActiveLocationCondition`). Risk: a customer who genuinely wants archived sales in YTD totals will see numbers drop. Mitigation: this is the documented intent in the audit; operators can un-archive a location if they need it included. No knob added in Phase 1.

### Estimated size
S (under 50 LoC including the new test).

### Branch suggestion
`gsd/p1-1-archived-location-filter`

---

## Task 1.2 — Reversal handling (D2): schema + ingest + KPI helpers

**Source decision**: D2 — add `is_reversal`, `original_record_id`, `processed_at_location_id` columns; populate at CSV ingest by matching refNo suffix; rewrite `location_id` of matched refunds to the original's location; expose new KPIs (Cancellations, Partial Refunds, Orphan Refunds).
**Phase 1 task ref**: 1.2 in tasks/todo.md

### What this PR does
Lands the schema change (3 new columns on `sales_records`), updates the CSV parser to detect reversals + match originals + rewrite `location_id`, backfills existing rows, and exports a `buildNonReversalCondition()` helper used by every COUNT(*) site landed in PR-3 (1.3).

### Files to touch
- `migrations/0026_sales_reversal_columns.sql` — **new**. `ALTER TABLE sales_records ADD COLUMN is_reversal boolean NOT NULL DEFAULT false`, `original_record_id uuid NULL REFERENCES sales_records(id)`, `processed_at_location_id uuid NULL REFERENCES locations(id)`. Indexes on `(is_reversal)` and `(original_record_id)`. Backfill: scan existing rows, detect refNo suffix patterns, populate columns + rewrite `location_id` for matched pairs.
- `src/db/schema.ts:640-680` — add the three column declarations + indexes on `salesRecords`.
- `src/lib/csv/sales-csv.ts:179-238` — emit `isReversal`, `originalRecordId` (resolved post-import), `processedAtLocationId` on `ParsedSalesRow`. Add reversal-detection logic (refNo suffix `-b`, `-h`, etc.) at parse time.
- `src/app/(app)/settings/data-import/sales/pipeline.ts:280-310` — at commit time, run reversal-matching join (within the import + against historical `sales_records` already committed); rewrite matched-refund `location_id` to original's `location_id`; record `processed_at_location_id`.
- `src/lib/analytics/queries/shared.ts` — add `export function buildNonReversalCondition(): SQL` returning `${salesRecords.isReversal} = false`. Add `buildIsReversalCondition()` for the new KPI tiles.
- `src/lib/csv/sales-csv.test.ts` — extend with cases: original row, full refund, partial refund, orphan refund (no parent in window).

### Acceptance criteria (testable)
1. Migration applies cleanly on a copy of prod DB; `SELECT COUNT(*) FROM sales_records WHERE is_reversal IS NULL` = 0.
2. After backfill, `SELECT COUNT(*) FROM sales_records WHERE is_reversal AND original_record_id IS NULL` < 1% of total reversals (the rest are matched).
3. CSV parser unit tests prove: a refund row with refNo `XYZ-b` whose original `XYZ` exists in the same import → `is_reversal=true`, `original_record_id` set, `location_id` rewritten to original's.
4. New `buildNonReversalCondition()` returns `sales_records.is_reversal = false`; `buildIsReversalCondition()` returns the inverse.
5. `getPortfolioSummary` numbers are unchanged in this PR (KPI consumers wired in 1.3).

### Dependencies
- Depends on: none structurally, but **must land before 1.3** because 1.3 wires the new helper into every COUNT(*).
- Blocks: 1.3.

### Risk / blast radius
Schema change is additive; safe to roll back by dropping columns. Matching logic on backfill is the risky bit — write a CSV of unmatched refunds for manual review (orphan-refund report) before committing the rewrite. Mitigation: do the backfill in a transaction with `RAISE NOTICE` for unmatched-rate sanity check.

**Open question**: D2 says ingest **rewrites** `location_id` for matched refunds. Confirm the same rewrite should happen on the **backfill** of existing rows, not just new imports. (Default assumption: yes, it must, otherwise existing data stays misattributed to BK/Customer Service.)

**Open question**: refund-suffix grammar. Audit lists `-b`, `-h`. Need the canonical regex. Suggest `/-[a-z]$/` as the conservative match; user to confirm.

### Estimated size
L (300+ LoC: migration, parser changes, pipeline matching, tests).

### Branch suggestion
`gsd/p1-2-reversal-handling`

---

## Task 1.3 — Fee semantics + COUNT(*) sweep (D1 + D10)

**Source decision**: D1 — Counts are mode-invariant (non-fee + non-reversal). Amounts swap on mode (sales = non-fee SUM, revenue = fee SUM). D10 — Rename `salesRecords.isBookingFee` → `is_weknow_fee`; CSV parser sets TRUE for both NetSuite codes 9991 AND 9992; `buildIsFeeCondition()` simplifies to a single column check.
**Phase 1 task ref**: 1.3 in tasks/todo.md

### What this PR does
1) Renames `is_booking_fee` column to `is_weknow_fee` everywhere (~24 call sites).
2) Updates the CSV parser to set the flag for **both** 9991 AND 9992.
3) Simplifies `buildIsFeeCondition()` / `buildNonFeeCondition()` to a single-column predicate.
4) Introduces `buildSalesTxnCondition()` = non-fee AND non-reversal — used by every "Transactions" / "Bookings" KPI.
5) Audits and fixes every `COUNT(*)` call in `src/lib/analytics/queries/` to use it.

### Files to touch
- `migrations/0027_rename_is_booking_fee_to_is_weknow_fee.sql` — **new**. `ALTER TABLE sales_records RENAME COLUMN is_booking_fee TO is_weknow_fee`. Backfill: `UPDATE sales_records SET is_weknow_fee = true WHERE netsuite_code IN ('9991', '9992')` (catches existing 9992 rows).
- `src/db/schema.ts:660` — rename `isBookingFee` → `isWeknowFee`.
- `src/lib/csv/sales-csv.ts:27, 179, 237` — emit `isWeknowFee = (netsuiteCode === '9991' || netsuiteCode === '9992')` instead of the productName equality. Update `ParsedSalesRow` type.
- `src/lib/analytics/queries/shared.ts:45-59` — collapse `buildIsFeeCondition` to `${salesRecords.isWeknowFee} = true`; collapse `buildNonFeeCondition` likewise; **add new** `buildSalesTxnCondition()` = `(NOT isWeknowFee) AND (NOT isReversal)`.
- `src/lib/analytics/queries/portfolio.ts:219` — drop the redundant `OR parent.netsuite_code IN ('9991', '9992')` arm in the LATERAL join; just check `parent.is_weknow_fee = false`.
- `src/lib/analytics/queries/high-performer-analysis.ts:194` — replace hand-rolled `isBookingFee = false` with `buildNonFeeCondition()`.
- `src/lib/analytics/queries/trend-series.ts:90` — rename column ref.
- `src/lib/commission/processor.ts:75-368` — rename `isBookingFee` field on the typed result + filter; update the `eq(salesRecords.isWeknowFee, true)` clauses (2 sites).
- `src/app/(app)/settings/data-import/sales/pipeline.ts:286` — rename field on stored.parsed.
- `src/lib/csv/sales-csv.test.ts:38, 50, 62` — rename + add test asserting code 9992 with productName "Cash Handling Fee" sets `isWeknowFee=true`.
- `src/lib/analytics/types.ts:52` — update the doc comment.
- Audit every `COUNT(*)` in `queries/portfolio.ts`, `queries/heat-map.ts`, `queries/hotel-groups.ts`, `queries/regions.ts`, `queries/location-groups.ts`, `queries/comparison.ts`, `queries/maturity-analysis.ts`, `queries/trend-series.ts`, `queries/location-revenues.ts`, `queries/high-performer-analysis.ts` — add `buildSalesTxnCondition()` to the WHERE composition (or wire it into each module's `buildXWhere`).

### Acceptance criteria (testable)
1. Migration applies; `SELECT COUNT(*) FROM sales_records WHERE is_weknow_fee = true AND netsuite_code = '9992'` > 0 (the backfill caught existing 9992 rows that were previously `false`).
2. `getPortfolioSummary` "Transactions" KPI in **sales mode** is now mode-invariant (matches **revenue mode** Transactions count exactly) — this is D1's contract.
3. Portfolio "Avg Basket" in sales mode rises from current £600-ish demo numbers (or whatever the inflated baseline shows) to a value within an order of magnitude of the historical real basket.
4. Top Products (Performer Patterns Bottom + Top) no longer contains "Cash Handling Fee" rows.
5. `grep -rn "isBookingFee\|is_booking_fee" src/` returns 0 hits after the PR.
6. All existing analytics tests (`portfolio.test.ts`, `heat-map.test.ts`, `hotel-groups.test.ts`) updated and pass.

### Dependencies
- Depends on: 1.2 (must land first — `buildSalesTxnCondition` references `is_reversal`).
- Blocks: 1.4, 1.5, 1.6 in the sense that they're easier to verify against a fixed COUNT baseline.

### Risk / blast radius
Largest single PR by call-site count. Touches every analytics dashboard's COUNT semantics. Mitigation: land **after** 8.1 (CI smoke) so every dashboard is HTTP-200 + numeric-KPI-asserted on the preview deploy. Diff every dashboard's KPI strip pre/post on a snapshot DB before merging.

### Estimated size
L (300+ LoC across ~15 files; mechanical column rename + helper introduction + audit sweep).

### Branch suggestion
`gsd/p1-3-fee-and-counts-sweep`

---

## Task 1.4 — Maturity bucket convention (D3)

**Source decision**: D3 — 5 buckets in months: `0-1 / 1-3 / 3-6 / 6-9 / 9+`. Reference date is always `filters.dateTo`, never `NOW()`. Applied identically across maturity dashboard, global filter chip, ramp-curve SQL, and `calculateMaturityBucket()`.
**Phase 1 task ref**: 1.4 in tasks/todo.md

### What this PR does
1) Replaces the 4-bucket `MaturityBucket` type with a 5-bucket scheme (`0-1mo | 1-3mo | 3-6mo | 6-9mo | 9+mo`).
2) Deletes the parallel `DetailedMaturityBucket` (`0-30d / 31-60d / 61-90d / 90+d`).
3) Changes `calculateMaturityBucket(date, referenceDate?)` to require `referenceDate` (no NOW() default).
4) Adds the `6-9mo` arm to `buildMaturityCondition()` in shared.ts and shifts the `6+mo` bucket to `9+mo`.
5) Updates every client-side caller to pass `filters.dateTo`.

### Files to touch
- `src/lib/analytics/maturity.ts:1-56` — new 5-bucket scheme; delete `DetailedMaturityBucket` + `calculateDetailedMaturityBucket`; remove the `referenceDate` default; update labels.
- `src/lib/analytics/queries/shared.ts:119-157` — add `6-9mo` arm; rename `6+mo` → `9+mo`; bucket boundary uses `dateTo - INTERVAL '9 months'`.
- `src/lib/analytics/maturity.test.ts` — extend coverage for the new boundaries; remove the `calculateDetailedMaturityBucket` describe block.
- `src/app/(app)/analytics/maturity/page.tsx:25, 113` — switch from `DETAILED_MATURITY_BUCKETS` to `MATURITY_BUCKETS`.
- `src/app/(app)/analytics/maturity/page.tsx:28-75` — review plateau detection thresholds; bucket-aware ramp-curve labelling.
- `src/lib/analytics/queries/maturity-analysis.ts:88-93, 147-152, 194-207` — replace any hard-coded 30/60/90-day boundaries with `dateTo`-relative month math.
- `src/app/(app)/analytics/portfolio/outlet-tiers.tsx:91-93` — pass `filters.dateTo` to `calculateMaturityBucket`.
- `src/app/(app)/analytics/heat-map/performance-table.tsx:114-117` — same.
- `src/components/analytics/filter-bar.tsx:227` — render the 5 chips from `MATURITY_BUCKETS`.
- `src/lib/stores/analytics-filter-store.ts:215-217` — whitelist the maturity values when parsing URL.

### Acceptance criteria (testable)
1. `MATURITY_BUCKETS` exports exactly: `0-1mo`, `1-3mo`, `3-6mo`, `6-9mo`, `9+mo`.
2. `calculateMaturityBucket` is a 2-arg call site everywhere (no implicit NOW() default); type-check fails if called with 1 arg.
3. With `filters.dateTo = '2024-06-30'` and a location's first kiosk assigned on `2024-04-15`, the bucket resolves to `1-3mo` deterministically (current behaviour with NOW() would give a different answer in 2026).
4. Heat Map and Outlet Tiers maturity badges match what the global filter chip says for the same location/date.
5. URL `?maturity=foo` is dropped (whitelist).

### Dependencies
- Depends on: none.
- Blocks: 4.4 + 4.5 (covered by this PR's call-site updates).

### Risk / blast radius
Anything that hard-codes 4-bucket arrays/strings breaks. Mitigation: TypeScript will catch most of it (`MaturityBucket` is a string literal union). Search for remaining `'6+mo'` literals before merge.

### Estimated size
M (100–300 LoC; 1 helper file + 1 SQL helper + 4 callers + tests).

### Branch suggestion
`gsd/p1-4-maturity-buckets-5-scheme`

---

## Task 1.5 — Membership double-counting (D5)

**Source decision**: D5 — three different treatments: regions get 1-per-location with UNIQUE constraint + cleanup of bogus UK memberships; location groups same; hotel groups stay N:N for legitimate JV cases (per-location dedupe at query layer). Management UI changes are deferred to Phase 7 (7.2b).
**Phase 1 task ref**: 1.5 in tasks/todo.md

### What this PR does
1) Adds a UNIQUE constraint on `location_region_memberships.location_id` (replacing the composite PK `(location_id, region_id)` with `UNIQUE (location_id)` + leave `region_id` non-PK).
2) Same on `location_group_memberships`.
3) Cleans up bogus UK region memberships (D5 — sourced from Monday in the import path; Phase 1 just dedupes the data + adds the constraint).
4) Rewrites `regions.ts`, `hotel-groups.ts`, `location-groups.ts`, `comparison.ts` to dedupe per-location BEFORE aggregating (use the existing CTE pattern from `hotel-groups.ts:115-137` as the template — it already does this for hotel groups).

### Files to touch
- `migrations/0028_membership_dedup.sql` — **new**. (a) cleanup query for duplicate region memberships (keep MIN by created_at, delete the rest); (b) `ALTER TABLE location_region_memberships DROP CONSTRAINT … PRIMARY KEY, ADD UNIQUE (location_id), ADD PRIMARY KEY (location_id, region_id)` — keep composite PK, add a separate UNIQUE on location_id; (c) same for `location_group_memberships`. **Do not** add UNIQUE to `location_hotel_group_memberships` (D5 keeps N:N for hotel groups).
- `src/db/schema.ts:543-575` — add `unique()` constraint to `locationRegionMemberships` + `locationGroupMemberships`.
- `src/lib/analytics/queries/regions.ts:74-100, 145-225` — apply the `loc_agg` CTE pattern from hotel-groups before the membership JOIN.
- `src/lib/analytics/queries/location-groups.ts` — same pattern (hotel-groups CTE).
- `src/lib/analytics/queries/comparison.ts:130-192` — rewrite hotel-group + region branches to dedupe per-location first.
- `src/lib/analytics/queries/hotel-groups.test.ts` — extend; **new** `regions.test.ts` and `location-groups.test.ts` to cover the dedupe.

### Acceptance criteria (testable)
1. Migration succeeds; `SELECT location_id, COUNT(*) FROM location_region_memberships GROUP BY 1 HAVING COUNT(*) > 1` returns 0 rows.
2. UK region "Hotels" count drops from 79 → 63 (matches detail-panel KPI; resolves the divergence flagged in audit issue #4.19).
3. Selecting `regionIds=['UK', 'Spain']` for a location that lives in both no longer doubles its revenue contribution (test case in `regions.test.ts`).
4. `getEntityMetrics(entityType='hotel_group', [JV-group, parent-group])` for a location with both memberships does NOT double-count revenue.

### Dependencies
- Depends on: 1.1 (archived locations excluded from the cleanup script's denominator).
- Blocks: 4.14 (Compare hotel-group/region cards dedupe), 4.19 (region count divergence).

### Risk / blast radius
Migration mutates production data (deletes duplicate memberships). Mitigation: dry-run first (output the rows-to-be-deleted as a CSV in `tasks/analytics-audit/region-membership-dedup.csv` for review), then commit. The CTE rewrite is mechanical — same pattern already proven in `hotel-groups.ts:115-137`.

**Open question**: D5 says regions get UNIQUE on `(location_id)`. The current PK is `(location_id, region_id)`. We should keep the composite PK (it's correct) AND add `UNIQUE (location_id)` separately, so a future bug can't reintroduce duplicates. Confirm.

### Estimated size
L (300+ LoC across migration + 4 query rewrites + 3 test files).

### Branch suggestion
`gsd/p1-5-membership-dedup`

---

## Task 1.6 — Schema drift sweep (Pivot is broken)

**Source decision**: Pure bugfix — Pivot Table references columns dropped in migration 0022. No D-level decision; the audit (06-cross-cutting + ANALYTICS-ISSUES.md line 193-200) catalogues every drifted ref.
**Phase 1 task ref**: 1.6 in tasks/todo.md

### What this PR does
Replaces every reference to dropped columns (`gross_amount`, `quantity`, `booking_fee`, `sale_commission`, `discount_amount`, `locations.region`, `locations.hotel_group`, `locations.location_group`) in the Pivot engine + store + tests + the `EDITABLE_LOCATION_FIELDS` constant. After this PR, `/analytics/pivot` no longer 500s.

### Files to touch
- `src/lib/analytics/pivot-engine.ts:38-79, 247-250` — `ALLOWED_COLUMNS`: drop `quantity`, `sale_commission`, `discount_amount`; replace `gross_amount` → `net_amount` (mapped to `sales_records.net_amount::numeric`); replace `booking_fee` with `CASE WHEN sales_records.is_weknow_fee THEN sales_records.net_amount ELSE 0 END` (depends on 1.3 column rename); replace `region` (`locations.region`) with a join via `regions.name` through `location_region_memberships`; replace `hotel_group`, `location_group` with the membership-table joins. Update `METRIC_COLUMNS` and the `field === ...` checks accordingly.
- `src/lib/stores/pivot-store.ts:22` — rename `gross_amount` label/id to `net_amount` (or keep label "Revenue", drop the id).
- `src/lib/analytics/pivot-engine.test.ts:22-216` — rewrite assertions against the new allowlist.
- `src/app/(app)/locations/actions.ts:209-239` (`EDITABLE_LOCATION_FIELDS`) — remove `"region"`, `"hotelGroup"`, `"locationGroup"` (these columns were dropped from `locations`). Also surfaces task 7.3 — reuse the same removal.

### Acceptance criteria (testable)
1. `/analytics/pivot` page loads with HTTP 200 and renders a non-empty result for a default config (rowFields=`["hotel_name"]`, values=`[{field:"net_amount", aggregation:"sum"}]`).
2. `grep -n "gross_amount\|sale_commission\|discount_amount" src/lib/analytics/pivot-engine.ts` → 0 hits.
3. `grep -rn "locations\.region\|locations\.hotel_group\|locations\.location_group" src/` → 0 hits.
4. `EDITABLE_LOCATION_FIELDS` no longer contains `"region"`, `"hotelGroup"`, `"locationGroup"`; updateLocationField for those fields returns a validation error (not a 500).
5. `pivot-engine.test.ts` passes.

### Dependencies
- Depends on: 1.3 (uses the renamed `is_weknow_fee` column in the `booking_fee` field's CASE expression). If 1.3 is delayed, the booking_fee logical column can stay `is_booking_fee`-based on a feature branch but rebase before merging.
- Blocks: nothing.

### Risk / blast radius
Pivot is currently broken — any output is an improvement. The `EDITABLE_LOCATION_FIELDS` change risks breaking a hidden code path that still posts those fields (search for `"region"` or `"hotelGroup"` POST bodies). Mitigation: server returns 400 with a clear validation message instead of 500.

**Open question**: D5 doesn't explicitly say what label to expose for the membership-table-backed dimensions (the user picks "hotel_group" but the SQL joins `location_hotel_group_memberships`). Keep the label `hotel_group`; document the join in the code comment.

### Estimated size
M (100–300 LoC; 1 engine file + tests + 1 deletion in actions.ts).

### Branch suggestion
`gsd/p1-6-pivot-schema-drift`

---

## Task 1.7 — Internal-user-with-zero-scopes safety

**Source decision**: Pure security bugfix. `scoped-query.ts:92` returns `null` (no filter, unrestricted) when an **internal** user has zero scopes. Should mirror external-user behaviour (THROW) or default-deny.
**Phase 1 task ref**: 1.7 in tasks/todo.md

### What this PR does
Changes the `scopes.length === 0` branch in `buildScopeFilter` to throw for internal members/viewers (admin remains unrestricted). Also adds `React.cache` wrapping on `scopedSalesCondition` (audit P1 #12) since both fixes touch the same file.

### Files to touch
- `src/lib/scoping/scoped-query.ts:84-92` — restructure the branches:
  ```
  if (admin) return null
  if (scopes.length === 0) throw new Error('User has no scopes — cannot query analytics')
  ```
  This collapses the internal/external branches into a single 0-scope guard.
- `src/lib/scoping/scoped-query.ts:139-159` (`scopedSalesCondition`) — wrap `db.select(...)` lookup in `React.cache` so multiple `build*Where` calls within one request only hit `userScopes` once.
- `src/lib/scoping/scoped-query.test.ts` — add cases: (a) internal viewer with 0 scopes → throws; (b) internal admin with 0 scopes → returns null (unrestricted); (c) internal viewer with 1 scope → returns IN clause.
- All page-level callers that catch errors should propagate this — verify `src/app/(app)/analytics/*/page.tsx` handle it gracefully (display "User not provisioned" not a generic 500).

### Acceptance criteria (testable)
1. Unit test passes: `buildScopeFilter({userType:'internal', role:'viewer'}, [])` throws.
2. Unit test passes: `buildScopeFilter({userType:'internal', role:'admin'}, [])` returns `null`.
3. A real internal-viewer with zero rows in `userScopes` hitting `/analytics/portfolio` sees a clear "no scopes provisioned" error, NOT global portfolio data.
4. `console.log` in `scopedSalesCondition` shows ONE userScopes query per request even when 5 dashboards call it.

### Dependencies
- Depends on: none.
- Blocks: nothing.

### Risk / blast radius
This is the smallest, highest-security PR. Risk: internal viewers/members provisioned without scopes get a hard error today. Mitigation: ship a follow-up admin-UI surface that flags users with zero scopes before pushing this — OR ensure all current internal users have at least one scope row (audit query: `SELECT u.id, u.email FROM "user" u WHERE u.user_type='internal' AND u.role <> 'admin' AND NOT EXISTS (SELECT 1 FROM user_scopes WHERE user_id = u.id)`).

**Open question**: The audit lists 0 known internal-non-admin users with 0 scopes today (worth verifying on prod before merge). If any exist, ship the admin-UI surface first.

### Estimated size
S (under 100 LoC including tests).

### Branch suggestion
`gsd/p1-7-scope-zero-deny`

---

## Task 1.8 — Validate URL filter params with Zod

**Source decision**: Pure correctness — audit P1 catalogues that crafted URLs (e.g. `?hotels=evil-uuid`) reach SQL and Postgres bombs with `invalid input syntax for type uuid`, exposing internals. Validate at the parser.
**Phase 1 task ref**: 1.8 in tasks/todo.md

### What this PR does
Adds Zod schemas to `searchParamsToFilters`. UUIDs are validated as UUIDs; `maturity` is whitelisted against the new 5-bucket set; `mode` against `['sales','revenue']`; `dateRange` validated as parseable dates. Invalid params are dropped silently (or surfaced via a small client-side toast — TBD).

### Files to touch
- `src/lib/stores/analytics-filter-store.ts:185-229` — replace the manual `params.get(...).split(',')` blocks with Zod parses. Schema: `z.object({ hotels: z.array(z.string().uuid()).optional(), … })`.
- `src/lib/analytics/__tests__/parse-filters-from-search-params.test.ts` — extend with negative cases: `?hotels=not-a-uuid` → empty filter, no throw; `?maturity=00-1mo` → empty filter (after 1.4 lands the whitelist).
- `package.json` — Zod is already a dep (verify).

### Acceptance criteria (testable)
1. `searchParamsToFilters(new URLSearchParams("?hotels=not-a-uuid"))` returns `{}` (no `hotelFilter` set), no throw.
2. `searchParamsToFilters(new URLSearchParams("?hotels=" + valid_uuid))` returns `{hotelFilter: [valid_uuid]}`.
3. Manually visiting `/analytics/portfolio?hotels=foo` no longer 500s — page renders with no hotel filter applied.
4. New tests pass; existing `parse-filters-from-search-params.test.ts` still passes.

### Dependencies
- Depends on: 1.4 (whitelist for `maturity` chips needs the 5-bucket set as the source of truth).
- Blocks: nothing.

### Risk / blast radius
Tiny. Pure parser-layer hardening. Risk: a legitimate URL using a non-UUID location id (test environment) gets dropped silently. Mitigation: validate against UUID v4 specifically; document.

### Estimated size
S (under 100 LoC).

### Branch suggestion
`gsd/p1-8-zod-url-filters`

---

## Task 1.9 — Region-scoped outlet exclusions

**Source decision**: Pure correctness — audit P1 #11. With AU added (PR #26), an `outlet_exclusions` row for outlet code `Q5` strikes every region's `Q5`. Since `outletCode` is `(region_id, outlet_code)` unique, the exclusion must scope by region too.
**Phase 1 task ref**: 1.9 in tasks/todo.md

### What this PR does
1) Adds `region_id` (nullable; NULL = "all regions" for backwards-compat) to `outlet_exclusions`.
2) Updates `getActiveLocationIds` and `buildExclusionCondition` to match `(outlet_code AND (region_id IS NULL OR region_id = locations.primary_region_id))`.
3) Updates the admin UI to require a region picker on new exclusion rules (existing rows default to NULL = global).

### Files to touch
- `migrations/0029_outlet_exclusions_region_id.sql` — **new**. `ALTER TABLE outlet_exclusions ADD COLUMN region_id uuid NULL REFERENCES regions(id)`. Update unique constraint: `UNIQUE (outlet_code, pattern_type, region_id)`.
- `src/db/schema.ts:754-772` — add `regionId: uuid('region_id').references(() => regions.id)` and update the unique tuple.
- `src/lib/analytics/active-locations.ts:34-46` — extend the `NOT EXISTS` clause to match region scoping (compare `oe.region_id IS NULL OR oe.region_id = locations.primary_region_id`).
- `src/lib/analytics/queries/shared.ts:15-30` (`buildExclusionCondition`) — same change. (Audit notes this helper is now dead code — confirm via `grep` and consider deleting; either way fix it for correctness.)
- `src/app/(app)/settings/outlet-exclusions/actions.ts` — add `regionId` to the create/list payloads; existing rows return NULL.
- `src/app/(app)/settings/outlet-exclusions/page.tsx` (or whatever the UI page is) — add a region picker; default to "All regions" (NULL).
- `src/lib/analytics/__tests__/active-locations.test.ts` (created in 1.1) — add region-scoped exclusion case.

### Acceptance criteria (testable)
1. Migration adds the column without breaking existing rows; existing exclusions remain effective globally (region_id NULL).
2. Adding an exclusion for `outletCode='Q5', regionId=AU` excludes only the AU `Q5`, not the GB `Q5` (unit test against seeded fixtures).
3. The admin settings page renders a region picker and the listing shows "All regions" or the named region per row.
4. `getActiveLocationIds()` correctly excludes the right `Q5` and includes the other.

### Dependencies
- Depends on: 1.1 (extends the same `getActiveLocationIds` helper; smaller diffs if landed sequentially).
- Blocks: nothing.

### Risk / blast radius
Schema additive + nullable, safe. The settings UI change is the user-facing risk — verify the existing exclusion rules still display sensibly (region column shows "All").

### Estimated size
M (100–300 LoC across migration, schema, helper, action, UI, test).

### Branch suggestion
`gsd/p1-9-region-scoped-exclusions`

---

## Suggested PR sequence

PR-1 (land first, in parallel): **1.6 (Pivot schema drift)** AND **1.7 (zero-scope safety)**. Both are independent of every other Phase 1 task. 1.6 unbreaks a 500'ing page; 1.7 closes a silent over-permission. Neither blocks anything else.

PR-2: **1.1 (archived-location filter)**. Single-line SQL change with the largest correctness blast radius. Land before 1.5 so re-validation of membership dedupe runs against the post-archive cohort.

PR-3: **1.2 (reversal columns + ingest)**. Schema + parser + helper. Adds the building blocks 1.3 needs. KPIs unchanged in this PR.

PR-4: **1.3 (fee + COUNT(*) sweep)**. The single biggest cascade. Renames `is_booking_fee` → `is_weknow_fee`, introduces `buildSalesTxnCondition()`, audits every COUNT(*). Lands after 1.2 because it consumes `is_reversal`.

PR-5: **1.4 (5-bucket maturity)** AND **1.8 (Zod URL validation)** in parallel. 1.4 also lays the groundwork for 1.8's whitelist. Independent of 1.1–1.3.

PR-6: **1.5 (membership dedupe)** AND **1.9 (region-scoped exclusions)** in parallel. Both are migrations + helper updates. Neither blocks the other; both depend on 1.1.

---

## Bundling opportunities

- **1.1 + 1.7**: both touch `active-locations.ts` / `scoped-query.ts` infrastructure with tiny diffs. Could co-PR if you want to ship the security + correctness fix together. Recommendation: keep separate so the security fix can be cherry-picked to a hotfix branch independently.
- **1.2 + 1.3** must be considered as a pair logically (D2 + D1/D10) — if you'd rather ship them together, the migration files (`0026_*` reversal cols, `0027_*` rename) can land in one commit so the schema lands atomically. Splitting helps blast-radius mitigation; bundling helps correctness coherence. Recommendation: split into two PRs but on the **same** branch base, merge in lock-step.
- **1.4 + 1.5** both touch `analytics-filter-store.ts` / dashboard rendering. Can land independently but coordinate the 5-bucket constant + the region/group dedupe so the FilterBar UI is updated once.
- **1.6 + the 7.3 task** (`EDITABLE_LOCATION_FIELDS` removal of `region`) overlap on the same constant in `actions.ts:209-239`. Pull the 7.3 deletion into 1.6 since the fix is a single-line edit and the file is open.
- **1.5 + 1.9**: both add migrations under `migrations/0028_*` and `0029_*`. If both land in one PR cycle, sequence them numerically to avoid renumbering churn.

---

## Cross-cutting open questions for the controller — RESOLVED 2026-04-26

1. **D2 backfill scope** — RESOLVED: **YES, rewrite all**. One-time backfill against historical sales_records (94k rows) sets `is_reversal`, `original_record_id`, `processed_at_location_id` retroactively. Lands as part of PR-3 (Task 1.2).
2. **Refund refNo grammar** — RESOLVED via prod probe. The `-b` / `-c` suffixes are **fee-companion markers** (NetSuite 9991 / 9992), NOT reversal markers. All 45,621 `-b` and 2,040 `-c` rows are POSITIVE-amount fee rows. Refunds are plain negative-amount rows sharing the SAME `ref_no` as the original. Matching: `WHERE refund.net_amount < 0` for the refund; `original = sales_records WHERE ref_no = refund.ref_no AND net_amount > 0 AND ABS(net_amount) = ABS(refund.net_amount)`. Bonus finding: fee rows are NEVER refunded (zero negative-amount `-b`/`-c` rows), so cancelling a booking nets the underlying sale to £0 but leaves WKG fee revenue intact — matches D2's "Cancellations doesn't reduce revenue-mode revenue" semantics.
3. **D5 region dedupe** — RESOLVED: **(a) keep composite PK + add UNIQUE(location_id)**. Layer the new constraint; don't replace the PK.
4. **1.7 prereq** — RESOLVED via prod probe + implementation: only ONE at-risk account = `etl-system@internal.weknowgroup.com` (id `00000000-0000-0000-0000-000000000001`). Implemented in PR-1: introduced `role='system'`, promoted ETL user, throw fires for `internal && !admin && !system && scopes.length === 0`.
5. **1.8 invalid-param UX** — RESOLVED: **toast/banner explaining what was ignored**. Saved bookmarks may have stale UUIDs; users should see what was filtered out. Use whichever pattern the project already has (likely sonner / react-hot-toast).
