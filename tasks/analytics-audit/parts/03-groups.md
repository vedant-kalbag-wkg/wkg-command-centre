# Regions / Hotel Groups / Location Groups Dashboards — Logic & Audit

Auditor scope: the three "selector + drill-down" grouping dashboards. All three share an identical UX shell (PageHeader + accordion containing Selector → Detail panels), and all three rely on many-to-many membership tables. That membership boundary is where most of the bugs found below sit.

Schema anchor (all three tables, `src/db/schema.ts:526-575`):

- `location_hotel_group_memberships(location_id, hotel_group_id)` — composite PK, no time-bound.
- `location_region_memberships(location_id, region_id)` — composite PK, no time-bound.
- `location_group_memberships(location_id, location_group_id)` — composite PK, no time-bound.

None of the three membership tables records validity dates (no `valid_from` / `valid_to`); a location's membership is treated as eternally true once the row exists. There is no SCD-2 history. A location may belong to multiple hotel groups, multiple regions, and multiple location groups simultaneously (PKs do not preclude multiplicity).

Cache wrapper note (applies to every fetch action in this audit): all three dashboards' server actions go through `wrapAnalyticsQuery` (`src/lib/analytics/cached-query.ts:73-95`) which **discards the caller's `userCtx` and substitutes `INTERNAL_USER_CTX = { role: 'admin' }`** (line 86). For internal admins this is a no-op; for any future scoped-internal user it would silently return unscoped data. Flagged as P1 latent issue against all three dashboards.

---

# Regions Dashboard — Logic & Audit

Page: `src/app/(app)/analytics/regions/page.tsx`
Actions: `src/app/(app)/analytics/regions/actions.ts`
Query layer: `src/lib/analytics/queries/regions.ts`
Shared FROM helper: `regions.ts:66-72` — `salesRecords INNER JOIN locations INNER JOIN location_region_memberships INNER JOIN regions LEFT JOIN markets`

WHERE builder (`regions.ts:39-62`): combines `dateCondition`, `scopedSalesCondition`, `buildActiveLocationCondition` (replaces outlet exclusions), `maturityCondition`, `metricModeCondition`, plus all dimension filters.

---

## Section: Region Selector (accordion of region cards grouped by market)

### Logic

- **Render:** `region-selector.tsx:104-172`. Cards grouped by `marketName`; "Unassigned" bucket for regions with `marketId IS NULL`. Card body shows region name, revenue, `hotelGroupCount` (mislabelled as "groups"), and `transactions`.
- **Data source:** `getRegionsList` in `regions.ts:76-135` — two parallel queries, joined client-side via `countMap`.

**Query 1 — revenue/txn per region** (`regions.ts:90-102`):
```sql
SELECT
  regions.id, regions.name, markets.id, markets.name,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*) AS transactions
FROM sales_records
  INNER JOIN locations ON sales_records.location_id = locations.id
  INNER JOIN location_region_memberships ON locations.id = location_region_memberships.location_id
  INNER JOIN regions ON location_region_memberships.region_id = regions.id
  LEFT JOIN markets ON regions.market_id = markets.id
WHERE <date + scope + active-location + maturity + metricMode + dimension filters>
GROUP BY regions.id, regions.name, markets.id, markets.name
ORDER BY revenue DESC
```

**Query 2 — hotel-group-count and location-group-count per region** (`regions.ts:107-118`):
```sql
SELECT
  location_region_memberships.region_id,
  COUNT(DISTINCT location_hotel_group_memberships.hotel_group_id) AS hotel_group_count,
  COUNT(DISTINCT location_group_memberships.location_group_id)   AS location_group_count
FROM location_region_memberships
  LEFT JOIN location_hotel_group_memberships ON location_region_memberships.location_id = location_hotel_group_memberships.location_id
  LEFT JOIN location_group_memberships       ON location_region_memberships.location_id = location_group_memberships.location_id
GROUP BY location_region_memberships.region_id
```

**Filters/modes that affect this section:**
- Query 1: date range, scoping, active-location (replaces outlet exclusion), maturity buckets, metricMode (revenue vs sales), dimension filters (hotelIds, hotelGroupIds, locationGroupIds, productIds, locationTypes, regionIds).
- Query 2: **none** — runs unfiltered against the membership tables.

**Business meaning:** Picker for the region drill-down. Lets the user multi-select regions (URL-synced via `?region=id,id`) to view aggregated metrics underneath.

**Edge cases / things worth flagging:**
- Card label says "groups" — context (hotel group vs location group) is implicit; UI doesn't disambiguate.
- Regions with zero transactions in the period are excluded entirely (INNER JOIN to salesRecords); the selector cannot show "this region exists but had no sales".
- A market named literally "Unassigned" would collide with the synthetic bucket label.

### Issues

**P1 — Selector counts ignore all dashboard filters.** `regions.ts:107-118` runs Query 2 with no `WHERE` clause whatsoever. The "8 hotel groups, 4 location groups" badge on a region card is the **all-time** count of distinct memberships in that region — not the count for the selected period, scope, location-type, etc. If a region had a hotel-group membership added a year ago that has zero sales today, it's still counted. If the user scopes to "Hotels in Region X" with `hotelGroupIds=[A]`, the revenue figure responds but the counts do not. Repro: change date range to a single day with no sales for some region → Query 1 hides the region (so no card), but if region survives, the counts still come from the global membership table. Fix: thread `whereClause` through Query 2 by joining sales_records, OR document explicitly that counts are "all-time membership count, not period-active". File: `regions.ts:107-118`.

**P1 — Cross-region multi-membership double-counts revenue.** `baseFromWithRegions()` does `salesRecords INNER JOIN location_region_memberships`. If a location has rows in `location_region_memberships` for both UK and IE (legit per schema — composite PK doesn't preclude it), every sales row for that location appears twice in the FROM. Region cards then each show the FULL revenue of that location, so SUM(region.revenue) > portfolio.revenue. Repro: pick a location with two `location_region_memberships` rows; sum the revenue of the two affected region cards and compare to the same location's row in the Hotels dashboard. File: `regions.ts:66-72, 90-102`.

**P0 — Selecting multiple regions double-counts revenue at the metrics level if any location is in more than one selected region.** `getRegionDetail` (`regions.ts:139-274`) summary query uses the same `baseFromWithRegions()` plus `regions.id IN (...)`. A location in regions {UK, IE} when both are selected → its sales rows fan out to two membership rows, both pass `regions.id IN (UK, IE)`, so revenue and transaction count are doubled. The KPI strip will read 2x what the same date range reads in Portfolio. Same defect for the previous-period block, so MoM% is undefined-but-stable. File: `regions.ts:152-158, 248-254`.

**P3 — Unused import.** `calculatePeriodChange` imported (`regions.ts:26`) but never used (only `getPreviousPeriodDates` is). Dead-code sweep candidate.

**P3 — Region cards show no MoM/YoY indicator** even though `previousMetrics` is computed for the detail panel. Mild inconsistency vs Hotel Groups list (which DOES emit `revenueChange` per-group).

**P3 — No `previousMetrics` cap on cards.** The list query has no `LIMIT`; if regions count grew large the selector renders all of them inline. Currently fine (~10 regions), worth noting.

---

## Section: Region Metrics (KPI grid: Revenue, Transactions, Hotel Groups, Location Groups)

### Logic

- **Render:** `region-metrics.tsx:18-56`. 4-card grid; first two cards display MoM change.
- **Data source:** `getRegionDetail` summary block (`regions.ts:148-158`) plus `previousMetrics` block (`regions.ts:237-261`).

```sql
SELECT
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*) AS transactions
FROM sales_records
  INNER JOIN locations ...
  INNER JOIN location_region_memberships ...
  INNER JOIN regions ...
WHERE <whereClause> AND regions.id IN (:selectedRegionIds)
```

`hotelGroupCount` and `locationGroupCount` on the KPI cards are NOT a separate query — they're set to `hotelGroupBreakdown.length` and `locationGroupBreakdown.length` (`regions.ts:267-268`). So they reflect **the number of hotel groups / location groups that had at least one transaction in the selected period for the selected region(s) under the active filters**. This is the correct definition for "groups active in this region this period" — but the **same labels appear on the selector card** with a *different* definition (all-time membership count, see Selector P1 above). The two cards say "Hotel Groups: 8" and "Hotel Groups: 5" for the same region under different scopes — confusing.

**Filters/modes:** all of `whereClause` (date, scope, active-location, maturity, metricMode, dimension filters). Region IDs from the URL drive the inclusion list.

**Edge cases:**
- `previousMetrics` comes from `getPreviousPeriodDates` (`metrics.ts:13-26`) — pure period-shift (subtract `(to - from + 1day)` from `from`). NOT `getComparisonDates(... 'mom' | 'yoy')`. So the indicator is always "previous period" regardless of any MoM/YoY toggle elsewhere — the page has no toggle today, so this is consistent, but worth noting.
- `revenueChange` denominator-zero handled in `calculatePeriodChange` returning null.

### Issues

**P0 — Same multi-region double-counting carries through.** See Selector P0 above; the metrics card displays inflated figures for any multi-select intersecting a multi-region location. File: `regions.ts:152-158`.

**P1 — Same metric label, two different formulas across the page.** Selector "Hotel Group Count" = all-time membership count. Metric "Hotel Group Count" = count with at least one transaction in the period. Repro: select a region whose membership includes a defunct hotel group (no sales in period) — selector reads N+1, metric grid reads N. Fix: pick one definition (recommend "active-in-period") and apply consistently.

**P3 — KPI card has no `loading` skeleton drift handling.** The page-level skeleton (`page.tsx:188-191`) replaces the whole grid; KpiCard's `loading` prop is wired but unused at this site. Cosmetic.

---

## Section: Hotel Groups in Region (table)

### Logic

- **Render:** `hotel-group-breakdown.tsx:20-60`. Columns: Hotel Group, Revenue/Sales, Transactions, Hotels, Avg/Hotel.
- **Data source:** `regions.ts:172-191`:

```sql
SELECT
  hotel_groups.name AS group_name,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*) AS transactions,
  COUNT(DISTINCT sales_records.location_id) AS hotel_count
FROM sales_records
  INNER JOIN locations ON sales_records.location_id = locations.id
  INNER JOIN location_hotel_group_memberships ON locations.id = location_hotel_group_memberships.location_id
  INNER JOIN hotel_groups ON location_hotel_group_memberships.hotel_group_id = hotel_groups.id
WHERE sales_records.location_id IN (
        SELECT location_region_memberships.location_id
        FROM location_region_memberships
        WHERE location_region_memberships.region_id IN (:selectedRegionIds)
      )
  AND <whereClause>
GROUP BY hotel_groups.id, hotel_groups.name
ORDER BY revenue DESC
```

`avgRevenuePerHotel` computed in JS as `revenue / hotelCount` (line 201).

**Filters/modes:** date, scope, active-location, maturity, metricMode, dimension filters. `regionFilter` is encoded via the `locationIdsInRegion` subquery (NOT via `regions.id IN (...)`).

**Business meaning:** "Of the locations that are in this region, what does revenue look like broken out by their hotel-group affiliation?"

**Edge cases:**
- Hotel group with members in multiple regions: only the in-region locations are summed (good).
- Hotel group rows appear for **every group with at least one sale of one in-region location** — including the location's "non-primary" group, since this dashboard ignores `canonicalHotelGroupNameFragment` from `shared.ts:187-200`.

### Issues

**P0 — Membership double-counting across hotel groups.** `INNER JOIN location_hotel_group_memberships` fans rows out by hotel-group membership. A location belonging to {Group A, Group B} contributes its full revenue to **both** group rows. SUM(group.revenue) for the table > total revenue for the region. The Portfolio dashboard uses `canonicalHotelGroupNameFragment` (`shared.ts:187-200`) to collapse to one group per location precisely to avoid this; this query does not. Repro: find a location in two hotel groups (operating_group_id set + a separate `location_hotel_group_memberships` row), aggregate the region's hotel-group breakdown rows, compare to region total — they will not match. File: `regions.ts:184-191`.

**P0 — `hotel_count` similarly double-counts locations that have multi-group memberships,** but only across rows, not within. A specific group's `COUNT(DISTINCT location_id)` is correct for that group; but **summing `hotel_count` across the breakdown table > distinct hotels in region**. Users who tally the column expect parity with the Region Metrics "Hotels" count and won't get it. File: `regions.ts:182`.

**P1 — `avgRevenuePerHotel` inherits the double-count.** Numerator is double-counted at row level; denominator is the in-group distinct count (also potentially carrying a location twice if it's in two groups, but in this single row it's distinct). The ratio is meaningful within one row but cross-row comparisons are skewed. File: `regions.ts:201`.

**P2 — Booking-fee semantics asymmetric.** With default `metricMode='sales'`, fee rows count toward `transactions` and `revenue` (per `buildMetricModeCondition` returning undefined). Switching to `metricMode='revenue'` changes both revenue (now fees only) AND `hotel_count` (only hotels with at least one fee row qualify). So "number of hotels" silently changes when a user toggles modes — surprising for a dimensional count. File: `regions.ts:172-191`.

**P3 — Hotel groups are not joined back to operating-group canonicalisation.** Other dashboards collapse to canonical group name; this one shows whatever raw memberships exist. Inconsistency with Portfolio tier tables.

---

## Section: Location Groups in Region (table)

### Logic

- **Render:** `location-group-breakdown.tsx:20-60`. Columns: Location Group, Revenue/Sales, Transactions, Outlets, Total Rooms.
- **Data source:** `regions.ts:206-227`:

```sql
SELECT
  location_groups.name AS group_name,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*) AS transactions,
  COUNT(DISTINCT sales_records.location_id) AS outlet_count,
  SUM(locations.num_rooms) AS total_rooms
FROM sales_records
  INNER JOIN locations ...
  INNER JOIN location_group_memberships ...
  INNER JOIN location_groups ...
WHERE sales_records.location_id IN (locationsInRegion subquery)
  AND <whereClause>
GROUP BY location_groups.id, location_groups.name
ORDER BY revenue DESC
```

**Filters/modes:** same as above (date, scope, active-location, maturity, metricMode, dimension filters).

### Issues

**P0 — `SUM(locations.num_rooms)` over a sales-records JOIN multiplies by transaction count.** This is the gnarliest bug in the file. The FROM clause has one row per `sales_records` row (post-join). `SUM(locations.num_rooms)` therefore sums `num_rooms` once per transaction, not once per location. A 100-room hotel with 5,000 transactions in the period yields `total_rooms = 500,000` for that hotel alone. Compounded: the value is meaningless. Compare to the location-groups dashboard own list query (`location-groups.ts:95`) which uses `SUM(DISTINCT locations.num_rooms)` — itself wrong (see Location Groups Selector P0 below) but at least bounded. The Region's "Location Groups in Region" table will read absurd "Total Rooms" figures any time there is more than one transaction per location. Repro: pick any location group with >1 day of sales, divide reported `total_rooms` by transaction count → recovers the actual room count, confirming the bug. File: `regions.ts:218`.

**P0 — Same membership double-counting as Hotel Groups in Region.** Locations in multiple location groups contribute revenue to each group row. File: `regions.ts:206-227`.

**P2 — `outlet_count` cross-row sum > distinct outlets.** Same caveat as `hotel_count` above. File: `regions.ts:217`.

---

# Hotel Groups Dashboard — Logic & Audit

Page: `src/app/(app)/analytics/hotel-groups/page.tsx`
Actions: `src/app/(app)/analytics/hotel-groups/actions.ts`
Query layer: `src/lib/analytics/queries/hotel-groups.ts`

WHERE builder (`hotel-groups.ts:36-58`): combines date, scope, **`buildExclusionCondition`** (NOT `buildActiveLocationCondition` — inconsistency with Regions and Location Groups), maturity, metricMode, dimension filters.

---

## Section: Hotel Groups Selector (multi-select with Revenue / Hotel-Count / Compact label)

### Logic

- **Render:** `group-selector.tsx:26-62`. `MultiSelectFilter` of options labelled `"<Group Name> (N hotels) £Xm revenue"`.
- **Data source:** `getHotelGroupsList` in `hotel-groups.ts:87-187`.

**Query (current period)** — uses CTE pre-aggregation by location to dodge a M2M fan-out cost (`hotel-groups.ts:114-137`):
```sql
WITH loc_agg AS (
  SELECT location_id,
         COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
         COUNT(*) AS transactions
  FROM sales_records INNER JOIN locations ON ...
  WHERE <whereClause>
  GROUP BY sales_records.location_id
)
SELECT hotel_groups.id, hotel_groups.name,
       COALESCE(SUM(la.revenue), 0) AS revenue,
       SUM(la.transactions) AS transactions,
       COUNT(DISTINCT la.location_id) AS hotel_count
FROM loc_agg la
INNER JOIN location_hotel_group_memberships ON la.location_id = location_hotel_group_memberships.location_id
INNER JOIN hotel_groups ON location_hotel_group_memberships.hotel_group_id = hotel_groups.id
GROUP BY hotel_groups.id, hotel_groups.name
ORDER BY revenue DESC
```

**Query (previous period)**: same CTE shape with shifted date range (`hotel-groups.ts:144-166`), used to compute `revenueChange` / `transactionChange` for the row.

**Filters/modes:** date, scope, **outlet exclusion (NOT active-location)**, maturity, metricMode, dimension filters. The CTE applies `whereClause` *before* the membership join, which is semantically equivalent to applying it after (everything in `whereClause` lives on `sales_records`/`locations` columns) — the comment at line 95-107 spells this out.

**Business meaning:** "Pick one or more hotel groups; what's their performance?"

**Edge cases:**
- Hotels-with-zero-sales-in-period are silently dropped (INNER JOIN to sales_records). The `hotelCount` displayed is "hotels-with-at-least-one-transaction-in-period", not "hotels-in-the-group". This is a different definition from Regions' `hotel_group_count` selector card (which uses the membership table directly).
- Selector label uses `formatCompactNumber` and lower-cases the suffix → "£1.2m" not "£1.2M" (intentional per the helper).

### Issues

**P0 — Membership double-counting across hotel groups.** Same root issue as Regions §HotelGroupsInRegion. A location with two hotel-group memberships contributes its revenue to both rows of the selector. Sum-of-rows > unique total. File: `hotel-groups.ts:124-137`.

**P0 — `hotel_count` is not stable under `metricMode` toggle.** The header context calls this out specifically. With `metricMode='sales'` (default), every transaction qualifies; `hotel_count` reflects "hotels with any sale". With `metricMode='revenue'`, only fee rows qualify, so a hotel with sales but no fee row drops out; `hotel_count` decreases. The "Hotels" KPI card on the detail panel will move when toggling Sales↔Revenue even though the underlying group composition didn't change. Repro: pick metricMode='sales', note hotelCount; toggle to 'revenue', count drops by however many hotels have only `9990`-style non-fee sales. File: `hotel-groups.ts:114-137, 209`.

**P1 — Inconsistency: Hotel Groups uses `buildExclusionCondition`, Regions and Location Groups use `buildActiveLocationCondition`.** Per the Phase 1 #6 comment in `regions.ts:43` the active-location predicate was the explicit replacement. Hotel Groups was not migrated. Functionally equivalent today, but the two predicates can diverge under maintenance (e.g. exclusion table edited mid-request); also a perf miss (active-location uses cached IDs + ANY-clause; exclusion does a NOT-EXISTS-against-locations subquery per call). File: `hotel-groups.ts:42`.

**P1 — `revenueChange` / `transactionChange` denominator NULL fallback.** `calculatePeriodChange` returns null when `previous=0` (`metrics.ts:6-9`). For a brand-new hotel group (no sales last period), the cards show no delta — fine. But the page renders nothing in that case (no fallback "new" badge), so users see "old groups have a delta, new groups don't" with no explanation. Cosmetic UX. File: `hotel-groups.ts:183-184`.

**P3 — `getHotelGroupsList` does not display `revenueChange`/`transactionChange` to the user.** The selector label only includes name, hotelCount and revenue — the deltas computed per row in lines 168-170 are unused. Either drop the previous-period query (saves a CTE re-run) or surface the delta in the label.

---

## Section: Group Metrics (KPI grid: Revenue, Transactions, Hotels, Avg/Hotel)

### Logic

- **Render:** `group-metrics.tsx:18-56`.
- **Data source:** `getHotelGroupDetail` summary (`hotel-groups.ts:200-217`):

```sql
SELECT
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*) AS transactions,
  COUNT(DISTINCT sales_records.location_id) AS hotel_count
FROM sales_records
  INNER JOIN locations ON sales_records.location_id = locations.id
  INNER JOIN location_hotel_group_memberships ON locations.id = location_hotel_group_memberships.location_id
  INNER JOIN hotel_groups ON location_hotel_group_memberships.hotel_group_id = hotel_groups.id
WHERE <whereClause> AND hotel_groups.id IN (:selectedGroupIds)
```

`avgRevenuePerHotel` = `revenue / hotelCount` in JS (`hotel-groups.ts:317`).

`previousMetrics` from same query against shifted date range (`hotel-groups.ts:286-310`).

**Filters/modes:** all `whereClause` filters + selected `groupIds`.

### Issues

**P0 — Multi-selecting hotel groups double-counts shared locations.** A location belonging to {Group A, Group B} when both are selected → INNER JOIN fans rows by membership → each sales row counted twice. KPI Revenue and Transactions both inflated. Repro: identical to Regions multi-region; use a location with operating_group_id=A and a `location_hotel_group_memberships` row for B, select both groups. File: `hotel-groups.ts:201-217`.

**P0 — Even single-select inflates if a location's membership row is duplicated.** Composite PK prevents duplicate (location_id, hotel_group_id) pairs, so this specific path is closed. But if two memberships for the SAME hotel group survive due to historical data drift, no defence. Defensive fix: pre-aggregate by location using the same CTE pattern as `getHotelGroupsList`. File: `hotel-groups.ts:209`.

**P1 — `hotel_count` definition shifts depending on metricMode** (same as Selector P0). File: `hotel-groups.ts:209, 217`.

**P2 — Comparison period uses pure period-shift, not "MoM"/"YoY".** `getPreviousPeriodDates` (`metrics.ts:13-26`) is a fixed shift. There is no UI toggle. If product wants explicit MoM vs YoY (header context mentioned a `comparisonMode`), this dashboard ignores it. File: `hotel-groups.ts:286-289`.

---

## Section: Hotels in Group (table: outlet code, hotel name, Revenue, Txn, Qty, Rooms, Stars, Rev/Room)

### Logic

- **Render:** `hotel-list.tsx:24-81`.
- **Data source:** `getHotelGroupDetail` hotel breakdown (`hotel-groups.ts:220-245`):

```sql
SELECT
  sales_records.location_id,
  COALESCE(locations.outlet_code, '') AS outlet_code,
  locations.name AS hotel_name,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*) AS transactions,
  COUNT(*) AS quantity,
  locations.num_rooms AS rooms,
  NULL AS kiosks,
  locations.star_rating
FROM sales_records
  INNER JOIN locations ON ...
  INNER JOIN location_hotel_group_memberships ON ...
  INNER JOIN hotel_groups ON ...
WHERE <whereClause> AND hotel_groups.id IN (:selectedGroupIds)
GROUP BY sales_records.location_id, locations.outlet_code, locations.name, locations.num_rooms, locations.star_rating
```

`revenuePerRoom = rooms ? revenue/rooms : null` in JS (`hotel-groups.ts:260`).

**Filters/modes:** same as summary.

### Issues

**P1 — `quantity` column is identical to `transactions`.** Both are `COUNT(*)::text` (`hotel-groups.ts:236-237`). The header advertises `Quantity` as a separate column. Should be `SUM(sales_records.quantity)` (or the relevant qty column) — currently misleading. Repro: any row will show identical Transactions and Quantity. File: `hotel-groups.ts:236-237`.

**P1 — `kiosks` is hardcoded NULL.** Header text labels Hotels in Group as having "kiosks" data; query emits `NULL::text` (`hotel-groups.ts:239`). The column isn't rendered in the React component (`hotel-list.tsx` doesn't include it), but the column is in the response shape, in the type, and the brief explicitly listed it. Either drop from the type or wire `activeKioskCountFragment` from `shared.ts:207-214`. File: `hotel-groups.ts:239`.

**P1 — `revenuePerRoom` denominator is **current** `locations.num_rooms`, not the room count as of the period.** `locations` is mutable and `num_rooms` may have changed since the period; there is no `num_rooms_history`. A hotel that had 50 rooms in 2024 and 100 today shows last-year revenue divided by 100 → understated. Same defect repeats across every per-room metric in this audit. File: `hotel-groups.ts:238, 260`.

**P1 — Outlet code shown without region disambiguation.** Per `schema.ts:160-162` outlet_code is unique only per `(primaryRegionId, outlet_code)` — "Q5" exists in GB and DE. The row renders only the hotel name + outlet code (`hotel-list.tsx:48-55`); for a multi-region hotel group, two rows can show "Q5" with different parent hotel names but no region indicator. Disambiguation requires either including region name in the row or prefixing the outlet code (e.g. "GB-Q5"). File: `hotel-list.tsx:50-54`, query in `hotel-groups.ts:233`.

**P2 — Reversal (refund) rows count as transactions but net out in revenue.** `COUNT(*)` on sales_records includes negative-amount reversal rows. So a hotel with one £100 sale + one £100 reversal shows `transactions=2, revenue=0`. This is the documented reversal behaviour from the brief but worth flagging at every `COUNT(*)` site. File: `hotel-groups.ts:236`.

**P2 — Multi-group selection causes hotels in multiple selected groups to appear once but with inflated revenue.** `GROUP BY sales_records.location_id, …` deduplicates the row, but `SUM(sales_records.net_amount)` is over the post-fan-out rowset; a location in {A, B} when both selected sums each transaction twice. Two-step de-dup (CTE pattern) needed. File: `hotel-groups.ts:235, 241-243`.

**P3 — `outletCode` defaults to empty string not NULL, then UI conditionally renders only on truthy.** `COALESCE(locations.outlet_code, '')` (`hotel-groups.ts:233`) is defensive but redundant per `schema.ts:163` (`outletCode` is NOT NULL).

---

## Section: Daily Trends (line chart, dual Y-axis revenue + transactions)

### Logic

- **Render:** `temporal-charts.tsx:23-86`. Recharts `LineChart` with `revenue` line (Azure #00A6D3) and `transactions` line (Graphite #121212) on opposite Y-axes.
- **Data source:** `getHotelGroupDetail` trends block (`hotel-groups.ts:265-284`):

```sql
SELECT
  sales_records.transaction_date AS date,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*) AS transactions
FROM sales_records
  INNER JOIN locations ...
  INNER JOIN location_hotel_group_memberships ...
  INNER JOIN hotel_groups ...
WHERE <whereClause> AND hotel_groups.id IN (:selectedGroupIds)
GROUP BY sales_records.transaction_date
ORDER BY sales_records.transaction_date ASC
```

**Filters/modes:** same as summary.

`transaction_date` is typed `date` (NOT timestamp — `schema.ts:651`). So timezone of the underlying transaction is collapsed at ETL time, not at query time.

### Issues

**P0 — Multi-group selection double-counts daily revenue.** Same membership fan-out. A daily sales row for a multi-membership location counted N times where N = number of memberships intersecting the selected group set. The chart will show systematic upward distortion any time the selected groups overlap on a hotel. File: `hotel-groups.ts:265-278`.

**P1 — Cross-region selections may bucket inconsistently because `transaction_date` is set at ETL time per region and the ETL does not apply a single canonical timezone.** Header context flags this as a concern. `transaction_date` column is `date` (no time component), so it's whatever the ETL stamped — typically the local-region date. UK 23:30 sale in summer = `2026-04-25`; same wall-clock instant in IE = `2026-04-25`; same in DE = `2026-04-25` (CET) — but a DE sale at 00:30 CET (UK 23:30) lands on `2026-04-25` in DE, while the UK sale at 23:30 lands on `2026-04-24`. Multi-region group totals may show "spikes" that are actually a one-hour-window timezone bucketing artefact. Verify ETL convention or normalise. File: `hotel-groups.ts:271`, schema `salesRecords.transactionDate`.

**P2 — No date-bucketing for long ranges.** A 2-year range produces ~730 rows and Recharts renders all of them on the X-axis; performance-wise fine, readability-wise the line gets noisy. No week/month down-sampling. File: `hotel-groups.ts:265-278`.

**P2 — Empty days are absent rather than zero.** Days with no transactions don't appear in the result set; Recharts will draw a connecting line straight from D-1 to D+1 across the gap, masking outages. File: `hotel-groups.ts:265-278`.

---

# Location Groups Dashboard — Logic & Audit

Page: `src/app/(app)/analytics/location-groups/page.tsx`
Actions: `src/app/(app)/analytics/location-groups/actions.ts`
Query layer: `src/lib/analytics/queries/location-groups.ts`

WHERE builder (`location-groups.ts:38-61`): date, scope, active-location, maturity, metricMode, dimension filters.

---

## Section: Location Groups Selector (multi-select with location count + revenue)

### Logic

- **Render:** `location-selector.tsx:22-55`. `MultiSelectFilter` labelled `"<group> · N location(s) · £X"`.
- **Data source:** `getLocationGroupsList` (`location-groups.ts:74-121`):

```sql
SELECT
  location_groups.id, location_groups.name,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*) AS transactions,
  COUNT(DISTINCT sales_records.location_id) AS hotel_count,
  SUM(DISTINCT locations.num_rooms) AS total_rooms,    -- ← BUG (see issues)
  NULL AS total_kiosks
FROM sales_records
  INNER JOIN locations ON sales_records.location_id = locations.id
  INNER JOIN location_group_memberships ON locations.id = location_group_memberships.location_id
  INNER JOIN location_groups ON location_group_memberships.location_group_id = location_groups.id
WHERE <whereClause>
GROUP BY location_groups.id, location_groups.name
ORDER BY revenue DESC
```

`revenuePerRoom`, `txnPerKiosk`, `avgBasketValue` derived in JS (`location-groups.ts:103-120`). `totalKiosks` is always null.

**Filters/modes:** all `whereClause` filters apply.

**Business meaning:** Picker for location-group drill-down. The label itself shows revenue, which is enough for the user to disambiguate.

### Issues

**P0 — `SUM(DISTINCT locations.num_rooms)` is mathematically wrong.** `SUM(DISTINCT)` deduplicates by **value**, not by row. Two hotels in the group both with 100 rooms → `SUM(DISTINCT 100) = 100`, not 200. Three hotels with 100, 200, 100 → 300, not 400. The intent was clearly "sum rooms once per location" but `SUM(DISTINCT col)` does not achieve that. Correct version: `SUM(num_rooms)` over a sub-aggregate of one row per location, or `(SELECT SUM(num_rooms) FROM locations WHERE id IN (members))`. As written, `total_rooms` is bounded by the cardinality of distinct `num_rooms` values across the group. File: `location-groups.ts:95, 146`.

**P0 — Membership double-counting.** Locations in multiple location groups contribute revenue to each. Header context calls this out specifically. File: `location-groups.ts:65-69, 80-101`.

**P1 — `total_kiosks` always NULL.** Hardcoded `NULL::text` in both the list and detail queries (`location-groups.ts:96, 147`). Downstream `txnPerKiosk` therefore always null in JS. The `Total Kiosks` and `Txn / Kiosk` cards in CapacityMetrics will display "—" forever. Either compute via `activeKioskCountFragment` (`shared.ts:207-214`) or remove the cards. File: `location-groups.ts:96-97, 147-148, 161`.

**P2 — `hotel_count` toggles under metricMode** (same defect as Hotel Groups Selector). File: `location-groups.ts:94`.

---

## Section: Group Metrics (KPI grid: Revenue, Transactions, Hotels, Total Rooms)

### Logic

- **Render:** `location-metrics.tsx:19-57`.
- **Data source:** `getLocationGroupDetail` summary (`location-groups.ts:135-150`):

```sql
SELECT
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*) AS transactions,
  COUNT(DISTINCT sales_records.location_id) AS hotel_count,
  SUM(DISTINCT locations.num_rooms) AS total_rooms,
  NULL AS total_kiosks
FROM sales_records
  INNER JOIN locations ...
  INNER JOIN location_group_memberships ...
  INNER JOIN location_groups ...
WHERE <whereClause> AND location_groups.id IN (:selectedGroupIds)
```

`previousMetrics` via shifted date range (`location-groups.ts:244-268`).

**Filters/modes:** all `whereClause` + selected groupIds.

### Issues

**P0 — `total_rooms` bug carries through, displayed directly on the KPI card.** "Total Rooms" reads e.g. 100 for a 200-room group of two same-sized hotels, then balloons to 400 when one of them gets remeasured to 99 rooms. Bizarre to debug from the UI. File: `location-groups.ts:146`, KPI display `location-metrics.tsx:50-54`.

**P0 — Multi-select revenue double-counts shared locations.** Same root cause. File: `location-groups.ts:142-150`.

**P1 — `hotel_count` shifts on metricMode toggle.** File: `location-groups.ts:145`.

---

## Section: Capacity Metrics (Rev/Room, Txn/Room, Txn/Kiosk, Avg Basket, Total Rooms, Total Kiosks)

### Logic

- **Render:** `capacity-metrics.tsx:16-52`. 6-card grid.
- **Data source:** Derived in JS from the `getLocationGroupDetail` summary (`location-groups.ts:159-162`):
  - `revenuePerRoom = totalRooms > 0 ? revenue / totalRooms : null`
  - `txnPerRoom = totalRooms > 0 ? transactions / totalRooms : null`
  - `txnPerKiosk = totalKiosks > 0 ? transactions / totalKiosks : null`
  - `avgBasketValue = transactions > 0 ? revenue / transactions : 0`
  - `totalRooms`, `totalKiosks` passed through.

**Filters/modes:** inherited from summary block.

### Issues

**P0 — All "per room" metrics multiplied by an unknown factor due to the `SUM(DISTINCT num_rooms)` bug.** `revenuePerRoom` = revenue / wrong_total_rooms. The displayed Rev/Room is **larger** than reality (denominator collapsed by DISTINCT) by the ratio `actual_rooms / distinct_room_values`. In a homogeneous group (all hotels same size), Rev/Room is multiplied by N hotels. Numbers are loud-wrong, not subtle-wrong. File: `location-groups.ts:146, 159-160`.

**P0 — Capacity-numerator vs denominator timestamp mismatch.** Numerator is "revenue over historical period". Denominator is "current `num_rooms` from `locations.num_rooms`", read at query time. A hotel that was 50 rooms in 2024 → 100 rooms today: 2024 Rev/Room understated by 2x. There is no `locations_history` / SCD-2 table; this is a structural limitation. The same defect applies everywhere `num_rooms` is divided into a period metric (Region's "Total Rooms", Hotel Groups detail's "Rev / Room", etc.). File: `location-groups.ts:159-161` and ubiquitous.

**P0 — `txnPerKiosk` always null** because `totalKiosks` is hardcoded NULL. Card displays "—" forever. File: `location-groups.ts:147, 161`.

**P1 — `kioskAssignments` is the actual source of truth for kiosk count, but with temporal validity (`assignedAt`, `unassignedAt`).** A correctly-computed `txnPerKiosk` should choose between "kiosks active as of dateTo", "average over period", or "min/max". The metric-helper file has nothing supporting this; `activeKioskCountFragment` (`shared.ts:207-214`) computes "currently-active kiosks" — the "as-of-now" snapshot, NOT "as-of-dateTo". Same kind of mismatch as `num_rooms`. File: `location-groups.ts:147`, `shared.ts:207-214`.

**P2 — `txnPerRoom` exists in CapacityMetrics card but the brief mentioned only `Rev/Room, Txn/Kiosk, Avg Basket, Total Rooms, Total Kiosks`.** Minor surface-area discrepancy worth confirming with product. File: `capacity-metrics.tsx:25-29`.

---

## Section: Peer Analysis (percentile rank vs all groups)

### Logic

- **Render:** `peer-analysis.tsx:26-65`. Cards display metric, value, percentile band (Pxx), and bar fill via `percentileColorClass`.
- **Data source:** `getLocationGroupDetail` peer block (`location-groups.ts:164-197`):

```ts
const allGroupsData = await getLocationGroupsList(filters, userCtx);
const allRevenuePerRoom = allGroupsData.map(g => g.revenuePerRoom).filter(non-null);
const allAvgBasket    = allGroupsData.map(g => g.avgBasketValue);
const allRevenues     = allGroupsData.map(g => g.revenue);
const allTransactions = allGroupsData.map(g => g.transactions);

peerAnalysis = [
  { metric: 'Revenue',          value: revenue,        percentile: calculatePercentile(...) },
  { metric: 'Transactions',     value: transactions,   percentile: calculatePercentile(...) },
  { metric: 'Avg Basket Value', value: avgBasketValue, percentile: calculatePercentile(...) },
  // 'Revenue / Room' appended only if revenuePerRoom !== null
];
```

`calculatePercentile` (`metrics.ts:106-110`): `rank = count(values <= self) / count(all) * 100`. Note `<=` includes self → for a unique max, percentile = 100, not "exclusive max".

**Peer cohort:** ALL location groups returned from `getLocationGroupsList(filters, userCtx)` — i.e. EVERY location group in the entire system that has any transactions in the period under the active filters. NOT scoped to "groups of the same `location_type`".

**Filters/modes:** filters propagate via the recursive call (date, scope, active-location, maturity, metricMode, dimension filters).

### Issues

**P0 — Peer cohort is "all location groups", not "location groups of same `location_type`".** The header context explicitly anchored on this. The current implementation compares e.g. an Airport-only Location Group against Hotel-only Location Groups and Retail Desk Groups — apples vs oranges. There is also no concept of `location_type` on Location Group; a Location Group can contain mixed types, so the question "what is THIS group's type?" doesn't have a single answer. Either (a) compute the dominant `location_type` of the group's members and restrict the peer set, or (b) drop the percentile and rename the section. File: `location-groups.ts:164-189`, `peer-analysis.tsx:26-65`.

**P0 — `Revenue` and `Transactions` percentiles inherit the membership double-count.** The whole `getLocationGroupsList` is double-counted for shared locations. Computing percentile against a contaminated cohort propagates the error. File: `location-groups.ts:165, 80-101`.

**P0 — `Revenue / Room` and `Avg Basket Value` percentiles inherit the `SUM(DISTINCT num_rooms)` bug** (because `getLocationGroupsList` populates `revenuePerRoom` from that broken sum). The percentile is computed over wrong values. File: `location-groups.ts:165-168`.

**P1 — Self-inclusion in peer set.** When ranking group X against `allGroupsData`, X itself is in the array. With small N (e.g. 3 groups), a unique-leading group's `<=` count includes itself → P67 if it's strictly the largest, P100 if all equal. For tiny peer sets this is dominant noise. The Karpathy-grade fix is to exclude self before ranking. File: `metrics.ts:106-110` + `location-groups.ts:172-189`.

**P1 — Tiny peer set produces meaningless percentiles.** With only 3 location groups system-wide (current footprint), percentile values are P33/P67/P100 — the user reading "P67" for their group has no signal. File: `metrics.ts:106-110`.

**P1 — `locationType` filter applied at sales_records via `buildDimensionFilters` (subquery to `locations.locationType`) silently excludes NULL-type locations.** A Location Group containing some NULL-type members and the user has filtered to `locationTypes=['hotel']` → only the hotel-typed members count. The group's revenue is partial; its peer-set comparison is against partial values. Inferred from header context concern; `shared.ts:97-107` does `inArray` which excludes NULLs. File: `shared.ts:97-107`.

**P2 — Recursive call to `getLocationGroupsList`** doubles the cost of detail fetch even when only one group is selected. Could be optimised by reading from the same cache or computing peer stats once per (filters, scope) tuple. File: `location-groups.ts:165`.

**P2 — Peer Analysis uses pure-period filter, no MoM/YoY.** No comparison toggle. File: `location-groups.ts:164-189`.

---

## Section: Hotels in Group (table)

### Logic

- **Render:** `hotel-breakdown.tsx:24-81`. Same shape as Hotel Groups' `hotel-list.tsx`.
- **Data source:** `getLocationGroupDetail` hotel breakdown (`location-groups.ts:200-225`).

Identical structure to the Hotel Groups version — same columns, same nullability, same `quantity = COUNT(*)` defect, same `kiosks = NULL` defect, same outlet-code-without-region issue.

### Issues

All issues from "Hotels in Group" under Hotel Groups apply verbatim. Notable additions specific to this site:

**P0 — Multi-group selection with shared locations: row appears once but with double-counted revenue** (same as Hotel Groups Hotels-in-Group P2 above). File: `location-groups.ts:215, 221-223`.

**P1 — `hotel_count` between summary and breakdown can disagree** if a location is in multiple selected groups: summary's `COUNT(DISTINCT location_id)` over the fan-out is N; breakdown's row count is also N (after GROUP BY); but if any single hotel has rows in two of the selected groups, the GROUP BY collapses it to one row, while the summary counted it once. Consistent on this single point; revenue is the inconsistent one. File: `location-groups.ts:200-225`.

---

# Cross-section issues

This is the punchline of the audit. Issues that recur across all three dashboards or sit at architectural boundaries.

### CX-1 (P0) — Membership tables permit multi-membership, queries treat membership as 1:1

Every dashboard in this audit joins `salesRecords` to a membership table without any de-duplication step. Composite PKs prevent duplicate `(location, dimension)` pairs but explicitly *allow* multiple `(location, dimension_a)` and `(location, dimension_b)` rows. Schema declares NO uniqueness on `location_id` alone. In production today this manifests in three flavours:

1. **Cross-row inflation in lists** — region card sums for a multi-region location appear in every region card; SUM-of-cards > portfolio total.
2. **Multi-select KPI inflation** — selecting two regions/groups that share a location double-counts that location's revenue and transaction count.
3. **Breakdown-table inflation** — hotel-group breakdown within a region inflates revenue across rows (each shared location contributes to multiple groups).

The Portfolio dashboard sidesteps this via `canonicalHotelGroupNameFragment` (`shared.ts:187-200`) which collapses to one hotel group per location deterministically (operating_group_id first, then `MIN(hotel_group_id)` from memberships, lex order). This collapsing logic is **not reused** in any of the three dashboards audited here. Recommended fix: introduce equivalent `canonicalRegion` and `canonicalLocationGroup` resolvers (or, structurally, add a `primary` flag to membership tables and join only on `primary=true`).

Files: `regions.ts:66-72`, `regions.ts:184-191`, `regions.ts:206-227`, `hotel-groups.ts:62-66`, `hotel-groups.ts:201-217`, `location-groups.ts:65-69`, `location-groups.ts:142-150`.

### CX-2 (P0) — Memberships are not time-bounded; mid-period reassignments silently mis-attribute

Schema (`schema.ts:526-575`) records only `createdAt`. There is no `valid_from` / `valid_to`. If a location moved from Hotel Group A to Hotel Group B mid-period, the membership table records only the current state — its revenue for the entire period attaches to whichever group's membership row exists *at query time*. A delete-and-re-add migration sequence loses the prior affiliation entirely.

There is no mitigation in any of the three dashboards. Either:
- Add SCD-2 columns to memberships and gate joins on `valid_from <= sales_records.transaction_date < COALESCE(valid_to, '9999-...')`, OR
- Document explicitly that all groupings reflect the "current" state regardless of historical transactions.

Files: `schema.ts:526-575` (root cause), and every grouping query.

### CX-3 (P0) — `SUM(DISTINCT num_rooms)` is mathematically broken

Two of the three dashboards' "Total Rooms" computations use `SUM(DISTINCT locations.num_rooms)` which deduplicates by VALUE not by location. Wrong by an arbitrary factor. The third (Region detail's location-group breakdown) uses `SUM(locations.num_rooms)` over a `salesRecords`-fanout JOIN, multiplying by transaction count.

Two distinct defects, both producing nonsense room totals, both feeding into per-room capacity metrics that are then displayed prominently. Correct pattern: aggregate `num_rooms` once per location in a CTE, then sum to the group level.

Files: `location-groups.ts:95, 146`; `regions.ts:218`.

### CX-4 (P0) — Capacity numerator/denominator temporal mismatch

`num_rooms` and `kioskAssignments` are read "as of query time", regardless of the user's date range. Period-revenue / current-rooms is structurally meaningless for any historical query. There is no `num_rooms_history` and `kioskAssignments` history is only partially usable (records assignment events but the count "as of dateTo" requires walking the assignment timeline). All Rev/Room, Txn/Room, Txn/Kiosk metrics in this audit suffer from this.

The brief made this defect explicit; confirmed in all three dashboards.

Files: `regions.ts:218`, `location-groups.ts:159-161`, `hotel-groups.ts:238, 260`, `shared.ts:207-214`.

### CX-5 (P1) — Selector counts vs. detail counts use different definitions

For Regions specifically, the selector card shows "all-time membership count" while the metrics grid shows "membership active in period". For all three, "hotel/location count" implicitly changes definition when `metricMode` is toggled (only locations with at least one fee row qualify under `metricMode='revenue'`). Users will see the same labelled metric vary in confusing ways.

Recommended: pick "active-in-period" everywhere, document, and ensure all selector and detail queries use `whereClause`.

Files: `regions.ts:107-118` (root), `hotel-groups.ts:115, 209`, `location-groups.ts:94, 145`.

### CX-6 (P1) — Booking-fee inclusion under default `metricMode='sales'` distorts dimension counts

`COUNT(*)` includes fee rows when `metricMode='sales'`. Header context highlighted that "Transactions" in Sales mode is inflated by fee rows (each booking generates BOTH a sale row and a fee row, so transactions ~doubles). All three dashboards inherit this. The selector bills "X transactions" prominently; users read it as "X bookings" — wrong by ~2x.

Recommended: either define "Transactions" to exclude fee rows always, or label clearly. Already-flagged design choice; restating the impact at this layer.

Files: every `COUNT(*)` site in this audit; `shared.ts:51-53` for the toggle.

### CX-7 (P1) — Cache wrapper bypasses caller `userCtx`, silently uses admin

`wrapAnalyticsQuery` (`cached-query.ts:73-95`) substitutes `INTERNAL_USER_CTX = { role: 'admin' }` on every cached call, ignoring the actual user. Today every internal user is admin so this is invisible; the moment a scoped-internal user exists they will see unscoped data from the shared cache. The wrapper itself flags this in the comment at lines 67-72, so it's known but uncovered.

Files: `cached-query.ts:73-95`, every `actions.ts` in this audit.

### CX-8 (P1) — Scoping is only enforced via `scopedSalesCondition`; membership joins not re-scoped

`scopedSalesCondition` (`scoped-query.ts:139-159`) restricts `sales_records.location_id` (or product_id, etc.) to the user's scope. But the breakdown queries then do `INNER JOIN location_hotel_group_memberships ON locations.id = memberships.location_id` — this exposes hotel groups via locations the user IS scoped to, but doesn't restrict the **hotel-group rows themselves**. If a user is scoped to one location but that location is in two hotel groups, both hotel groups appear in the breakdown — including the second group whose other locations the user cannot see.

For multi-location scopes this is mostly fine (the second group's revenue from out-of-scope locations is filtered by `scopedSalesCondition`). For listing/membership questions ("which hotel groups exist?") the boundary is leakier. Consider whether the breakdown of a region should hide hotel groups whose membership extends beyond the user's scope.

Files: `regions.ts:184-191`, `hotel-groups.ts:62-66`, `location-groups.ts:65-69`.

### CX-9 (P1) — Outlet code shown without region disambiguation

`schema.ts:160-162` documents `outlet_code` is unique only per `(primaryRegionId, outlet_code)` — collisions across regions are intentional. The Hotels-in-Group tables show outlet code + hotel name with no region indicator. For multi-region groups (any large hotel chain), users see "Q5" appear twice with different parent hotel names and no way to know which is which.

Recommended fix: prefix outlet code with region code (`GB-Q5`) or add a Region column to the breakdown tables.

Files: `hotel-groups.ts:233`, `location-groups.ts:213`, `hotel-list.tsx:50-54`, `hotel-breakdown.tsx:50-54`.

### CX-10 (P2) — `transactionDate` is `date`, not `timestamptz`; cross-region bucketing depends on ETL

`salesRecords.transactionDate` typed `date` (`schema.ts:651`). Day-bucketing in Daily Trends, etc. respects whatever the ETL decided. If the ETL converts UTC instants to a single timezone (e.g. always UK local), then DE midnight transactions will get bucketed into the UK previous day. If the ETL writes "local-region date", a multi-region group's daily totals can shift by a day for some transactions vs others.

The brief flagged this. Confirmed structurally — there is no SQL-level fix because the time component is gone. Audit candidate at the ETL layer rather than here.

Files: `schema.ts:651`, all "Daily Trends" sites.

### CX-11 (P3) — `quantity` column is `COUNT(*)`, not actual quantity

Both `Hotels in Group` tables expose a `quantity` column that's identical to `transactions`. Cosmetic vs `salesRecords.quantity` (which exists in the schema but is never queried in this audit). User-facing column would benefit from either being removed or computed correctly.

Files: `hotel-groups.ts:236-237`, `location-groups.ts:216-217`.

---

## Top recommendations (priority order)

1. **CX-3 / Location Groups Selector P0** — Fix `SUM(DISTINCT num_rooms)`. Easiest single-line correctness fix; eliminates wrong "Total Rooms" KPI and downstream Rev/Room.
2. **CX-1 / All P0** — Introduce canonical resolvers for region and location-group (mirror `canonicalHotelGroupNameFragment`). Eliminates membership double-counting in multi-select and cross-row totals.
3. **Region detail summary P0** — Use canonical region or de-dupe via CTE; otherwise multi-region select reports inflated KPIs.
4. **Peer Analysis P0 (×3)** — Restrict cohort to same `location_type` (or remove the section / rename to "vs all groups"). Add self-exclusion in `calculatePercentile`.
5. **CX-4** — Document the per-room/per-kiosk temporal mismatch and either fix via SCD-2 or add a "metrics use current capacity" footnote on every capacity card. Wire `activeKioskCountFragment` so `Total Kiosks` and `Txn / Kiosk` are at least non-null.
6. **CX-5 / Region Selector P1** — Make selector counts respect filters; pick a single definition for "Hotel Group Count".
7. **Hotels-in-Group P1 (×2)** — Fix `quantity` (or remove), wire `kiosks` (or remove), add region disambiguation to outlet codes.
