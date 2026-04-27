# Analytics Logic Reference

This document is the authoritative reference for how every metric on every analytics dashboard in `wkg-kiosk-tool` is computed. It catalogues data sources, SQL fragments, filter propagation, business meaning, and edge-case behaviour, dashboard by dashboard. It is the doc to hand to a new analyst, support engineer, or product owner who needs to understand exactly what a number means before quoting it. Issues, bugs, and misrepresentations are tracked separately in `ANALYTICS-ISSUES.md`; this file is descriptive, not prescriptive.

---

## Global concepts

### Data model overview

The primary fact table is `sales_records` (`src/db/schema.ts`):

- One row per ledger line emitted by the NetSuite ETL. Every booking emits at least one row; bookings that incur a booking fee emit a second row tagged with NetSuite code `9991`; bookings that incur cash-handling charges emit a third row tagged `9992`.
- Refunds/reversals are NOT a flag — they are emitted as a separate, opposite-signed row that shares `(saleRef, refNo, transactionDate)` with the original row (`schema.ts:638-639`). `SUM(net_amount)` therefore nets to zero across original + reversal; `COUNT(*)` does not (it counts both).
- `is_booking_fee boolean` is set by the CSV parser (`src/lib/csv/sales-csv.ts:179`) when `productName === "Booking Fee"` (exact match, after `.trim()`). It does NOT get set for cash-handling fees — those are identified solely by `netsuite_code = '9992'`.
- `netsuite_code` discriminates fee rows: `'9991'` for booking fee, `'9992'` for cash handling fee. The constant `FEE_NETSUITE_CODES` is exported (`shared.ts:40`) but the SQL helpers hard-code the literals.
- `transaction_date` is a Postgres `date` (no time-of-day, no timezone). The time-of-day is in a separate nullable `transaction_time` column (`schema.ts:652`).
- `region_id` on `sales_records` is propagated from the parent `salesImports.regionId` at parse time. Region is therefore an attribute of the import, not of the location.

The dimension tables joined into analytics queries:

- `locations` — outlets. Has `archivedAt` (soft delete), `primaryRegionId` (NOT NULL FK to regions), `outletCode` (unique only per `(primaryRegionId, outletCode)`), `numRooms`, `liveDate` (manually-tracked), `locationType` (nullable, CHECK enforces one of `'hotel'|'retail_desk'|'online'|'airport'|'hex_kiosk'`).
- `products` — has a real `categoryName` column denormalised from NetSuite (`schema.ts:353`). Booking Fee and Cash Handling Fee exist as `products` rows.
- `regions`, `hotel_groups`, `location_groups` — dimension tables.
- `location_region_memberships`, `location_hotel_group_memberships`, `location_group_memberships` — many-to-many membership tables (`schema.ts:526-575`). All have composite PKs `(location_id, dimension_id)`. None has time-bound validity columns; membership is "currently true" only.
- `kiosk_assignments` — temporal table (`assignedAt`, nullable `unassignedAt`). The earliest `assignedAt` per location is the conventional "live date" for analytics.
- `commission_ledger` — booking-fee-derived commission entries; rows tagged `is_reversal=true` are written when an admin recalculates commission for a `(locationProduct, month)`.
- `outlet_exclusions` — admin-managed exclusion rules (free-text outlet codes, exact or regex match). Does not reference a region.

### Filter bar — universal filters

All dashboards (with the exceptions noted below) read filters from a Zustand store:

- `useAnalyticsFilterStore` — the global filter bar. Exposes: `dateRange`, `metricMode` ("sales" or "revenue"), `hotelFilter`, `regionFilter`, `productFilter`, `hotelGroupFilter`, `locationGroupFilter`, `locationTypeFilter`, `maturityFilter`. URL-synced via `filtersToSearchParams` / `searchParamsToFilters`.
- `usePivotFilterStore` — independent zustand store with the same shape, used only by the Pivot Table page. State does NOT sync with the global store (`analytics-filter-store.ts:162-163`).

`metricMode` defaults to `"sales"` (`canonicalise-filters.ts:44`, `types.ts:54`, `analytics-filter-store.ts:129`). Both stores initialise their date range to YTD via `getPresetRange("ytd")`.

The filters propagate into queries through a per-dashboard `build*Where` function (e.g. `buildPortfolioWhere`, `buildHeatMapWhere`, `buildCommissionWhere`). These functions are private to each dashboard's `queries/*.ts` module — there is no shared `buildPortfolioWhere`. They typically AND together: `dateCondition`, `scopeCondition` (RBAC), `activeLocationCondition`, `maturityCondition`, `metricModeCondition`, and `dimensionConditions` (productIds, hotelIds, hotelGroupIds, regionIds, locationGroupIds, locationTypes).

The Trend Builder page is a notable exception — it does not read most of the global filter store and uses per-series filter overrides instead. The Pivot Table page does not mount a FilterBar at all.

### Cross-cutting helpers

These live in `src/lib/analytics/queries/shared.ts`, `src/lib/analytics/active-locations.ts`, `src/lib/analytics/metrics.ts`, and `src/lib/scoping/scoped-query.ts`. Every dashboard query module composes its WHERE clause from this kit.

- **`combineConditions(conditions)`** (`shared.ts:159-164`) — filters out `undefined`, AND-joins the rest with `sql.join(..., " AND ")`. Returns `undefined` for an empty list. There is no helper that ORs filters.

- **`buildDateCondition(filters)`** (`shared.ts:32-34`) — emits `transaction_date >= dateFrom AND transaction_date <= dateTo`. Inclusive on both ends. Inputs are bare strings; no validation that `dateFrom <= dateTo`.

- **`buildIsFeeCondition()`** (`shared.ts:45-47`) — `(is_booking_fee = true OR netsuite_code IN ('9991','9992'))`. The OR is the canonical way to identify a fee row regardless of the boolean flag's accuracy.

- **`buildNonFeeCondition()`** (`shared.ts:57-59`) — `NOT (is_booking_fee = true OR netsuite_code IN ('9991','9992'))`. Used by Top Products to strip fees.

- **`buildMetricModeCondition(filters)`** (`shared.ts:51-53`) — returns `buildIsFeeCondition()` when `filters.metricMode === "revenue"`, otherwise `undefined`. In other words: revenue mode restricts to fee rows; sales mode (the default) adds no predicate, so every row counts.

- **`buildDimensionFilters(filters)`** (`shared.ts:61-110`) — pushes one condition per non-empty dimension array. Each dimension uses `IN` or a sub-`SELECT IN` against a membership table. `locationTypes` filter is `WHERE location_type IN (...)` — NULL location_type rows are silently excluded. Returned as `SQL[]`, ANDed by the caller.

- **`kioskLiveDateSubquery`** (`shared.ts:117`) — `(SELECT MIN(assigned_at) FROM kiosk_assignments WHERE location_id = locations.id)`. The earliest ever kiosk assignment per location, regardless of whether the kiosk is still active. This is what every analytics surface uses as the "live date" — `locations.live_date` is NOT consulted.

- **`buildMaturityCondition(filters)`** (`shared.ts:119-157`) — when `filters.maturityBuckets` is non-empty, builds an OR of bucket conditions. Each bucket compares `kioskLiveDateSubquery` against `filters.dateTo::timestamp` using Postgres `INTERVAL '1 month'` arithmetic. Buckets: `0-1mo`, `1-3mo`, `3-6mo`, `6+mo`. Reference date is `filters.dateTo` (fix from commit `f374da7`). Locations with NULL `kioskLiveDate` evaluate to NULL in every comparison and are silently dropped.

- **`canonicalHotelGroupNameFragment()`** (`shared.ts:187-200`) — `COALESCE(hotel_groups.name FROM locations.operating_group_id, MIN(hotel_group_id) ordered lex from memberships, NULL)`. Resolves a single hotel group per location deterministically. Used by Outlet Tiers, Heat Map, and High/Low Performer Patterns; NOT used by the Regions / Hotel Groups / Location Groups dashboards.

- **`activeKioskCountFragment()`** (`shared.ts:207-214`) — `(SELECT COUNT(*) FROM kiosk_assignments WHERE location_id = locations.id AND unassigned_at IS NULL)`. "Active right now"; not date-bounded.

- **`buildExclusionCondition()`** (`shared.ts:15-30`) — legacy synchronous DB read on `outlet_exclusions`, builds `NOT (... OR ...)` over `locations.outletCode`. Migrated away from in Phase 1; only Hotel Groups still uses it instead of `buildActiveLocationCondition`.

- **`getActiveLocationIds()`** / **`buildActiveLocationCondition()`** (`active-locations.ts:29-46, 60-67`) — `getActiveLocationIds` is `React.cache`'d, runs once per request, returns every `locations.id` whose `outlet_code` is NOT matched by any `outlet_exclusions` row (exact or regex). `buildActiveLocationCondition` emits `sales_records.location_id = ANY($ids::uuid[])`. Returns `sql\`FALSE\`` if the active list is empty (zero-row guard). `archivedAt` is NOT consulted — archived locations are still treated as active by this helper.

- **`scopedSalesCondition(db, user, options?)`** (`scoping/scoped-query.ts`) — RBAC predicate. Reads `userScopes` rows for the resolved user and emits per-dimension `IN` clauses (or membership sub-INs for `hotel_group`/`region`/`location_group`). Multiple dimensions on the same scope OR together (union, not intersection). Internal admins → no filter. Internal viewer/member with zero scopes → no filter. External user with zero scopes → throws.

- **`getComparisonDates(dateFrom, dateTo, mode)`** (`metrics.ts:30-46`):
  - `mom`: shifts both endpoints back by `(durationOfWindow + 1 day)` to produce an adjacent, non-overlapping previous period.
  - `yoy`: naive `setFullYear(year - 1)` on both endpoints. No leap-day handling — `Feb 29 → Mar 1` due to JS Date overflow.

- **`getPreviousPeriodDates(dateFrom, dateTo)`** (`metrics.ts:13-26`) — duration-matched shift used when the comparison mode is fixed to "previous period" (no MoM/YoY toggle). Called by Regions, Hotel Groups, Location Groups, and Commission detail pages.

- **`classifyOutletTier(percentile)`** (`metrics.ts:97-102`) — `≥80 → Premium`, `≥50 → Standard`, `≥20 → Developing`, else `Emerging`.

- **`classifyTrafficLight(revenue, config)`** (`thresholds.ts:8-15`) — `revenue <= redMax → red`, `revenue >= greenMin → green`, else `amber`. Uses `app_settings`-stored GBP thresholds (defaults `redMax=500`, `greenMin=1500`).

- **`calculateCompositeScore`, `calculateRevenuePerRoom`, `calculateTxnPerKiosk`, `calculateAvgBasketValue`, `calculatePeriodChange`, `calculatePercentile`** (`metrics.ts`) — pure JS. Standard div-by-zero returns `null` (or in some sites `0`). `calculateCompositeScore` re-normalises remaining weights when one input is null. `calculatePercentile` uses `<=` rank (ties inflate percentile).

### Sales mode vs Revenue mode

The `metricMode` toggle is a hidden global filter that changes the meaning of every dashboard:

- **Sales mode (default)** — every `sales_records` row counts. Aggregates include booking-fee and cash-handling-fee rows. Labels say "Sales" via `useMetricLabel()` (`metric-label.ts:8-10`). Used to answer "what is total customer-facing turnover?".
- **Revenue mode** — `buildMetricModeCondition` adds `buildIsFeeCondition()` to the WHERE. Only fee rows count. `SUM(net_amount)` is therefore "WKG fee revenue" rather than gross sales. Labels say "Revenue". Used to answer "what does WKG earn from these bookings?".

The toggle does not change anything else — chart titles, axis labels, currency colours, and column headers stay the same. Only the metric label flips.

### Cache wrapper

All cached actions go through `wrapAnalyticsQuery` (`src/lib/analytics/cached-query.ts:73-95`). This wrapper substitutes `INTERNAL_USER_CTX = { role: 'admin' }` for the caller's `userCtx` (line 86) before computing the cache key. For internal admins this is a no-op. For any future scoped-internal user it would silently return unscoped data from the shared cache.

---

## Portfolio dashboard

Render entry: `src/app/(app)/analytics/portfolio/page.tsx`
Server actions: `src/app/(app)/analytics/portfolio/actions.ts`
Core SQL: `src/lib/analytics/queries/portfolio.ts`
Performer SQL: `src/lib/analytics/queries/high-performer-analysis.ts`, `location-revenues.ts`

Shared WHERE: `buildPortfolioWhere()` (`portfolio.ts:42-69`) ANDs `dateCondition`, `scopeCondition`, `activeLocationCondition`, `maturityCondition`, `metricModeCondition`, and dimension conditions.

### KPI Strip

Type: KPI strip (5 cards).
Render: `page.tsx:262-272` (`StatCard`s built from the `kpis` memo at `page.tsx:145-188`).
Data: `getPortfolioSummary` (`portfolio.ts:96-131`), called via cached wrapper from `actions.ts:51`. A second copy of the same query runs against the prior period (date-shifted by `getComparisonDates`) to populate delta chips.

| KPI | SQL | Filters |
|---|---|---|
| Sales / Revenue (label flips with `metricMode`) | `COALESCE(SUM(sales_records.net_amount), 0)` (portfolio.ts:110) | All `buildPortfolioWhere` filters. Nets refund rows. Fee rows included in sales mode, excluded in revenue mode. |
| Transactions | `COUNT(*)::text` (portfolio.ts:111) | Same. Counts every `sales_records` row including fees and reversals. |
| Avg Basket | `totalRevenue / totalTransactions` in JS (portfolio.ts:127) | Returns 0 (not null) when transactions = 0. |
| Unique Outlets | `COUNT(DISTINCT sales_records.location_id)::text` (portfolio.ts:114) | Locations that transacted in the window. |
| Unique Products | `COUNT(DISTINCT sales_records.product_id)::text` (portfolio.ts:113) | Distinct product UUIDs (fee rows count as their own products). |

Comparison delta uses `calculatePeriodChange(current, previous)` ((c-p)/p × 100), returning `null` when previous = 0 so the chip is hidden. `comparisonMode` toggle (`mom`/`yoy`) drives `getComparisonDates`.

Business meaning: top-of-page "is the portfolio growing?" snapshot. Operators look at Revenue + Avg Basket for direction; Unique Outlets / Unique Products for breadth.

Edge cases handled: previous-period summary may be `null` (catch in `actions.ts:53-54`); `toDelta` returns `undefined` and the chip is omitted. `transactions=0` short-circuits to `avgBasketValue = 0`.

### Threshold Editor

Type: Control widget.
Render: `page.tsx:275`, component at `threshold-editor.tsx`.
Store: `src/lib/stores/performer-threshold-store.ts`.

Two numeric inputs (`Green cutoff %` / `Red cutoff %`) write to a Zustand store persisted in `localStorage` under key `wkg:performer-threshold`. Defaults: `green=30`, `red=30`. Yellow is the implicit middle band (`100 - green - red`). Validation requires both ≥0, ≤100, and `green + red ≤ 100`; the store is only updated on valid commit.

Drives only the High Performer and Low Performer Patterns cards. Does NOT affect the Outlet Tiers traffic-light pill (which uses `app_settings`-stored £-revenue thresholds).

Business meaning: per-user knob for tier sensitivity. Reset button restores 30/30.

### High Performer Patterns

Type: Insight card.
Render: `page.tsx:279-291`, component at `high-performer-patterns.tsx`.
Data: `getHighPerformerData` → `computePerformerPatterns(direction='top')` (`high-performer-analysis.ts:97-280`).

Pipeline:

1. **Per-location revenue** — `getLocationRevenuesForRequest` (`location-revenues.ts:76-95`) runs `SUM(sales_records.net_amount) GROUP BY location_id`, with WHERE identical to `buildPortfolioWhere` minus `metricModeCondition`. So in revenue mode the universe is pre-filtered to fee rows; in sales mode every row counts.
2. **Tier slice** — sort DESC, pick top `greenCutoff%` (`high-performer-analysis.ts:71-82`). Always at least 1 location when the universe is non-empty.
3. **Three parallel sub-queries** against the picked tier:
   - **Region distribution** (lines 156-166): `COUNT DISTINCT location_id` per region via `location_region_memberships`. Percentage = count / tierSize. Multi-region locations are counted in each region.
   - **Avg kiosk count** (lines 169-181): subquery `COUNT(*)` over `kiosk_assignments WHERE unassigned_at IS NULL` per location, then `AVG(kiosk_count)`. Locations with zero active assignments are excluded.
   - **Top 5 products by revenue** (lines 186-199): groups by `products.name` over tier locations, with hand-rolled `is_booking_fee = false` predicate (only excludes 9991, not 9992).
4. **Derived metrics in JS** (lines 209-226):
   - `avgRoomCount` = unweighted mean of `num_rooms` over tier members where `num_rooms IS NOT NULL`.
   - `avgRevenuePerRoom` = `SUM(tier_revenue where rooms>0) / SUM(tier_rooms)` — weighted, not a mean of ratios.
5. **Insight strings** (lines 235-265) — bullet-style narrative.

Filters that apply: date, scope, active-locations, maturity, dimension filters. `metricModeCondition` is intentionally NOT applied (the universe is gathered without it; the top-products sub-query manually filters fees).

Business meaning: "what do our best outlets have in common?" Used to identify replicable patterns (kiosk count, room count, region cluster, top SKUs).

Edge cases: empty universe short-circuits with a single boilerplate insight. `tierRoomsTotal=0` → `avgRevenuePerRoom=null`. Empty top-products list → bullet not emitted. Hard-coded `£` symbol in insight strings (line 258).

### Low Performer Patterns

Type: Insight card.
Render: `page.tsx:293-305`, component at `low-performer-patterns.tsx`.
Data: `getLowPerformerData` → `computePerformerPatterns(direction='bottom')` (`high-performer-analysis.ts:305-322`).

Symmetric to High Performer Patterns. Same WHERE assembly, same three sub-queries, same JS aggregation. Picks the bottom `redCutoff%` of the same `sortedDesc` array using `slice(n - count)`. The fields `redCount`, `regionDistribution`, `avgKioskCount`, `avgRoomCount`, `avgRevenuePerRoom`, `topProducts` describe the bottom tier.

Business meaning: "what do our worst outlets have in common?" Used to spot operational patterns (low kiosk count, undersized properties, regional support gaps).

### Daily Trends

Type: Dual-line chart.
Render: `page.tsx:307-323`, component at `daily-trends.tsx`.
Data: `getDailyTrends` (`portfolio.ts:273-299`).
Events overlay: `getBusinessEvents(dateFrom, dateTo)` (`trend-series.ts:142-188`).

```sql
SELECT
  sales_records.transaction_date::text AS date,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*)::text AS transactions
FROM sales_records
WHERE <buildPortfolioWhere>
GROUP BY transaction_date
ORDER BY transaction_date ASC
```

Two-line `recharts` chart. Left Y-axis revenue (Azure `#00A6D3`); right Y-axis transactions (Graphite `#121212`). X-axis tick = `${day}/${month}` formatted via `new Date(YYYY-MM-DD)` (`daily-trends.tsx:39-43`). Tooltip uses `toLocaleDateString("en-GB")`.

Event annotations overlay vertical lines for business events whose `[start_date, end_date]` overlaps the window. All event categories active by default for portfolio view.

Filters: same as `buildPortfolioWhere`.

Business meaning: trend trajectory and visible spikes/dips. Event overlay lets ops attribute movement to known events (school holidays, conferences).

Edge cases: missing dates aren't filled — Recharts draws a continuous line by skipping gaps. Date-string parsing is timezone-sensitive (`new Date("2026-04-25")` is UTC midnight).

### Category Performance

Type: Horizontal bar chart.
Render: `page.tsx:325-337`, component at `category-performance.tsx`.
Data: `getCategoryPerformance` (`portfolio.ts:135-167`).

```sql
SELECT
  products.name AS category_name,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*)::text AS transactions,
  COUNT(*)::text AS quantity,
  COALESCE(AVG(sales_records.net_amount), 0) AS avg_value
FROM sales_records INNER JOIN products
WHERE <buildPortfolioWhere>
GROUP BY products.name
ORDER BY revenue DESC
```

Despite the field name `category_name`, this query groups by `products.name`, not `products.category_name`. The `quantity` field is a copy of `transactions` (the `sales_records.quantity` column was dropped in migration 0022). The `avg_value` field is per-row `AVG(net_amount)`, not avg basket.

Filters: same as `buildPortfolioWhere`.

Business meaning: nominally "what categories do we sell?". Effectively renders one bar per product.

Edge cases: empty result triggers the `<empty>` state. Chart height grows linearly (`Math.max(300, data.length * 40)`).

### Top Products

Type: Table.
Render: `page.tsx:339-349`, component at `top-products.tsx`.
Data: `getTopProducts` (`portfolio.ts:171-269`).

Two distinct query shapes driven by `metricMode`:

**Sales mode** (`portfolio.ts:239-259`) — applies `buildNonFeeCondition()` (excludes both 9991 and 9992) and groups by `products.name`. This is the only place in `portfolio.ts` that uses `buildNonFeeCondition`.

**Revenue mode** (`portfolio.ts:194-237`) — fee rows have generic product names ("Booking Fee" / "Cash Handling Fee"). The query LATERAL self-joins back into `sales_records`, finds a non-fee row in the same `region_id` whose `ref_no = REGEXP_REPLACE(parent.ref_no, '-b$', '')`, and groups by THAT row's product name. Result: "fee revenue attributed to the product the customer actually bought".

UI columns: `#`, Product, metric (revenue), Avg metric/Txn, Transactions, Quantity. Avg/Txn is `revenue / transactions`, rendered as "—" when transactions = 0.

Filters: `buildPortfolioWhere` with `metricMode` overridden by the explicit fee/non-fee predicate. `LIMIT 20` hard-coded.

Business meaning: ranking of revenue contribution by product. Sales mode = "what are people buying?"; Revenue mode = "what booking lines drive WKG's commission?".

Edge cases: region scoping in the LATERAL join is essential because `(refNo)` repeats across regions. The `-b$` regex strips only the `-b` reversal suffix; other suffix variants (`-h`, `-b-h`) cause the LATERAL to find no parent.

### Hourly Distribution

Type: Bar chart.
Render: `page.tsx:351-363`, component at `hourly-distribution.tsx`.
Data: `getHourlyDistribution` (`portfolio.ts:303-331`).

```sql
SELECT
  EXTRACT(HOUR FROM sales_records.transaction_time)::int::text AS hour,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*)::text AS transactions
FROM sales_records
WHERE <buildPortfolioWhere> AND sales_records.transaction_time IS NOT NULL
GROUP BY EXTRACT(HOUR FROM transaction_time)
ORDER BY hour ASC
```

Bar chart of revenue per hour-of-day (0..23). Tooltip shows `HH:00 - HH:59`.

`transaction_time` is `time` (no zone) on the schema. The hour is extracted in whatever timezone the ETL stamped — there is no query-time timezone awareness.

Filters: same as `buildPortfolioWhere`, plus an explicit `transaction_time IS NOT NULL`.

Business meaning: when do customers transact? Drives staffing and opening-hour decisions.

Edge cases: NULL-time rows are silently dropped. Hours with zero rows are not rendered (no zero bar).

### Outlet Tiers

Type: Table.
Render: `page.tsx:365-382`, component at `outlet-tiers.tsx`.
Data: `getOutletTiers` (`portfolio.ts:335-426`).
Tier classifier: `classifyOutletTier(percentile)` (`metrics.ts:97-102`).

```sql
SELECT
  locations.id AS location_id,
  COALESCE(locations.outlet_code, '') AS outlet_code,
  locations.name AS hotel_name,
  (SELECT MIN(kiosk_assignments.assigned_at) ...)::text AS live_date,
  COALESCE(<canonicalHotelGroupNameFragment>, NULL) AS hotel_group_name,
  (SELECT COUNT(*)::int FROM kiosk_assignments WHERE unassigned_at IS NULL) AS kiosk_count,
  locations.num_rooms AS num_rooms,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*)::text AS transactions
FROM sales_records INNER JOIN locations
WHERE <buildPortfolioWhere>
GROUP BY locations.id, locations.outlet_code, locations.name, locations.num_rooms
ORDER BY revenue DESC
LIMIT 200
```

Per-row JS post-processing (`portfolio.ts:399-425`):

- `percentile` — binary-search rank of revenue in sorted-asc revenues × 100/n.
- `sharePercentage` — revenue / sum(revenues) × 100.
- `tier` — `classifyOutletTier(percentile)`.
- `revenuePerKiosk` — revenue / kioskCount, null when kioskCount = 0.
- `revenuePerRoom` — revenue / numRooms, null when numRooms is null or ≤ 0.

UI maturity badge (`outlet-tiers.tsx:90-101`) calls `calculateMaturityBucket(liveDate, NOW())` — uses `new Date()` as reference, not `filters.dateTo`. The traffic-light pill uses `app_settings`-stored `redMax`/`greenMin` GBP thresholds (independent of the percentage-based threshold editor).

Filters: same as `buildPortfolioWhere`. `LIMIT 200` (silent truncation).

Business meaning: full outlet leaderboard. Each row exposes Outlet Code, Hotel, Hotel Group, Maturity, Kiosks, Rooms, Total revenue, Transactions, Revenue/Kiosk, Revenue/Room, Tier, Status, and inline Flag actions.

Edge cases handled: `outletCode` defaults to `''`, rendered as "—". `kioskCount=0` → `revenuePerKiosk=null`. `numRooms` null or 0 → `revenuePerRoom=null`. Empty universe is caught upstream (`hasOutletTiersData` empty state).

### Flags Drawer

Type: Side panel (Sheet).
Render: `page.tsx:387-429`, button trigger at `page.tsx:241-249`.
Data: `fetchActiveFlags` → `fetchLocationFlags()` (`flags/actions.ts:71-76`).

Side panel listing all unresolved `location_flags` rows (`WHERE resolved_at IS NULL`, ordered by `created_at` ASC). `unstable_cache` with TTL 86400s, tag `analytics:flags`. Each flag shows `<FlagBadge>`, `formatDate(createdAt)`, optional `reason`, and `Raised by ${actorName}` (snapshot at insert, not joined live). Active count is also rendered on the toolbar button.

Filters: NONE. Drawer shows all unresolved flags portfolio-wide regardless of dashboard filters. The same `flags` array is fed into Outlet Tiers for the inline FlagDialog buttons.

Business meaning: workflow follow-ups raised from the Outlet Tiers row action. Reviewed daily by ops to close out items.

Edge cases handled: empty list → "No active flags…" copy. Cross-process cache invalidation via the `analytics:flags` tag (resolveFlag and createFlag both call `revalidateTag`).

---

## Maturity Analysis dashboard

Render: `src/app/(app)/analytics/maturity/page.tsx`
Server actions: `src/app/(app)/analytics/maturity/actions.ts`
Core SQL: `src/lib/analytics/queries/maturity-analysis.ts`
Reference helper: `src/lib/analytics/maturity.ts`

The page fetches a single combined `MaturityAnalysis` payload via `fetchMaturityAnalysis` → `getMaturityAnalysisCached` (`maturity-analysis.ts:235-238`), fanned out to three queries via `Promise.all`. Note: this dashboard's bucket boundaries are different from the global maturity filter — buckets here are days (0-30d / 31-60d / 61-90d / 90+d), while the global filter chip uses months (0-1mo / 1-3mo / 3-6mo / 6+mo).

WHERE builder: `buildMaturityWhere` (`maturity-analysis.ts:30-56`) — combines date + scope + active-location + maturity (global) + metric-mode + dimension filters.

### Section A — Sales/Revenue by Maturity Bucket

Type: KPI grid (4 cards) + bar chart.
Render: `page.tsx:134-186`. Bar chart uses `dataKey="avgRevenue"`, fill `#00A6D3`, X-axis from bucket → `DETAILED_MATURITY_BUCKETS` labels.
Data: `getRevenueByMaturityBucket` (`maturity-analysis.ts:65-126`).

```sql
SELECT
  CASE
    WHEN EXTRACT(EPOCH FROM (filters.dateTo::timestamp - kioskLiveDateSubquery)) / 86400 <= 30  THEN '0-30d'
    WHEN ... <= 60  THEN '31-60d'
    WHEN ... <= 90  THEN '61-90d'
    ELSE '90+d'
  END AS bucket,
  COUNT(DISTINCT location_id) AS location_count,
  COALESCE(SUM(net_amount) / NULLIF(COUNT(DISTINCT location_id), 0), 0) AS avg_revenue,
  COALESCE(SUM(net_amount), 0) AS total_revenue
FROM sales_records INNER JOIN locations
WHERE <buildMaturityWhere> AND kioskLiveDateSubquery IS NOT NULL
GROUP BY bucket
```

Output is zero-filled to all four buckets if SQL returned fewer.

Filters: all of `buildMaturityWhere`.

Business meaning: how does revenue distribute across kiosk-maturity classes at a single point in time?

Edge cases: locations whose `kioskLiveDate IS NULL` are excluded from every bucket. The `avgRevenue` denominator is `COUNT DISTINCT location_id` — so the bar is "total revenue this window per location-in-this-bucket". Bucket assignment is based on age at end-of-window (`filters.dateTo`).

### Section B — Revenue Ramp Curve

Type: Line chart.
Render: `page.tsx:188-244`. Recharts `LineChart` with `dataKey="avgRevenue"` against `monthsSinceInstall` (0-6 inclusive; "6" labelled as "6+").
Data: `getRevenueRampCurve` (`maturity-analysis.ts:130-179`).

```sql
SELECT
  LEAST(FLOOR(EXTRACT(EPOCH FROM (transaction_date::timestamp - kioskLiveDateSubquery)) / (30.44 * 86400)), 6)::int AS months_since,
  COALESCE(SUM(net_amount) / NULLIF(COUNT(DISTINCT location_id), 0), 0) AS avg_revenue,
  COUNT(DISTINCT location_id) AS location_count
FROM sales_records INNER JOIN locations
WHERE <buildMaturityWhere> AND kioskLiveDateSubquery IS NOT NULL
  AND transaction_date::timestamp >= kioskLiveDateSubquery
GROUP BY months_since
ORDER BY months_since
```

Output is zero-filled to months 0..6. The `transaction_date >= kioskLiveDate` predicate is the only thing preventing pre-install rows from leaking in.

Filters: all of `buildMaturityWhere`.

Business meaning: at what age (in months since first kiosk assignment) do kiosks generate the most revenue?

Edge cases: month 6 silently aggregates months 6..N. The denominator is "locations seen in the bucket" — different per bucket because attrition. Months computed using `30.44` here vs `<= 30` in Section A vs `INTERVAL '1 month'` in the global filter — three different month-length conventions in the same dashboard.

### Section C — Install Month Cohorts

Type: Table.
Render: `page.tsx:246-292`. HTML `<table>` (not the shadcn Table). Three columns: Install Month (YYYY-MM), # Locations, Avg Monthly metric.
Data: `getInstallCohorts` (`maturity-analysis.ts:183-214`).

```sql
SELECT
  TO_CHAR(kioskLiveDateSubquery, 'YYYY-MM') AS install_month,
  COUNT(DISTINCT location_id) AS location_count,
  COALESCE(SUM(net_amount) / NULLIF(COUNT(DISTINCT location_id), 0), 0) AS avg_monthly_revenue
FROM sales_records INNER JOIN locations
WHERE <buildMaturityWhere> AND kioskLiveDateSubquery IS NOT NULL
GROUP BY install_month
ORDER BY install_month DESC
```

The column header says "Avg Monthly metric"; the SQL is `SUM/locations` with no division by month count.

Filters: all of `buildMaturityWhere`. WHERE applies the date filter to `transaction_date`, not to `kioskLiveDate` — so cohorts whose install month falls outside the window can still appear if they have transactions in-window.

Business meaning: nominally "average monthly revenue by install cohort"; effectively "total per-location revenue in the filter window, grouped by install month".

Edge cases: long-running portfolios produce many rows (no virtualisation, no pagination). Sort defaults to newest-first.

### Section D — Plateau Detection

Type: Insight card.
Render: `page.tsx:294-326`. `getPlateauInsight()` (`page.tsx:28-75`) compares `bucket3160.avgRevenue` to `bucket90.avgRevenue` from Section A.

```ts
const pctChange = ((avg90 - avg3160) / avg3160) * 100;
if (pctChange > 10)  → "Mature kiosks continue to grow (+X%)"  green
if (pctChange < -10) → "metric declines after maturity (-X%)" red
else                 → "metric plateaus after 90 days"        grey
```

Guard rails: returns "Insufficient data..." if either bucket is missing, has `locationCount === 0`, or `avg3160 === 0`. Does NOT guard against `avg3160 < 0` (possible if reversals dominate a tiny cohort).

Business meaning: a one-line verdict on whether mature kiosks continue to grow vs plateau.

Edge cases: ±10% threshold is arbitrary. Bucket 0-30d and 61-90d are computed but not used in this insight.

---

## Heat Map dashboard

Render: `src/app/(app)/analytics/heat-map/page.tsx`
Server actions: `src/app/(app)/analytics/heat-map/actions.ts`
Core SQL: `src/lib/analytics/queries/heat-map.ts`
Components: `performance-table.tsx`, `weight-editor.tsx`
Weight store: `src/lib/stores/heatmap-weights-store.ts`

### Section 1 — Score Weights Editor

Type: Control widget.
Render: `weight-editor.tsx`. Five integer inputs (revenue, transactions, revenuePerRoom, txnPerKiosk, basketValue), stacked-bar visualisation, total banner.
Store: `heatmap-weights-store.ts`. Persists `weights` (applied) to localStorage under key `heatmap-weights`.

`setPending` clamps each input to 0..100 (rounded integer). `apply()` only commits `pending → weights` if `sumWeights(pending) === 100` exactly. Apply button disabled when `!isValid || !isDirty`. Defaults: `revenue=30, transactions=20, revenuePerRoom=25, txnPerKiosk=15, basketValue=10`.

Adapter `toScoreWeights()` converts integer percents to fractions (×0.01) before passing to `getHeatMapData`. Server-side `resolveWeights` (`heat-map.ts:51-64`) accepts any non-negative finite weights — sum is not required to be 1.0; `calculateCompositeScore` re-normalises by total available weight.

Business meaning: per-user knob to re-shape composite scoring.

### Section 2 — Top 20 Performers

Type: Table.
Render: `page.tsx:106-122`. `<PerformanceTable data={heatMap.topPerformers}>` inside a `ChartCard`.
Data: `getHeatMapData` (`heat-map.ts:106-297`); `topPerformers = allPerformers.slice(0, 20)`.

Per-row metrics (computed in `heat-map.ts:187-274`):

| Metric | Source |
|---|---|
| `revenue` | `SUM(salesRecords.netAmount)` after `buildHeatMapWhere`. |
| `transactions` | `COUNT(*)` of those rows. |
| `numRooms` | `locations.numRooms` (nullable). |
| `kioskCount` (table display) | `activeKioskCountFragment()` correlated subquery — count of `kiosk_assignments` rows where `unassigned_at IS NULL`. NOT date-bounded. |
| `revenuePerKiosk` | `revenue / kioskCount` using "active right now" count. Null when kioskCount = 0. |
| `revenuePerRoom` | `revenue / numRooms` via `calculateRevenuePerRoom`. Null when numRooms is null/0. |
| `txnPerKiosk` (used in scoring) | `transactions / kiosks` where `kiosks` comes from a separate query (`heat-map.ts:155-170`) counting distinct `kiosk_assignments` whose `assigned_at <= dateTo` AND `unassigned_at IS NULL OR unassigned_at > dateFrom` — i.e. kiosks active at any point during the window. |
| `avgBasketValue` | `revenue / transactions`, with `?? 0` fallback (`heat-map.ts:213`). |
| `compositeScore` | Weighted sum of min-max-normalised metrics, rounded to 2dp. Min-max via `minMaxNormalize(value, min, max)` — returns 50 when `max === min`. |

Sort: descending compositeScore; rank assigned by index.

Maturity badge: `calculateMaturityBucket(row.liveDate ? new Date(row.liveDate) : null)` — uses default `referenceDate = new Date()` (today, not `filters.dateTo`).

Traffic light: `classifyTrafficLight(row.revenue, thresholdConfig)` — uses raw revenue (NOT composite score). Thresholds from `app_settings`.

Score colour pill: hard-coded `≥70 green / ≥40 amber / else red` (`performance-table.tsx:40-44`) — not aligned with traffic-light cutoffs.

Filters: `buildHeatMapWhere` (date, scope, active-location, maturity, metric-mode, dimensions).

Business meaning: rank outlets by composite score derived from five user-weighted dimensions.

Edge cases: when `allPerformers.length <= 20`, `bottomPerformers` is set to `[]`. When `21..40`, top and bottom can overlap by `40 - allPerformers.length` items. Outlets missing `numRooms` get composite computed from 4-of-5 weights re-scaled.

### Section 3 — Bottom 20 Performers

Type: Table.
Render: `page.tsx:123-138`. Same `<PerformanceTable>` component, fed `heatMap.bottomPerformers`.
Data: `bottomPerformers = allPerformers.slice(-20).reverse()` (`heat-map.ts:286-292`). Reversed so worst-of-worst is at the top.

Edge cases: returns `[]` when `bottomPerformers.length === allPerformers.length` (i.e. ≤ 20 outlets total). Rank column reads top-of-table = lowest rank in the displayed set.

### Section 4 — All Hotels

Type: Table (collapsed by default).
Render: `page.tsx:141-157`. Renders the full `allPerformers` array via the same `PerformanceTable`.
Data: same `getHeatMapData`. `allPerformers` = every outlet that produced sales in the window AND was not excluded by `buildHeatMapWhere`.

Edge cases: outlets with zero transactions in the window are absent. Archived locations (`archivedAt IS NOT NULL`) are NOT excluded by `buildActiveLocationCondition`. No virtualisation.

---

## Regions dashboard

Render: `src/app/(app)/analytics/regions/page.tsx`
Server actions: `src/app/(app)/analytics/regions/actions.ts`
Core SQL: `src/lib/analytics/queries/regions.ts`

Shared FROM helper (`regions.ts:66-72`): `salesRecords INNER JOIN locations INNER JOIN location_region_memberships INNER JOIN regions LEFT JOIN markets`.
WHERE builder (`regions.ts:39-62`): `dateCondition`, `scopedSalesCondition`, `buildActiveLocationCondition`, `maturityCondition`, `metricModeCondition`, dimension filters.

### Region Selector

Type: Accordion of region cards grouped by market.
Render: `region-selector.tsx:104-172`. Cards grouped by `marketName`; "Unassigned" bucket for regions with `marketId IS NULL`. Card body: region name, revenue, hotelGroupCount (mislabelled as "groups"), transactions.
Data: `getRegionsList` (`regions.ts:76-135`) — two parallel queries joined client-side via `countMap`.

**Query 1 — revenue/txn per region** (`regions.ts:90-102`):

```sql
SELECT regions.id, regions.name, markets.id, markets.name,
       COALESCE(SUM(net_amount), 0) AS revenue,
       COUNT(*) AS transactions
FROM sales_records ... INNER JOIN regions LEFT JOIN markets
WHERE <date + scope + active-location + maturity + metricMode + dimension>
GROUP BY regions.id, regions.name, markets.id, markets.name
ORDER BY revenue DESC
```

**Query 2 — counts per region** (`regions.ts:107-118`):

```sql
SELECT location_region_memberships.region_id,
       COUNT(DISTINCT location_hotel_group_memberships.hotel_group_id) AS hotel_group_count,
       COUNT(DISTINCT location_group_memberships.location_group_id)   AS location_group_count
FROM location_region_memberships
  LEFT JOIN location_hotel_group_memberships ...
  LEFT JOIN location_group_memberships ...
GROUP BY location_region_memberships.region_id
```

Query 1 honours filters; Query 2 runs unfiltered against the membership tables (counts are all-time).

Business meaning: Picker for region drill-down. URL-synced via `?region=id,id`.

Edge cases: regions with zero transactions in the period are excluded entirely (INNER JOIN). A market named literally "Unassigned" would collide with the synthetic bucket label.

### Region Metrics

Type: KPI grid (Revenue, Transactions, Hotel Groups, Location Groups).
Render: `region-metrics.tsx:18-56`. First two cards display MoM change.
Data: `getRegionDetail` summary block (`regions.ts:148-158`) plus `previousMetrics` block (`regions.ts:237-261`).

```sql
SELECT COALESCE(SUM(net_amount), 0) AS revenue, COUNT(*) AS transactions
FROM sales_records ... INNER JOIN regions
WHERE <whereClause> AND regions.id IN (:selectedRegionIds)
```

`hotelGroupCount` and `locationGroupCount` on the KPI cards are NOT a separate query — they are `hotelGroupBreakdown.length` and `locationGroupBreakdown.length` respectively. So they reflect "groups active in this region this period under the active filters", which differs from the all-time counts shown on the selector card.

Comparison delta uses `getPreviousPeriodDates` (pure period-shift), regardless of any MoM/YoY toggle elsewhere.

Filters: full `whereClause` plus selected `regionIds`.

### Hotel Groups in Region

Type: Table.
Render: `hotel-group-breakdown.tsx:20-60`. Columns: Hotel Group, Revenue/Sales, Transactions, Hotels, Avg/Hotel.
Data: `regions.ts:172-191`.

```sql
SELECT hotel_groups.name AS group_name,
       COALESCE(SUM(net_amount), 0) AS revenue,
       COUNT(*) AS transactions,
       COUNT(DISTINCT location_id) AS hotel_count
FROM sales_records ... INNER JOIN location_hotel_group_memberships INNER JOIN hotel_groups
WHERE sales_records.location_id IN (
        SELECT location_id FROM location_region_memberships
        WHERE region_id IN (:selectedRegionIds))
  AND <whereClause>
GROUP BY hotel_groups.id, hotel_groups.name
ORDER BY revenue DESC
```

`avgRevenuePerHotel` computed in JS as `revenue / hotelCount`.

The query joins via raw `location_hotel_group_memberships`, NOT `canonicalHotelGroupNameFragment` — so a location belonging to multiple hotel groups appears in every group's row.

Filters: full `whereClause`. The region scoping is via the `locationIdsInRegion` subquery, not via `regions.id IN (...)`.

### Location Groups in Region

Type: Table.
Render: `location-group-breakdown.tsx:20-60`. Columns: Location Group, Revenue/Sales, Transactions, Outlets, Total Rooms.
Data: `regions.ts:206-227`.

```sql
SELECT location_groups.name AS group_name,
       COALESCE(SUM(net_amount), 0) AS revenue,
       COUNT(*) AS transactions,
       COUNT(DISTINCT location_id) AS outlet_count,
       SUM(locations.num_rooms) AS total_rooms
FROM sales_records ... INNER JOIN location_group_memberships INNER JOIN location_groups
WHERE sales_records.location_id IN (locationsInRegion subquery)
  AND <whereClause>
GROUP BY location_groups.id, location_groups.name
ORDER BY revenue DESC
```

`SUM(locations.num_rooms)` is computed over the post-JOIN rowset (one row per `sales_records` row), not once per location.

Filters: same as Hotel Groups in Region.

---

## Hotel Groups dashboard

Render: `src/app/(app)/analytics/hotel-groups/page.tsx`
Server actions: `src/app/(app)/analytics/hotel-groups/actions.ts`
Core SQL: `src/lib/analytics/queries/hotel-groups.ts`

WHERE builder (`hotel-groups.ts:36-58`): date, scope, **`buildExclusionCondition`** (legacy — different from Regions/Location Groups which use `buildActiveLocationCondition`), maturity, metricMode, dimension filters.

### Hotel Groups Selector

Type: MultiSelect with revenue/hotel-count labels.
Render: `group-selector.tsx:26-62`. Options labelled `"<Group Name> (N hotels) £Xm revenue"`.
Data: `getHotelGroupsList` (`hotel-groups.ts:87-187`).

Uses a CTE to pre-aggregate by location before the membership join (`hotel-groups.ts:114-137`):

```sql
WITH loc_agg AS (
  SELECT location_id, SUM(net_amount) AS revenue, COUNT(*) AS transactions
  FROM sales_records INNER JOIN locations ON ...
  WHERE <whereClause>
  GROUP BY sales_records.location_id
)
SELECT hotel_groups.id, hotel_groups.name,
       SUM(la.revenue) AS revenue,
       SUM(la.transactions) AS transactions,
       COUNT(DISTINCT la.location_id) AS hotel_count
FROM loc_agg la
INNER JOIN location_hotel_group_memberships ...
INNER JOIN hotel_groups ...
GROUP BY hotel_groups.id, hotel_groups.name
ORDER BY revenue DESC
```

A previous-period CTE runs in parallel with the same shape and a shifted date range to populate `revenueChange` / `transactionChange` (computed but not surfaced in the selector label).

Filters: date, scope, outlet exclusion (legacy), maturity, metricMode, dimension filters.

Edge cases: hotels with zero sales in period are silently dropped (INNER JOIN). `hotel_count` shifts when `metricMode` toggles between sales and revenue (only hotels with at least one fee row qualify in revenue mode).

### Group Metrics

Type: KPI grid (Revenue, Transactions, Hotels, Avg/Hotel).
Render: `group-metrics.tsx:18-56`.
Data: `getHotelGroupDetail` summary (`hotel-groups.ts:200-217`).

```sql
SELECT COALESCE(SUM(net_amount), 0) AS revenue,
       COUNT(*) AS transactions,
       COUNT(DISTINCT sales_records.location_id) AS hotel_count
FROM sales_records ... INNER JOIN location_hotel_group_memberships INNER JOIN hotel_groups
WHERE <whereClause> AND hotel_groups.id IN (:selectedGroupIds)
```

`avgRevenuePerHotel` = `revenue / hotelCount` in JS. `previousMetrics` from same query against shifted date range.

Filters: full `whereClause` plus selected `groupIds`.

### Hotels in Group

Type: Table.
Render: `hotel-list.tsx:24-81`. Columns: Outlet code, Hotel name, Revenue, Txn, Quantity, Rooms, Stars, Rev/Room.
Data: `getHotelGroupDetail` hotel breakdown (`hotel-groups.ts:220-245`).

```sql
SELECT sales_records.location_id,
       COALESCE(locations.outlet_code, '') AS outlet_code,
       locations.name AS hotel_name,
       COALESCE(SUM(net_amount), 0) AS revenue,
       COUNT(*) AS transactions,
       COUNT(*) AS quantity,
       locations.num_rooms AS rooms,
       NULL AS kiosks,
       locations.star_rating
FROM sales_records ... INNER JOIN location_hotel_group_memberships INNER JOIN hotel_groups
WHERE <whereClause> AND hotel_groups.id IN (:selectedGroupIds)
GROUP BY sales_records.location_id, locations.outlet_code, locations.name, locations.num_rooms, locations.star_rating
```

`revenuePerRoom = rooms ? revenue / rooms : null`. `quantity` is a copy of `transactions`. `kiosks` is hard-coded NULL (column not rendered in the React component but lives in the typed shape).

`revenuePerRoom` denominator is current `locations.num_rooms`, not the room count as of the period (no SCD-2 history exists).

Filters: same as summary.

### Daily Trends (Hotel Groups)

Type: Dual Y-axis line chart.
Render: `temporal-charts.tsx:23-86`. Recharts `LineChart` with revenue line (Azure) + transactions line (Graphite) on opposite Y-axes.
Data: `getHotelGroupDetail` trends block (`hotel-groups.ts:265-284`).

```sql
SELECT transaction_date AS date,
       COALESCE(SUM(net_amount), 0) AS revenue,
       COUNT(*) AS transactions
FROM sales_records ... INNER JOIN location_hotel_group_memberships INNER JOIN hotel_groups
WHERE <whereClause> AND hotel_groups.id IN (:selectedGroupIds)
GROUP BY transaction_date
ORDER BY transaction_date ASC
```

`transaction_date` is `date` (no time component), so timezone is collapsed at ETL time.

---

## Location Groups dashboard

Render: `src/app/(app)/analytics/location-groups/page.tsx`
Server actions: `src/app/(app)/analytics/location-groups/actions.ts`
Core SQL: `src/lib/analytics/queries/location-groups.ts`

WHERE builder (`location-groups.ts:38-61`): date, scope, active-location, maturity, metricMode, dimension filters.

### Location Groups Selector

Type: MultiSelect labelled `"<group> · N location(s) · £X"`.
Render: `location-selector.tsx:22-55`.
Data: `getLocationGroupsList` (`location-groups.ts:74-121`).

```sql
SELECT location_groups.id, location_groups.name,
       COALESCE(SUM(net_amount), 0) AS revenue,
       COUNT(*) AS transactions,
       COUNT(DISTINCT location_id) AS hotel_count,
       SUM(DISTINCT locations.num_rooms) AS total_rooms,
       NULL AS total_kiosks
FROM sales_records ... INNER JOIN location_group_memberships INNER JOIN location_groups
WHERE <whereClause>
GROUP BY location_groups.id, location_groups.name
ORDER BY revenue DESC
```

`SUM(DISTINCT locations.num_rooms)` deduplicates by VALUE, not by row — two hotels both with 100 rooms produce `total_rooms = 100`. `total_kiosks` is hard-coded NULL.

`revenuePerRoom`, `txnPerKiosk`, `avgBasketValue` derived in JS (`location-groups.ts:103-120`). `txnPerKiosk` is always null (because `total_kiosks` is null).

Filters: full `whereClause`.

### Group Metrics

Type: KPI grid (Revenue, Transactions, Hotels, Total Rooms).
Render: `location-metrics.tsx:19-57`.
Data: `getLocationGroupDetail` summary (`location-groups.ts:135-150`). Same shape as the selector query, restricted by `location_groups.id IN (:selectedGroupIds)`. `previousMetrics` via shifted date range.

### Capacity Metrics

Type: KPI grid (6 cards: Rev/Room, Txn/Room, Txn/Kiosk, Avg Basket, Total Rooms, Total Kiosks).
Render: `capacity-metrics.tsx:16-52`.
Data: derived in JS from the summary block (`location-groups.ts:159-162`):

- `revenuePerRoom = totalRooms > 0 ? revenue / totalRooms : null`
- `txnPerRoom = totalRooms > 0 ? transactions / totalRooms : null`
- `txnPerKiosk = totalKiosks > 0 ? transactions / totalKiosks : null` (always null because totalKiosks is null)
- `avgBasketValue = transactions > 0 ? revenue / transactions : 0`
- `totalRooms`, `totalKiosks` passed through.

Filters: inherited from summary.

### Peer Analysis

Type: Cards (one per metric) with percentile rank vs all groups.
Render: `peer-analysis.tsx:26-65`.
Data: `getLocationGroupDetail` peer block (`location-groups.ts:164-197`).

```ts
const allGroupsData = await getLocationGroupsList(filters, userCtx);
peerAnalysis = [
  { metric: 'Revenue',          value: revenue,        percentile: calculatePercentile(...) },
  { metric: 'Transactions',     value: transactions,   percentile: calculatePercentile(...) },
  { metric: 'Avg Basket Value', value: avgBasketValue, percentile: calculatePercentile(...) },
  // 'Revenue / Room' appended only if revenuePerRoom !== null
];
```

`calculatePercentile` returns `count(values <= self) / count(all) * 100`. The current group is included in the cohort (self-inclusion).

Peer cohort: ALL location groups in the system that have any transactions in the period under the active filters. Not scoped to "groups of the same `location_type`".

Filters: filters propagate via the recursive `getLocationGroupsList` call.

### Hotels in Group

Type: Table.
Render: `hotel-breakdown.tsx:24-81`. Same shape as Hotel Groups' `hotel-list.tsx`.
Data: `getLocationGroupDetail` hotel breakdown (`location-groups.ts:200-225`).

Same columns and same nullability as the Hotel Groups version (`quantity = COUNT(*)`, `kiosks = NULL`, outlet code shown without region).

---

## Compare dashboard

Render: `src/app/(app)/analytics/compare/page.tsx`
Server actions: `src/app/(app)/analytics/compare/actions.ts`
Cards/table: `src/app/(app)/analytics/compare/comparison-cards.tsx`
Query: `src/lib/analytics/queries/comparison.ts`

### Control Panel

Type: Tab + multi-select + Compare button.
Render: `page.tsx`. Three entity types: `location`, `hotel_group`, `region`. On entity-type change, `fetchEntityOptions(entityType)` calls `getEntityOptions` (`comparison.ts:211-237`) which returns *all* rows from the matching table sorted by name (no scoping, no search, no pagination). Compare button disabled until `selectedIds.length >= 2`.

Filters are read from the global analytics filter store. `JSON.stringify(filters)` is used as a dependency proxy. Switching entity types resets selection, results, and error.

The IDs are interpolated into SQL via `sql.raw` with hand-rolled single-quote escaping (`comparison.ts:70`) — `entityIds.map(id => '${id}')`. UUID-only inputs make the practical risk low but the helper isn't injection-safe in general.

### Comparison Cards

Type: Three cards per entity (Revenue, Transactions, Avg Basket).
Render: `comparison-cards.tsx`.
Data: server actions per entity type (`comparison.ts:84-207`).

Per-entity SQL shapes:

- **Location** (`comparison.ts:101-107`): `SUM(net_amount)`, `COUNT(*)`, `revenue / transactions` from `sales_records ... INNER JOIN locations` filtered by `locationId IN (...)`.
- **Hotel group** (`comparison.ts:144-148`): joins `salesRecords → locations → locationHotelGroupMemberships → hotelGroups` filtered by `hotelGroupId IN (...)`.
- **Region** (`comparison.ts:188-190`): joins via `location_region_memberships` filtered by `regionId IN (...)`.

`avgBasket = transactions > 0 ? revenue / transactions : 0` — computed server-side per entity. Result rows ordered by revenue DESC, regardless of selection order.

`getBestValues` picks `Math.max` per metric; the winning cell renders in emerald-600 (`comparison-cards.tsx:11-17, 36`). The highlight is suppressed when the winning value is zero.

`useMetricLabel()` swaps "Revenue" ↔ "Sales" labels per `metricMode`. "Transactions" and "Avg Basket" labels are hard-coded — they do not change in revenue mode even though the underlying definition does.

Filters: global analytics filter store via `storeStateToAnalyticsFilters`. No comparison period (Compare is current-period side-by-side).

---

## Pivot Table dashboard

Render: `src/app/(app)/analytics/pivot-table/page.tsx`
Server actions: `src/app/(app)/analytics/pivot-table/actions.ts`
Field list: `src/app/(app)/analytics/pivot-table/field-list.tsx`
Drop zones / toolbar: `drop-zones.tsx`, `pivot-toolbar.tsx`
Result table: `pivot-result-table.tsx`
Engine: `src/lib/analytics/pivot-engine.ts`
Query orchestrator: `src/lib/analytics/queries/pivot.ts`
Filter store: `usePivotFilterStore` (independent of the global store)
Pivot store: `src/lib/stores/pivot-store.ts`

### Field List + Pivot Builder

Type: DnD builder.
Render: `field-list.tsx`, `drop-zones.tsx`, `pivot-toolbar.tsx`.
Available fields (`pivot-store.ts:12-25`):

- Dimensions (9): `product_name`, `outlet_code`, `hotel_name`, `hotel_group`, `region`, `location_group`, `sale_month`, `sale_year`, `sale_hour`.
- Metrics (3): `gross_amount` (label "Revenue"), `quantity`, `booking_fee`.

Drag rules (`pivot-store.ts:64-88`): dimensions drop into rows or columns; metrics drop into values. Adding a dimension to one zone removes it from the other. No filters drop zone exists.

Default aggregation: `'sum'`. Toolbar exposes Run Analysis (disabled when `values.length === 0`), Clear All, MoM, YoY.

The engine maps logical field names to physical SQL via `ALLOWED_COLUMNS` (`pivot-engine.ts:38-50`):

```
hotel_group     → locations.hotel_group        (legacy free-text column)
location_group  → locations.location_group     (legacy free-text column)
region          → locations.region             (column dropped in migration 0022)
gross_amount    → sales_records.gross_amount   (column dropped)
quantity        → sales_records.quantity       (column dropped)
booking_fee     → sales_records.booking_fee    (column dropped)
sale_commission → sales_records.sale_commission (column dropped)
discount_amount → sales_records.discount_amount (column dropped)
```

`buildPivotWhereString` (`pivot.ts:43-109`) extracts Drizzle's parameter placeholders from the WHERE clause and string-replaces them with raw escaped values (single-quote escape only, no backslash/null-byte handling).

### Pivot Result Table

Type: Cross-tab table.
Render: `pivot-result-table.tsx`. `data.headers` on top, `data.rows[i].dimensions` (left) + `data.rows[i].cells` (right) per row. A "Totals" row is sticky at the bottom. Truncation banner above when `truncated=true`.

Engine output (`pivot-engine.ts`):

- `MAX_ROWS = 10_000`. `rowCount` is post-truncation. `truncated` flips when `rawRows.length > MAX_ROWS`.
- Grand totals (lines 380-397): `sum` totals are sums of per-bucket sums; `avg` totals are unweighted means of per-bucket averages; `min`/`max` totals are min/max across buckets. Totals are keyed by `${aggregation}_${field}` only — they are NOT keyed per column-pivoted cell.
- `_change` columns from comparison mode: header gets `(% Change)` suffix; cell value is `(current - prev) / prev * 100`. Header-matching for `_change` columns uses positional fallback (`pivot.ts:218-220, 273-274`).

Comparison mode uses `getComparisonDates(...)` (MoM or YoY) on the SQL filter dates, runs the same query against the shifted range, then merges by row-key (positional fallback when keys differ).

Filters: pivot uses `usePivotFilterStore`, NOT the global analytics filter store. State does not sync. The pivot page does not mount a FilterBar.

---

## Trend Builder dashboard

Render: `src/app/(app)/analytics/trend-builder/page.tsx`
Server actions: `src/app/(app)/analytics/trend-builder/actions.ts`
Series builder: `series-builder-panel.tsx`, `series-row.tsx`
Trend chart: `trend-chart.tsx`
Weather mini chart: `weather-mini-chart.tsx`
Event annotations: `event-annotations.tsx`
Granularity selector: `granularity-selector.tsx`
Store: `src/lib/stores/trend-store.ts`
Query: `src/lib/analytics/queries/trend-series.ts`

### Granularity + Toggles

Type: Toolbar.

`autoGranularity(from, to)` (`formatters.ts:105-112`): `<= 31 days → daily`, `<= 90 → weekly`, otherwise monthly.

Granularity is applied client-side in `TrendChart.mergeSeriesData` — the SQL query always returns daily rows.

Bucketing helpers:

- `dateToBucket` returns the date itself (daily), the ISO Monday of the week (weekly via `getISOWeekMonday`, `formatters.ts:114-121`), or the first-of-month string (monthly via `getMonthBucket`, `formatters.ts:123-125`).
- `getISOWeekMonday` parses `YYYY-MM-DD` as `new Date(dateStr + "T00:00:00Z")` — UTC math — even though `transactionDate::text` is timezone-naive.
- `getMonthBucket` slices `dateStr.slice(0,7) + "-01"`.

Toggles wire into `useTrendStore`: `showWeather`, `showEvents`, `showYoY`, `rollingAverage` (null | 7 | 30).

Weather is gated on `weatherAllowed` — exactly one location group present in either per-series filters union OR (fallback) the global filter store.

YoY: when on, `fetchTrendSeriesDataYoY` runs in parallel. Previous-year dates fetched then mapped forward by +1 year client-side via `setFullYear(getFullYear() + 1)`.

### Series Builder Panel

Type: Series list (max 6).
Render: `series-builder-panel.tsx`.

Each series has: id, metric (`revenue`|`transactions`|`avg_basket_value`|`booking_fee`), filters (productIds, locationIds, hotelGroupIds, regionIds, locationGroupIds), color (cycled from 8 brand colors), label (auto-generated from raw IDs unless edited), hidden flag.

`pendingSeries` is the in-edit list; `appliedSeries` drives the chart. Apply button copies pending → applied.

Per-series filters are the only dimensional filters used. The trend page reads `dateRange` and `locationGroupFilter` (latter for weather gating) from the global analytics filter store; ALL OTHER global filters (`hotelIds`, `regionIds`, `productIds`, `hotelGroupIds`, `metricMode`, `locationTypes`, `maturityBuckets`) are not consulted. The page does not mount a FilterBar.

`metricExpression` (`trend-series.ts:75-91`) shapes:

- `revenue`: `SUM(net_amount)`.
- `transactions`: `COUNT(*)::numeric`.
- `avg_basket_value`: `SUM(net_amount) / NULLIF(COUNT(*), 0)`.
- `booking_fee`: `SUM(CASE WHEN is_booking_fee THEN net_amount ELSE 0 END)` — only `is_booking_fee=true`, ignores `netsuite_code='9992'`.

`buildSeriesDimensionFilters` (`trend-series.ts:36-73`) covers product, location, hotel-group, region, location-group via `IN` / sub-`IN`. Maturity and locationType are NOT honoured.

### Main Trend Chart

Type: Multi-line, dual-axis, weather band, event annotations.
Render: `trend-chart.tsx`. Recharts `LineChart`. Currency metrics (`revenue`, `avg_basket_value`, `booking_fee`) → left Y-axis; count metrics (`transactions`) → right Y-axis. Single-axis if all series on the same side.

Series merged + bucketed by date in `mergeSeriesData` (`trend-chart.tsx:41-72`). Sum across same-bucket points within a series. Note: for `avg_basket_value`, this sums daily averages (not a weighted average) — the code comment acknowledges this as "an approximation".

YoY data merged with `_yoy` suffix (`trend-chart.tsx:117-134`). Tooltip / Legend strip the `_yoy` suffix and look up the parent series for label.

`EventAnnotations` (`event-annotations.tsx`) renders `ReferenceLine` for point events and `ReferenceArea` for range events, filtered by `activeCategories` only — NOT filtered by series scope.

`connectNulls` is `true` on line series.

Rolling average: `applyRollingAverage` (`rolling-average.ts:5-20`) takes `windowSize` as a number of array indices (not calendar days). UI labels "7d Avg" / "30d Avg" — accurate only at daily granularity.

### Weather Mini Chart

Type: Optional ComposedChart (bars for precip, dual lines for temps).
Render: `weather-mini-chart.tsx`. Renders below main chart when `showWeather=true` and gating allows.
Data: `fetchWeatherForLocationGroup(groupId, dateFrom, dateTo)` (`actions.ts:50-79`) — joins `location_group_memberships → locations`, picks the first location with non-null lat/lng (no `ORDER BY`), calls Open-Meteo.

UI gate is "exactly one location group" — but the group can span many physical hotels in different cities, and the weather is for whichever single hotel the query returned.

---

## Commission dashboard

Render: `src/app/(app)/analytics/commission/page.tsx`
Server actions: `src/app/(app)/analytics/commission/actions.ts`
Engine: `src/lib/commission/processor.ts`, `src/lib/commission/engine.ts`

The dashboard reads from `commission_ledger` joined to `sales_records` and `locations`. Its WHERE assembly is `buildCommissionWhere` (`actions.ts:70-82`): combines `dateCondition` (on `sales_records.transaction_date`), `outletExclusions` via `buildExclusionCondition`, and dimension filters. It does NOT use `scopedSalesCondition`, `buildMaturityCondition`, or `buildMetricModeCondition`.

### KPI Cards

Type: KPI strip (Total Commission, Commissionable Revenue, Avg Rate, Records with Commission).
Render: `page.tsx:151-161`.
Data: `actions.ts:95-104`.

| KPI | Formula |
|---|---|
| Total Commission | `SUM(commission_ledger.commission_amount)` over rows where `is_reversal = false`. |
| Commissionable Revenue | `SUM(commissionable_amount)` over rows where `is_reversal = false`. Note: `commissionable_amount` is the booking-fee row's `netAmount` passed to `calculateCommission` as `grossAmount` (`processor.ts:235`) — i.e. WKG fee revenue, not hotel sales. The label is misleading. |
| Average Rate | `(totalCommission / totalCommissionable) * 100`, with `> 0` guard returning 0 (`actions.ts:109-111`). |
| Records with Commission | `COUNT(*)` over `commission_ledger` rows where `is_reversal = false`. |

Deltas: same query against the previous period (`getPreviousPeriodDates`); pct change for commission/commissionable/recordCount; pp delta for `avgRate`.

Reversal handling: when an admin runs `triggerRecalculation` for a `(locationProduct, month)`, the processor inserts a row with `is_reversal=true`, `commissionAmount = -original`, `commissionableAmount = +original` (NOT `-original`), then inserts a fresh `is_reversal=false` row from the recalc. The dashboard filter `is_reversal = false` excludes the negative reversal entirely — both the original and the recalculated row are counted.

Filters: date, outlet exclusion, dimension filters. Not metricMode, not maturity, not scope.

### By Location

Type: Table.
Render: `page.tsx:200-232`.
Data: `actions.ts:156-190`.

```sql
SELECT location_id, location_name,
       SUM(commissionable_amount), SUM(commission_amount), COUNT(*)
FROM commission_ledger ... JOIN sales_records JOIN locations
WHERE <buildCommissionWhere> AND is_reversal = false
GROUP BY location ORDER BY SUM(commission_amount) DESC
```

`effectiveRate = commissionable > 0 ? (commission / commissionable) * 100 : 0`. No LIMIT.

### By Product

Type: Table.
Render: `page.tsx:235-265`.
Data: `actions.ts:196-227`.

Group by `products.id, products.name`. Same SUM/COUNT shape as By Location. React row key is `productName`.

### Monthly Trend

Type: Bar chart.
Render: `page.tsx:267-294`.
Data: `actions.ts:233-258`.

```sql
SELECT to_char(transaction_date, 'YYYY-MM') AS month,
       SUM(commission_amount), SUM(commissionable_amount)
FROM commission_ledger ...
WHERE <buildCommissionWhere> AND is_reversal = false
GROUP BY month ORDER BY month
```

Only the commission series is rendered as bars; commissionable is fetched but unused. Partial first/last months are not flagged.

---

## Experiments dashboard

Render: `src/app/(app)/analytics/experiments/page.tsx`
Server actions: `src/app/(app)/analytics/experiments/actions.ts`
Cohort form: `cohort-form.tsx`
Backend: `src/lib/analytics/queries/experiments.ts`
Storage: `experiment_cohorts` table.

### Cohort List + Create Cohort form

Type: Left-rail list + form.
Render: `page.tsx:280-332`, `cohort-form.tsx`.

`listCohorts()` returns all cohorts for admins; only `createdBy = me` for non-admins (`actions.ts:60-70`).

`listLocationsForPicker()` returns ALL locations sorted by name — no scope filter, no exclusion filter (`actions.ts:78-87`).

Form modes: `rest_of_portfolio`, `named_control`, `similar_hotels`. `similar_hotels` collapses to `named_control` with auto-populated IDs. "Find Similar Hotels" calls `findSimilarLocations` (`queries/experiments.ts:137`): cohort avg `numRooms` ±max(30%, 20 rooms), avg revenue per location ±40%, returns up to 10 IDs. Excludes cohort locations and locations with `numRooms IS NULL`.

`createCohort` writes to `experiment_cohorts` and audit-logs (`actions.ts:96-129`). `deleteCohort` hard-deletes.

### Temporal Analysis

Type: KPI grid (4 cards: Pre / During / YoY Pre / YoY During).
Render: `page.tsx:368-389`.
Data: `actions.ts:241-262`, `queries/experiments.ts:225-294`.

Windows:

- Pre: 30 days BEFORE `interventionDate`.
- During: `interventionDate` to `interventionDate + 30 days`.
- YoY Pre / YoY During: same windows shifted -1 year via `getComparisonDates(..., "yoy")`.

Each window is fetched via `getCohortMetrics(locationIds, {dateFrom, dateTo}, userCtx)` with a NEW filters object containing ONLY date strings. `metricMode`, `maturityBuckets`, `productIds`, `hotelGroupIds`, `regionIds`, `locationGroupIds`, `locationTypes` from the global filter store are NOT propagated.

`revChange` displayed: `(during.revenue - pre.revenue) / pre.revenue * 100` (and same for YoY pair). No statistical-significance test, no diff-in-diff.

Date arithmetic uses `new Date(interventionDate).setDate(...)` then `toISOString().split('T')[0]` — UTC-based, can shift by a day in local-TZ deploys.

### Cohort vs Control

Type: 3-card grid (Revenue / Transactions / Avg Rev/Txn).
Render: `page.tsx:391-425`.
Data: `actions.ts:164-206`, `queries/experiments.ts:27-131`.

- Cohort: `getCohortMetrics(cohort.locationIds, filters, ctx)`.
- Control:
  - `named_control`: `getCohortMetrics(cohort.controlLocationIds, filters, ctx)`.
  - `rest_of_portfolio`: `getRestOfPortfolioMetrics(cohort.locationIds, filters, ctx)` — adds `locationId NOT IN (cohort)` to the WHERE.
- Both apply scope, active-locations, date, maturity, metricMode, dimension filters (full filter set).

`delta = cohortMetrics - controlMetrics` (raw absolute, NOT normalised per-location). For `rest_of_portfolio`, the control cohort can be 1000+ locations vs a 5-location cohort — the delta is dominated by absolute scale.

`avgRev/Txn` is `revenue / transactions` per side, comparable across sides.

If `named_control.controlLocationIds` is empty, `getCohortMetrics([])` returns `{revenue: 0, transactions: 0, avgRevenue: 0}` (`queries/experiments.ts:32-34`); delta = cohort - 0 = cohort.

Cohort/control overlap is silently allowed (no dedup check).

---

## Actions Dashboard

Render: `src/app/(app)/analytics/actions-dashboard/page.tsx`
Server actions: `src/app/(app)/analytics/actions-dashboard/actions.ts`
Storage: `action_items` table; linked entity `location_flags` (separate table).

### Filter Tabs

Type: Status tabs + type select.
Render: `page.tsx:31-46, 132-163`. Status: All / Open / In Progress / Resolved / Cancelled (single-select). Type: All / Investigation / Relocation / Training / Equipment Change.

Both feed `listActionItems(filters)` which builds `eq()` conditions on status + actionType + ownerId (`actions.ts:43-53`). No "Mine only" filter, no location filter, no global filter integration.

### Actions Table

Type: Table.
Render: `page.tsx:165-316`. Columns: Title (+description), Location, Type, Status (badge), Due Date, Created (date), Actions (status select + outcome notes).
Data: `actions.ts:34-101`.

LEFT JOIN locations (so actionItems with `locationId IS NULL` still render). LEFT JOIN owner (user.name).

Order: `createdAt ASC` (oldest first).

Inline resolve flow: status → "resolved" opens an inline outcome-notes textarea below the table; submit calls `updateActionItemStatus(id, "resolved", outcomeNotes)`. The form appears as a new `<TableRow>` at the END of the body, not inline next to the row being resolved.

Open count in the header (`page.tsx:114`) = items where status is `open` or `in_progress`. Overdue items are not surfaced as overdue — Due Date renders the date string verbatim.

`resolvedAt` is stored on `action_items` but never displayed.

`createActionItem` and `updateActionItemStatus` re-run the full table query after mutation just to find the newly-mutated row (`actions.ts:148-149, 212-213`).

The flag → action linkage is OPT-IN only via the FlagDialog footer "Create Action Instead" button (`flag-dialog.tsx:117-127`). It's an XOR — the user creates EITHER a flag OR an action. When "Create Action Instead" is clicked, `sourceType="flag"` is passed but `sourceId` is not (because the flag was never created). `createFlag` (`flags/actions.ts:85-117`) only inserts into `location_flags` and does not touch `action_items`.
