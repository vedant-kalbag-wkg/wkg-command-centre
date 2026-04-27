# Cross-Cutting Analytics Infrastructure — Logic & Audit

Scope: shared helpers used by every analytics dashboard. Files audited:
- `src/lib/analytics/queries/shared.ts`
- `src/lib/analytics/active-locations.ts`
- `src/lib/analytics/metrics.ts`
- `src/lib/analytics/thresholds.ts`
- `src/lib/analytics/types.ts`
- `src/lib/scoping/scoped-query.ts`
- `src/lib/stores/analytics-filter-store.ts`
- `src/lib/csv/sales-csv.ts`
- `src/db/schema.ts` (relevant portions)

A note on naming: there is **no `buildPortfolioWhere` in `shared.ts`**. Each dashboard query module declares its own private `buildPortfolioWhere` / `buildHeatMapWhere` (see `portfolio.ts:42`, `heat-map.ts:68`). The shared building blocks live in `shared.ts`; the cross-cutting "active locations" predicate lives in `active-locations.ts`; scope (RBAC) lives in `scoping/scoped-query.ts`.

---

## Helper: `combineConditions(conditions)`
**File:** `src/lib/analytics/queries/shared.ts:159-164`
### Logic
- Filters `undefined` out of input array.
- Returns `undefined` if 0 valid; the single SQL if 1; `sql.join(valid, " AND ")` if 2+.
- All composition is **AND** — there is no helper that ORs filters.
### Used by
Every per-dashboard `build*Where` function (portfolio, heat-map, hotel-groups, location-groups, regions, comparison, experiments, high-performer-analysis, location-revenues, maturity-analysis, pivot, trend-series).
### Issues
- **P3** — Returning `undefined` for "no conditions" is correct, but callers must remember to guard `WHERE ${whereClause}` with a ternary. Most do (`portfolio.ts:289`, `heat-map.ts:112`), but inconsistency raises risk.

---

## Helper: `buildDateCondition(filters)`
**File:** `shared.ts:32-34`
### Logic
```sql
sales_records.transaction_date >= filters.dateFrom
AND sales_records.transaction_date <= filters.dateTo
```
- `dateFrom` / `dateTo` are bare `string`s with no validation — the helper assumes the caller supplies `YYYY-MM-DD`.
- The bounds are **inclusive** on both ends. Matches the column type (`date`, midnight UTC). Good.
### Used by
Every `build*Where` (portfolio, heat-map, etc.).
### Issues
- **P2** — No validation that `dateFrom <= dateTo`. If the URL or caller swaps them, every query returns 0 rows silently. Recommend a guard or assertion.
- **P3** — `transactionDate` is `date` but `transactionTime` is separate. The current design treats every transaction as belonging to the calendar day of `transactionDate`, regardless of timezone. That is fine, but the filter store uses `endOfDay(date)` (`23:59:59.999`) and `toLocalISODate()` to drop into `YYYY-MM-DD`. Two different formats coexist in code; if a caller ever passes `dateTo = "2026-01-31T23:59:59"` to this helper, Postgres will silently coerce. Recommend a normalization step.

---

## Helper: `buildIsFeeCondition()` / `buildNonFeeCondition()`
**File:** `shared.ts:45-59`
### Logic
- `IsFee`: `(is_booking_fee = true OR netsuite_code IN ('9991','9992'))`.
- `NonFee`: `NOT (is_booking_fee = true OR netsuite_code IN ('9991','9992'))`.
- Uses **OR** — correct. A row matching either signal is a fee row.
- Hard-codes the netsuite codes here AND in `FEE_NETSUITE_CODES`. The two never reference each other in SQL — `FEE_NETSUITE_CODES` is exported but never imported by these two helpers.
### Used by
- `IsFee`: `portfolio.ts` (top products revenue mode), `trend-series.ts` (booking_fee metric), `high-performer-analysis.ts`.
- `NonFee`: `portfolio.ts` (top products sales mode).
- `buildMetricModeCondition` calls `IsFee` only.
### Issues
- **P2** — Magic-string duplication. The codes `'9991'`, `'9992'` are written inline at `shared.ts:46` and `shared.ts:58`, while `FEE_NETSUITE_CODES` is exported but **unused inside the SQL**. A future fee code added to `FEE_NETSUITE_CODES` (`shared.ts:40`) will silently NOT take effect in `IsFee`/`NonFee`/`buildMetricModeCondition`/the LATERAL join in `portfolio.ts:219`. Recommend `sql.raw` from the constant or interpolate.
- **P3** — `NOT (a OR b)` is correct in 3-valued logic for non-NULL columns. Both columns are NOT NULL (`schema.ts:660-661`), so this is safe. Document the invariant.

---

## Helper: `buildMetricModeCondition(filters)`
**File:** `shared.ts:51-53`
### Logic
```ts
filters.metricMode === "revenue" ? buildIsFeeCondition() : undefined
```
- Default behavior — when `metricMode` is `undefined`, `null`, or `"sales"` — adds **no** predicate. Every row counts including fee rows.
- The store default is `"sales"` (`analytics-filter-store.ts:129`). URL parser only sets `metricMode` when present (`analytics-filter-store.ts:225-227`).
### Used by
Every per-dashboard `build*Where`.
### Issues
- **P1 — Documented but surprising** — In sales mode (default), fee rows are counted in `COUNT(*)` of transactions. A property with 100 sales emits 100 base rows + 100 booking-fee rows + (sometimes) 100 cash-handling-fee rows ⇒ COUNT() reports 200–300, not 100. This is the source of the well-known double/triple-count in transaction totals across every "sales mode" dashboard (`getPortfolioSummary`, daily trends, hourly distribution, heat-map composite score, etc.). The chosen contract is "sales = every row"; only `getTopProducts` actively excludes fee rows via `buildNonFeeCondition`. Other dashboards do not. **Cross-reference:** any dashboard reporting a transaction count in sales mode is overstating.
- **P2** — No type-narrowing on `metricMode`. If a stale client somehow passes `"foo"`, the `=== "revenue"` check yields `false` and we silently fall back to "sales" with no warning. Not exploitable but masks bugs.

---

## Helper: `buildDimensionFilters(filters)`
**File:** `shared.ts:61-110`
### Logic
- Pushes a separate condition per non-empty dimension array — `productIds`, `hotelIds`, `hotelGroupIds`, `regionIds`, `locationGroupIds`, `locationTypes`.
- Returns `SQL[]`, then the caller spreads into `combineConditions` ⇒ all dimensions **AND**ed (intersection). Correct.
- Each dimension uses `IN` or a sub-`SELECT IN`. For the membership tables, this is a correlated subquery on `salesRecords.locationId`.
- `locationTypes` filter is `WHERE location_type IN (...)` against `locations`. **NULL `location_type` is silently excluded.**
### Used by
Every per-dashboard `build*Where`.
### Issues
- **P1 — `locationTypes` filter excludes NULL silently.** The schema explicitly allows NULL on `locations.location_type` (`schema.ts:195`, comment "NULL means 'not yet categorised'"). When a user picks any combination of types, all unmapped locations vanish from results. Two failure modes:
  - User picks `["hotel"]` expecting "hotels only" — gets only locations explicitly tagged `hotel`. Unmapped locations that are de-facto hotels are silently dropped.
  - User picks every `LOCATION_TYPE` value — still excludes NULL. A "select all" UX cannot reproduce "no filter".
  Recommend either documenting this OR adding `OR location_type IS NULL` for the "all types" case, OR forcing every location to have a type at the data layer.
- **P2 — `productIds` filters by `salesRecords.productId` only.** If a user wants "all rows that *also* sell product X at the same location", this is the wrong predicate (it filters by per-row product, not per-location product affinity). Today no UI uses it that way, but the helper name is generic enough to mislead.
- **P2 — Duplicate location membership.** `hotelGroupIds`, `regionIds`, `locationGroupIds` use `IN` against membership tables. A location belonging to multiple groups will not be double-counted at the row level (each row maps to one location), but the helper joins via `IN`, so behaviour is correct here. However: if `hotelGroupIds` AND `regionIds` are both set, the AND yields the **intersection of locations belonging to BOTH a selected hotel group AND a selected region**. This is correct, but is not what some users may expect ("show me everything in either"). Document the AND-semantics.
- **P3 — Subquery vs JOIN performance.** Sub-SELECT-IN is repeated for each dimension. Postgres' planner is usually smart enough, but for a query with all 6 dimensions set the planner sees 6 IN-subqueries on `salesRecords.locationId`. No EXPLAIN was run; flag for perf review.

---

## Helper: `kioskLiveDateSubquery`
**File:** `shared.ts:117`
### Logic
```sql
(SELECT MIN(kiosk_assignments.assigned_at)
   FROM kiosk_assignments
   WHERE kiosk_assignments.location_id = locations.id)
```
- **MIN per location** (across all kiosks ever assigned). The earliest ever assignment date wins. **Correct** per the docstring ("first time any kiosk was assigned").
### Used by
- `buildMaturityCondition` (`shared.ts:133-149`).
- `heat-map.ts`, `portfolio.ts`, `high-performer-analysis.ts` — all SELECT it as `live_date`.
### Issues
- **P2 — Re-assignment edge case.** If a location's first kiosk was a week-long pilot in 2023 that was later removed, then a permanent kiosk arrived in 2025, this subquery returns the **2023 date**. The docstring acknowledges "regardless of whether it's still active". Whether that is the right contract for "maturity" is debatable: a property whose original kiosk was removed for 18 months is reported as "6+ months mature" today. Flag for product clarification.
- **P3 — Unindexed correlated subquery.** Per location row this fires once. There IS a `kiosk_assignments_loc_assigned_idx` on `(location_id, assigned_at)` (`schema.ts:243`), so MIN should be cheap.
- **P3 — Requires `locations` to be in scope.** The subquery references `locations.id` literally. Any caller using `salesRecords` only (no `INNER JOIN locations`) cannot use this fragment. Today every consumer JOINs `locations`.

---

## Helper: `buildMaturityCondition(filters)`
**File:** `shared.ts:119-157`
### Logic
- If `filters.maturityBuckets` is empty/undefined → returns `undefined` (no filter, all rows). Correct.
- Reference date: `filters.dateTo::timestamp` — **uses dateTo, not NOW()**. The f374da7 fix is applied here, comment confirms it (`shared.ts:123-124`).
- Buckets:
  - `0-1mo`: `kioskLiveDate >= dateTo - 1 month`
  - `1-3mo`: `[dateTo-3mo, dateTo-1mo)`
  - `3-6mo`: `[dateTo-6mo, dateTo-3mo)`
  - `6+mo`: `kioskLiveDate < dateTo - 6 months`
- Multiple buckets are **OR**ed.
### Used by
Every per-dashboard `build*Where`.
### Issues
- **P0 — `kioskLiveDate IS NULL` locations silently excluded from EVERY bucket.** A location with zero `kiosk_assignments` rows resolves the subquery to `NULL`. `NULL >= ... - 1 month` is NULL ≠ TRUE. So such locations are filtered OUT of every bucket — including `6+mo` (which one might think should "include unknowns"). When a user picks any maturity bucket, they lose all locations that have never been assigned a kiosk. This is sometimes desired (you cannot bucket a never-live location) but it is **not documented and yields silent under-counts**. Combined with the existing data-quality issue that some real locations lack assignment history, this is high-impact.
- **P1 — Unbounded "0-1mo" bucket.** The `0-1mo` clause uses only `>=`, no upper bound. If a location's first assignment is in the **future** (assigned_at > dateTo), it still matches `0-1mo`. Future-dated assignments will be rare but not impossible (calendaring data, demo records). Recommend `kioskLiveDate >= dateTo - 1mo AND kioskLiveDate <= dateTo`.
- **P1 — Bucket boundaries depend on date arithmetic that is timezone-sensitive.** `dateTo` is a `YYYY-MM-DD` string cast to `timestamp` ⇒ midnight in server timezone. `INTERVAL '1 month'` does calendar arithmetic, not exact 30 days. The boundaries `[dateTo-3mo, dateTo-1mo)` shift between months of different lengths. Probably acceptable, but document; the test suite must cover Feb 28 → Jan 28 vs Mar 28 cases.
- **P2 — `dateTo` is `string`, not `Date`.** No sanitization before `::timestamp`. SQL injection is blocked by parameter binding, but a malformed date silently fails the cast and returns `NULL` ⇒ all bucket conditions become `NULL` ⇒ every location is excluded from every bucket. If `dateTo === ""`, every dashboard with any maturity filter is empty. Add a guard.
- **P2 — Bucket-string typed as `string[]`.** The `switch` falls through silently on unknown values — no error, no warning. A typo in the URL (`?maturity=00-1mo`) yields no condition and an empty `bucketConditions` array, hence `undefined` (no filter) — **not** an error. The user thinks they filtered; they did not.
- **P3 — Per-row subquery, no caching.** `kioskLiveDateSubquery` fires per outer location. Postgres can't easily de-dup it across multiple bucket conditions in the same query (each bucket has its own `>=` / `<` predicate referencing the subquery). Three bucket selections ⇒ three correlated MIN scans per row. Acceptable today; flag for perf if this expands.

---

## Helper: `canonicalHotelGroupNameFragment()`
**File:** `shared.ts:187-200`
### Logic
- Returns `COALESCE(operator-from-locations, MIN(membership-by-id))`.
- Step 1: `hotel_groups.name WHERE id = locations.operating_group_id`.
- Step 2: `hotel_groups.name` joined to `MIN(hotel_group_id)` via `location_hotel_group_memberships`, ordered by `hotel_group_id`, `LIMIT 1`.
- Falls through to `NULL` if both subqueries return nothing.
### Used by
- `portfolio.ts` (outlet tiers — `getOutletTiers`).
- `heat-map.ts`.
- `high-performer-analysis.ts`.
- Imported in `shared.ts` and consumed wherever per-property hotel-group resolution is needed.
### Issues
- **P1 — Tie-break is by UUID lexicographic order.** Deterministic per-row, but **not aligned with any human concept**. If a property is in groups "Hilton" and "Accor" and "Hilton"'s UUID happens to be lower, the property is forever labelled "Hilton". The docstring concedes this is "arbitrary but deterministic". Risk: customer surprise when a hotel they think of as Accor is shown under Hilton in a tier table. Recommend ordering by `hotel_groups.name` instead, or by `created_at`, both of which are stable and human-defensible.
- **P2 — Different SQL across queries.** The fragment is a CORRELATED subquery emitted twice in `getOutletTiers` (once for SELECT, once for GROUP BY). Each invocation re-runs the subquery; Postgres caches results per-row in CTEs but not always for repeated correlated subqueries. Recommend using a CTE or `LATERAL JOIN` in heavy consumers.
- **P2 — Determinism only within a single query.** If `location_hotel_group_memberships` is mutated mid-session (admin edit), the canonical name flips. Across two API calls minutes apart, the UI may render two different group labels for the same hotel. Document this or cache memberships.
- **P3 — Operating-group only checked at the locations row.** A location with `operating_group_id = 'X'` returns "X" even if no membership row links the location to X (the two are separate concepts). Slightly orthogonal but worth noting — `operating_group_id` is purely the canonical-name source, not a membership.

---

## Helper: `activeKioskCountFragment()`
**File:** `shared.ts:207-214`
### Logic
```sql
(SELECT COUNT(*)::int FROM kiosk_assignments
  WHERE location_id = locations.id AND unassigned_at IS NULL)
```
### Used by
Heat-map, portfolio outlet tiers, high-performer-analysis.
### Issues
- **P3 — No filter on archived kiosks.** If a kiosk's row in `kiosks` is `archivedAt IS NOT NULL` but its assignment row still has `unassigned_at IS NULL`, the count includes a phantom kiosk. Out of scope for this helper, but flag to the assignment lifecycle audit.

---

## Helper: `buildExclusionCondition()`  *(legacy, still exported)*
**File:** `shared.ts:15-30`
### Logic
- Synchronous DB read on `outletExclusions`.
- Builds a `NOT (... OR ...)` condition over `locations.outletCode`.
- Requires `locations` table in scope.
### Used by
Nobody in `src/lib/analytics/queries/*.ts` per grep — every query has migrated to `buildActiveLocationCondition`. The function remains exported but appears unused.
### Issues
- **P3 — Dead code.** Unused as of Phase 1 #6 migration. Recommend deleting to avoid an old caller accidentally re-introducing the JOIN-based path.

---

## Helper: `buildActiveLocationCondition()` / `getActiveLocationIds()` / `buildActiveLocationConditionForRawContext()`
**File:** `src/lib/analytics/active-locations.ts`
### Logic
- `getActiveLocationIds()` is `React.cache`'d — runs once per request. Returns every `locations.id` whose `outlet_code` is NOT matched by any `outlet_exclusions` row (exact or regex).
- `buildActiveLocationCondition()`: `sales_records.location_id = ANY($ids::uuid[])`. If the active list is empty, returns `sql\`FALSE\`` (intentional zero-row guard).
- `buildActiveLocationConditionForRawContext()`: same semantic but emits `IN ($1, $2, ...)` for the pivot path that string-replaces parameters.
- **Does NOT filter by `archivedAt`.** Archived locations are still considered "active" by this helper. Only the `outlet_exclusions` rules drive the exclusion list.
### Used by
Every per-dashboard `build*Where`.
### Issues
- **P0 — Archived locations are NOT excluded from analytics.** `getActiveLocationIds()` ignores `locations.archivedAt`. The schema has `archivedAt` (`schema.ts:214`), location admin pages use `isNull(locations.archivedAt)` to filter (`actions.ts:341`, `bulk-actions.ts:67`, etc.), but analytics treats archived hotels exactly like live ones. Implications:
  - Archive a hotel today — its 2024 sales still appear in YTD revenue.
  - More subtle: the archived hotel still shows up in tier tables with the "active kiosk count" subquery returning `0`, yielding `revenuePerKiosk = NULL` and a misleading "Emerging" classification for what should be a removed property.
  This is the most important systemic issue in this audit. The intended behavior must be made explicit:
    - "Include historical sales from archived hotels?" — defensible YES (you sold those things) but should be opt-in.
    - "Include archived hotels in tier/heat-map outputs?" — almost certainly NO (they distort percentile calculations).
  Today both are silently YES.
- **P1 — `outlet_exclusions` and `archivedAt` are unrelated mechanisms but sound similar.** Admins archiving a location may assume analytics will hide it; they have to also add an `outlet_exclusions` row, which is non-obvious. Plus the docstring on `archivedAt` doesn't mention analytics behaviour.
- **P2 — Cache invalidation.** `React.cache` is per-request. If `outlet_exclusions` is mutated mid-session, the next request sees the change. But within a request, an admin's "add exclusion → see updated metrics" flow may show stale data on a page that batches multiple analytics calls — they'd all see the pre-mutation cache. Document or invalidate.
- **P2 — `sql\`FALSE\`` empty-state semantics differ from `undefined`.** When `outlet_exclusions` matches every location (admin error), every dashboard returns 0 rows. That is correct, but the UI has no way to distinguish "no data" from "all locations excluded". A diagnostic surface (admin-only banner) would help.

---

## Helper: `scopedSalesCondition(db, user, options?)`
**File:** `src/lib/scoping/scoped-query.ts`
### Logic
- Reads `userScopes` rows for the resolved user.
- Calls `buildScopeFilter` (pure):
  - `userType='internal' AND role='admin'` → `null` (no filter, unrestricted).
  - `userType='internal'` (member/viewer) AND 0 scopes → `null` (no filter).
  - `userType='external'` AND 0 scopes → **THROWS**.
  - Multiple scopes same dimension → IN().
  - Multiple scopes across dimensions → OR (union).
- Translates per-dimension to either direct `IN` (`location`, `product`, `provider`) or membership-table sub-`IN` (`hotel_group`, `region`, `location_group`).
### Used by
Every per-dashboard `build*Where`.
### Issues
- **P0 — Internal viewer/member with zero scopes sees EVERYTHING.** `scoped-query.ts:92` `if (scopes.length === 0) return null;` for internal users. An internal viewer who was provisioned without any scopes (a forgotten admin step) is treated identically to an admin. This silently grants global read on every analytics surface. Compare to the explicit `external + 0 scopes → throw` branch — internal users should ideally throw too (or at least default-deny). Cross-reference with the auth/RBAC audit.
- **P1 — Conflicting cross-dimension scopes are OR'd, not AND'd.** A user with `region=UK` AND `hotel_group=Hilton` sees `(locations in UK) OR (locations in Hilton)`. If "Hilton" includes US hotels, the user sees those US hotels. Likely the intent is "either qualifier admits the location"; that is the documented contract (`scoped-query.ts:13-14`), but admins may set up scopes thinking AND. **Document loudly in the admin scopes UI.**
- **P1 — `userScopes` is read on every analytics call.** No caching at this layer (compare with `getActiveLocationIds` which uses `React.cache`). For a user with 100s of scopes (large hotel chain admin), this is a hidden N+1 — every `build*Where` calls `scopedSalesCondition`, which re-reads `userScopes`. Recommend wrapping in `React.cache`.
- **P2 — Impersonation is opt-in.** Default `honorImpersonation=false`. Most callers pass no options ⇒ impersonation is ignored. Audit callers to confirm intentional.
- **P2 — `userType` and `role` are duck-typed `'internal'|'external'`/`'admin'|'member'|'viewer'|null`.** A `null` role on internal user silently falls through (not `==='admin'`) ⇒ goes to the `if (scopes.length === 0) return null` branch. A null-role internal user with 0 scopes is unrestricted. Tighten the type contract.
- **P3 — `eq(userScopes.userId, user.id)` always uses the resolved user (impersonator-aware), but the docstring says "for the resolved user" — verified correct.

---

## Helper: `getComparisonDates(dateFrom, dateTo, mode)` and `getPreviousPeriodDates(dateFrom, dateTo)`
**File:** `src/lib/analytics/metrics.ts:13-46`
### Logic
- **MoM** (mode `"mom"`):
  - Duration = `to - from + 1 day` (inclusive both ends, so add a day).
  - `prevTo = from - 1 day`.
  - `prevFrom = prevTo - duration + 1 day`.
  - Yields a same-length window immediately preceding `[from, to]`.
- **YoY** (mode `"yoy"`):
  - Naive `setFullYear(year - 1)` on both ends.
  - **Leap-year handling: NONE.** `new Date('2024-02-29').setFullYear(2023)` produces `2023-03-01` in JS (date overflow, not fallback to `2023-02-28`).
### Used by
Comparison cards, daily-trend YoY overlay, all "previous period" change indicators in `portfolio.ts`, `comparison.ts`, `heat-map.ts`, `hotel-groups.ts`, `regions.ts`, `location-groups.ts`.
### Issues
- **P1 — Leap-year wrap-around bug for YoY.** Pick a date range covering Feb 29 of a leap year. `setFullYear(year-1)` rolls over: Feb 29, 2024 → Mar 1, 2023. The "previous year" window thereby starts/ends one day later than expected. Corruption is small but real, and the change-percentage cards show a value that does not correspond to any visible date label. Recommend explicit leap-day fallback.
- **P1 — YoY is calendar-shifted, not duration-matched.** A range like `Feb 1 - Feb 28` (28 days) becomes `Feb 1 - Feb 28` last year (also 28 days) — fine. But `Mar 1 - May 31` (92 days) becomes `Mar 1 - May 31` last year (also 92 days, no leap day) — fine. However, comparing `Feb 1 - Feb 29 2024` (29 days) becomes `Feb 1 - Mar 1 2023` (29 days but spanning two months) — the comparison mixes Feb and Mar last year. Document or special-case.
- **P1 — Different month lengths bias raw totals in MoM.** Comparing Feb 1-28 (28 days) to Jan 4-31 (28 days, prev period) is fine — duration matched. But the user's mental model is often "Feb vs Jan", not "Feb 1-28 vs Jan 4-31". Both endpoints are correct per the duration-matching contract, but the labels say "previous period" without indicating "shifted by 28 days, not previous calendar month". Recommend a label that includes the actual prevFrom/prevTo dates.
- **P2 — Both helpers use `new Date(string)`.** For `'2026-02-01'`, JS parses as UTC midnight. `getDate()` then operates in local TZ ⇒ `setDate(getDate() - 1)` may roll back two days in some timezones. `toLocalISODate` is a separate helper that mitigates but is not used inside `getPreviousPeriodDates` for the offset arithmetic. The `getComparisonDates` YoY path uses `toISOString().split('T')[0]` — UTC, possibly off-by-one in the user's local TZ. Inconsistent: one helper uses `toLocalISODate`, the other UTC.
- **P3 — Off-by-one paranoia.** Inclusive bound math `+ 24*60*60*1000` for the duration is correct given inclusive `[from, to]`. Verified.

---

## Helper: `classifyOutletTier(percentile)`
**File:** `metrics.ts:97-102`
### Logic
- ≥80 → `Premium`
- ≥50 → `Standard`
- ≥20 → `Developing`
- else → `Emerging`
- Boundaries are **inclusive on the lower bound**.
### Used by
Outlet-tier table (`portfolio.ts:getOutletTiers`).
### Issues
- **P3 — Constants hard-coded inline.** Cannot be tuned without code change. There IS a settings-driven traffic-light pair (`thresholds.ts`) but no equivalent for the four-tier classifier. Recommend either move to settings or document hard-coding rationale.
- **P3 — `calculatePercentile` returns `(rank/n)*100` where rank counts `v<=value`.** A single value yields 100%. Two equal values both yield 100%. This means percentile=100 is over-counted when ties exist. Combined with `>=80`, ties at the median may all be classified `Premium`. Acceptable but flag.

---

## Helper: `classifyTrafficLight(revenue, config)`
**File:** `src/lib/analytics/thresholds.ts:8-15`
### Logic
- `revenue <= redMax` → `red`
- `revenue >= greenMin` → `green`
- otherwise → `amber`
### Used by
Heat-map ratings, high-performer/low-performer cards, dashboard widgets.
### Issues
- **P2 — Boundary case `revenue === redMax === 0`.** Defaults are `redMax: 500`, `greenMin: 1500`. If a location has revenue exactly 500 in the period, it is **red** (`<=`). Documented behaviour but inconsistent with intuition ("red = anything below 500"). Compare with `>=` for green: revenue exactly 1500 is **green**. Symmetry is good, but tag both as inclusive in the UI.
- **P3 — No validation that `redMax < greenMin`.** Validation lives in the actions layer (`thresholds/actions.ts:24`), not in `classifyTrafficLight`. If a settings row drifts, the function returns `red` for everything below `redMax` AND `green` for everything above `greenMin`, with the inversion silently producing wrong labels. Add a guard.

---

## Helper: `calculateCompositeScore`, `calculateRevenuePerRoom`, `calculateTxnPerKiosk`, `calculateAvgBasketValue`, `calculatePeriodChange`, `calculatePercentile`
**File:** `metrics.ts`
### Logic
- All are pure JS. Standard div-by-zero guards return `null`.
- `calculatePeriodChange(current, 0)` → `null`. Correct.
- `calculateCompositeScore` weights are auto-rebalanced when a metric is null (e.g. no rooms). Correct.
### Used by
Heat-map, hotel-groups, location-groups, every "change %" indicator.
### Issues
- **P3 — `calculateCompositeScore` returns `0` (not `null`) when every metric is null.** Heat-map composite of a brand-new location with no kiosk count, no rooms, and no fee rows could legitimately be `null`/uncomputable, but is reported as `0`. That value is then min-max normalized and may cause the location to render as "rock bottom". Recommend `null` semantics.
- **P3 — `calculatePercentile`: `<=` not `<`.** See note above; ties inflate percentile. Acceptable for tier-bucketing but worth documenting.

---

## Filter Store Audit (`analytics-filter-store.ts`)
### Logic
- Two stores: `useAnalyticsFilterStore` and `usePivotFilterStore` — independent state, both initialised with `getPresetRange("ytd")`. The pivot store explicitly mirrors the main store but is decoupled (so a pivot pin doesn't move the dashboard).
- Filter dimension keys (`hotelFilter`, ..., `locationTypeFilter`) are arrays of strings. Empty array → no filter on the SQL side (mapped to `undefined` in `storeStateToAnalyticsFilters`).
- `metricMode` defaults to `"sales"`.
- URL sync: `filtersToSearchParams` writes only non-empty filters and only writes `mode=revenue` when non-default. `searchParamsToFilters` reads and parses; only `locationTypeFilter` is whitelisted against `LOCATION_TYPES` — every other filter is taken verbatim from the URL.
### Issues
- **P1 — No whitelist on `hotelFilter`/`regionFilter`/`productFilter`/`hotelGroupFilter`/`locationGroupFilter`/`maturityFilter`.** A hand-crafted URL with `?hotels=evil-uuid,'%20OR%201=1` is split on `,` and passed as-is to the SQL layer. Drizzle parameter-binding mitigates SQL injection, but **invalid UUIDs hit the DB and the query bombs** with a Postgres `invalid input syntax for type uuid`. The query throws, the dashboard shows a generic error. Two fixes: validate UUID format in `searchParamsToFilters`; or wrap `executeRows` to translate.
- **P1 — `maturityFilter` from URL is unbounded.** Any string passes through. `buildMaturityCondition` silently drops unknown buckets via the `switch` (see above). Recommend whitelist.
- **P2 — `dateRange` from URL is `new Date(string)`.** Invalid string → `Invalid Date` → `toLocalISODate(invalid)` returns `'NaN-aN-aN'` (or similar) → the SQL helper sends junk to Postgres → query fails. Add a guard.
- **P2 — `locationTypeFilter` whitelist is inconsistent with other dimension filters.** Only the type filter is validated. Either validate all or document why types are special.
- **P2 — Pivot store and main store are independent BUT both initialise to "ytd".** A user landing on `/analytics/pivot` after a heavy day on `/analytics` finds pivot reset to YTD. UX issue, not correctness, but worth flagging.
- **P3 — `clearAllFilters` resets dateRange to YTD too.** "Clear" is ambiguous — does it clear filters only or filters + dates? Today: both. Document.

---

## CSV Parser Audit (`src/lib/csv/sales-csv.ts`)
### Logic
- `parseSalesCsv(text, opts)`. Header normalization is `lowercase + strip spaces/underscores` (`canonicalizeHeader`).
- Row validation produces `parsed: ParsedSalesRow | null` plus errors. Only valid rows go into `validCount`/min-max date.
- Required: `saleRef`, `refNo`, `outletCode`, `productName`, `transactionDate`, `netAmount`, `vatAmount`. `netsuiteCode` required UNLESS a `feeCodeFallbacks` entry exists for the productName.
- `isBookingFee`: **`productName === "Booking Fee"`** — exact, case-sensitive, no whitespace tolerance (after a `.trim()`, but trim is on `productName`, see below).
- `currency` defaults to `GBP` if missing.
- No reversal flag is set on the parsed row. `sales_records` schema has no `is_reversal` column — only `commission_ledger` does.
### Issues
- **P0 — `isBookingFee` boolean is set ONLY on exact-string `"Booking Fee"`.** `productName === "Booking Fee"` (`sales-csv.ts:179`). The trim in line 168 normalises whitespace, but **case is not normalised**. Variants observed in real CSVs:
  - `"booking fee"` (lower) — flag NOT set.
  - `"BOOKING FEE"` (upper) — flag NOT set.
  - `"Booking  Fee"` (double space) — `.trim()` does not collapse internal whitespace; flag NOT set.
  - `"Booking Fee "` / `" Booking Fee"` — `.trim()` removes leading/trailing whitespace before the equality check, so these match.
  - `" booking fee"` after trim → `"booking fee"` — flag NOT set.
  - Typos like `"Booking-Fee"`, `"Booking Fees"` — flag NOT set.
  Cash Handling Fee is **never** captured by `isBookingFee` per the docstring intent (`shared.ts:36-39`); it is intentionally relied upon to come in via `netsuite_code='9992'`. So the safety net is `buildIsFeeCondition`'s OR with `netsuite_code IN ('9991','9992')`. **HOWEVER**: the codes are populated from the CSV `Code` column, with the `feeCodeFallbacks` map fallback. If a CSV omits `Code` AND the productName is a typo'd "Booking fee" not in the fallback map, the row goes in with **no fee classification at all** (`isBookingFee=false`, `netsuite_code = ''` would be a validation failure ⇒ row rejected). The validation actually rejects, so the failure mode is "rows go to invalid bucket". That is safer than silent mis-classification.
  But for rows that *do* arrive with a valid netsuite code 9991 or 9992 from the source: the OR in `buildIsFeeCondition` handles them correctly regardless of `isBookingFee`. So the practical risk is: CSVs that report `Code = 9991` AND `productName = "booking fee"` (lower) ⇒ `isBookingFee=false`, but `IsFee` matches via the netsuite-code arm. That behaviour is correct for analytics; the data inconsistency itself is a smell. Recommend running:
  ```sql
  SELECT product_name, COUNT(*) FROM sales_records
  WHERE netsuite_code = '9991' AND is_booking_fee = false GROUP BY 1;
  -- and the inverse:
  SELECT product_name, COUNT(*) FROM sales_records
  WHERE netsuite_code != '9991' AND is_booking_fee = true GROUP BY 1;
  ```
  Either result returning >0 indicates CSV inconsistencies. Recommend the parser do a case-insensitive trim-collapse comparison: `productName.replace(/\s+/g, ' ').trim().toLowerCase() === 'booking fee'`.
- **P1 — No reversal detection.** `is_reversal` is not on `sales_records`. The CSV has no marker. Reversals are only inferable post-hoc by joining a row with a negative `netAmount` to its parent (matching `refNo` minus `-b`/`-r` suffix) or by detecting refNo suffix patterns. **Implication:** `COUNT(*)` over `sales_records` includes both originals AND reversals as separate rows. A pair of (original, reversal) yields count=2, sum=0. A user looking at "transactions" sees inflated counts. The portfolio dashboard makes no attempt to dedup. Cross-reference with portfolio audit.
- **P1 — No idempotency at row level.** `salesImports` is the unit of idempotency (per file blob). Re-importing the same logical CSV under a new file inserts duplicates. The parser does not dedup on `(saleRef, refNo, transactionDate)`. Out-of-scope for the parser but flag.
- **P2 — Header canonicalization is permissive.** `_` and ` ` are stripped — so `"Outlet Code"`, `"outletcode"`, `"outlet_code"` all map. Good. But `"OUTLET-CODE"` does not (hyphen not stripped). Real CSVs sometimes use hyphens. Recommend `[\s_-]`.
- **P2 — `parseDate` accepts `"DD-Mon-YY"` with a 2-digit year always interpreted as `20YY`.** A CSV from 2099 with `"01-Jan-99"` is interpreted as 2099. A CSV from year 2000 with `"01-Jan-99"` (legacy) is also 2099 — but should be 1999. Today nobody is importing 1999 data, but flag for the future.
- **P2 — `currency = "GBP"` default when missing.** A multi-region (incl. AU after PR #26) CSV that drops the currency column will silently coerce to GBP. The `pipeline.ts` should reject any row with a region that doesn't match the currency, but the parser itself shouldn't make that assumption. Recommend `null` default and let pipeline/region resolver decide.
- **P3 — `productName` validation only checks `!== ""`.** Whitespace-only after trim → empty, rejected. Good.
- **P3 — `netAmount` and `vatAmount` accept any signed decimal.** No bound check. A CSV row with `netAmount = "-9999999999"` is accepted. Numeric column is `(precision: 12, scale: 2)` ⇒ DB will reject if too large, but the failure surfaces as a DB error not a parse error.

---

## Schema Findings (analytics-relevant)
- **`locations.archivedAt`** exists but is NOT respected by the analytics filter chain. See `buildActiveLocationCondition` P0 above.
- **`sales_records.is_reversal` does NOT exist.** Reversals are inferable only via refNo suffix + opposite netAmount. Multiple downstream dashboards count them as legit transactions. Either add the column at parse time or document the convention loudly.
- **`locations.location_type`** is nullable. The dimension filter excludes NULL silently. See `buildDimensionFilters` P1.
- **`locations.outletCode` is no longer globally unique** — uniqueness is `(primaryRegionId, outletCode)`. `outlet_exclusions.outletCode` is a free-text column with no region scoping (`schema.ts:758`). An exclusion rule for `"Q5"` matches every region's `Q5`. **P1 cross-cutting:** if region AU and region GB both have an outlet `Q5`, an admin who excludes one excludes both. Recommend region-scoping `outlet_exclusions` (`outlet_exclusions.region_id` nullable + admin UI).
- **`sales_records.regionId` is propagated from `salesImports.regionId`** at parse time. Region is therefore an attribute of the import, not always of the location. If the same location ever appears in two regions' imports (data ingestion error), sales rows for the same outlet get split across regions. The `getTopProducts` revenue-mode query joins parent rows via `region_id = region_id` (`portfolio.ts:217`), which would fail to find the parent if the regions disagree. Probably won't happen in practice, but a data-quality monitor would help.
- **No table-level `outlet_exclusions` constraint vs `locations`.** An exclusion rule can be created for an outlet code that does not exist in `locations` ⇒ no error, no warning, no effect. Quietly polluted exclusions table. Recommend FK or admin validation.
- **`outlet_exclusions.patternType='regex'` invokes Postgres `~`** (`shared.ts:24`, `active-locations.ts:41`). Untrusted regex from an admin UI is a ReDoS vector. Document or limit pattern complexity.

---

## Top Systemic Issues (sorted by blast radius)

1. **P0 — Archived locations leak into every analytics dashboard** (`buildActiveLocationCondition` does not filter `archivedAt`). Affects: portfolio, heat-map, hotel-groups, regions, location-groups, comparison, experiments, high-performer-analysis, location-revenues, maturity-analysis, pivot, trend-series. Recommend adding `archivedAt IS NULL` to `getActiveLocationIds`'s WHERE clause OR making the choice explicit/configurable per dashboard.
2. **P0 — `buildMaturityCondition` silently drops locations with no kiosk_assignments rows from EVERY bucket.** Affects every dashboard whenever `maturityFilter` is applied.
3. **P0 — Internal users with zero scopes are unrestricted.** A provisioning bug yields silent global read. Affects every analytics surface that calls `scopedSalesCondition` (i.e., all of them).
4. **P0 — `isBookingFee` set only on exact-string `"Booking Fee"`.** Combined with the OR-with-netsuite-code in `buildIsFeeCondition`, the analytical effect is mostly hidden, but data inconsistencies between `is_booking_fee` and `netsuite_code` are real and corrupt any per-flag debugging. Affects every dashboard that filters by metric mode.
5. **P1 — Default metric mode counts fee rows in transaction count.** Sales mode is the default and includes booking-fee rows in `COUNT(*)`. Most dashboards (excluding `getTopProducts`) double- or triple-count. Affects: portfolio summary, daily trends, hourly distribution, heat-map composite score, hotel-group rollups, region rollups, location-group rollups.
6. **P1 — Reversals are not detected anywhere.** Inflates transaction counts and (correctly) cancels in revenue sums. No dashboard distinguishes. Affects every transaction-count metric.
7. **P1 — `locationType IN (...)` excludes NULL.** Affects any dashboard using the location-type filter when there are unmapped outlets.
8. **P1 — YoY leap-year + cross-month bug** in `getComparisonDates`. Affects every comparison card and YoY change indicator.
9. **P1 — `canonicalHotelGroupNameFragment` tie-breaks by UUID.** Affects any tier/heat-map row whose property has multiple hotel-group memberships and no `operating_group_id`.
10. **P1 — URL filter values are unvalidated.** Crafted URLs cause SQL errors (Postgres-level UUID parse failure) on the analytics dashboard. Affects all dashboards using `searchParamsToFilters`.
11. **P1 — `outlet_exclusions` is not region-scoped.** A `Q5` exclusion strikes every region. Affects all dashboards now that AU region exists (PR #26).
12. **P1 — `userScopes` rows are re-read on every query.** Hidden N+1 for users with many scopes. Per-request `React.cache` would fix.

---

## Suggested follow-up (to other audits)

- **Portfolio / heat-map auditors:** verify whether `getPortfolioSummary` / heat-map composite double-counts booking-fee rows in sales mode (almost certainly yes).
- **Auth / RBAC auditor:** confirm internal-user provisioning always sets at least one scope OR change the contract to default-deny.
- **Data-import auditor:** validate fee-row consistency (`is_booking_fee = (netsuite_code = '9991')`) on production.
- **Maturity dashboard auditor:** confirm whether unbucketed locations (no kiosk assignment) should appear in any bucket or be flagged separately.
- **Comparison auditor:** check leap-year and cross-month YoY edge cases against the visible labels.
