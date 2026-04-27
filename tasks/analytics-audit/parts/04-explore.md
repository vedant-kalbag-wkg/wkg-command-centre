# Compare Dashboard — Logic & Audit

File map:
- Page: `src/app/(app)/analytics/compare/page.tsx`
- Server action: `src/app/(app)/analytics/compare/actions.ts`
- Cards/table: `src/app/(app)/analytics/compare/comparison-cards.tsx`
- Query: `src/lib/analytics/queries/comparison.ts`
- Shared WHERE helpers: `src/lib/analytics/queries/shared.ts`

## Section: Control Panel (entity type tab + multi-select + Compare button)

### Logic
- Three entity types: `location`, `hotel_group`, `region` (page.tsx:22).
- On entity-type change, `fetchEntityOptions(entityType)` calls `getEntityOptions` which returns *all* rows from the matching table sorted by name (comparison.ts:211–237). No scoping, no search, no pagination — the entire `locations` table is loaded into the picker.
- `selectedIds` is local state. The Compare button is disabled until `selectedIds.length >= 2` (page.tsx:232). Clicking it calls `fetchComparisonData(entityType, selectedIds, parsed)` (page.tsx:82).
- Filters are read from the *global* analytics filter store (`useAnalyticsFilters`, page.tsx:25). The store's `metricMode`, `dateFrom/To`, `hotelIds`, `regionIds`, `productIds`, `hotelGroupIds`, `locationGroupIds`, `maturityBuckets`, `locationTypes` all flow through.
- `JSON.stringify(filters)` is used as a dependency proxy (page.tsx:26) — fragile but functional since `storeStateToAnalyticsFilters` produces deterministic field order.
- Switching entity types resets `selectedIds`, `results`, `hasCompared`, `error` (page.tsx:46–49).

### Issues

**P1 — Mixing-scale comparisons silently allowed.**
The picker shows only a single entity type at a time, so a user *cannot* compare a location with a hotel group in one shot. Good. **However**, within a single type users can still pick wildly different-scale entities (e.g. a 600-room hotel group vs. a single retail desk; or a 5-day-old location vs. a 5-year-old one). Cards show raw totals only — no normalisation, no per-day, no per-room, no per-kiosk. The `isBest` highlight (comparison-cards.tsx:68–84) crowns whichever has the largest absolute number. This guarantees a "winner" that is purely a function of scale/age. No warning, no caveat in the UI.
- Reproducer: pick two locations in the picker — one with 5 days of data and one with 6 months. Click Compare. The 6-month outlet wins everything. There is no "per-day" toggle.
- File: `comparison-cards.tsx:11–17` (best-value crowning), `comparison.ts:84–207` (raw SUM with no time normalisation).

**P1 — Avg Basket = revenue / transactions includes booking-fee rows in default mode.**
Default `metricMode='sales'` adds NO predicate to filter fee rows (`shared.ts:51–53`). Locations whose CSV has booking fee rows (netsuite_code 9991/9992 or `is_booking_fee=true`) get an inflated transaction count (each fee is its own row post-NetSuite ETL — see schema comment line 634–639), which *deflates* average basket. Two outlets with identical real product sales but different fee structures will compare incorrectly.
- Reproducer: location A and location B have identical `(net_amount, count of non-fee rows)`. A also has 100 booking-fee rows. Default mode shows: A.transactions = realCount + 100; A.avgBasket = (revenue + feeRevenue) / (realCount + 100). B is unaffected. The card highlights B for transactions and A for revenue. Neither is wrong arithmetically, but the user is comparing apples to oranges.
- File: `comparison.ts:101–107` (`COUNT(*)` over all rows), `shared.ts:51–53` (no implicit fee filter in `sales` mode).

**P1 — Reversal pairs are double-counted in transactions.**
Schema docstring (line 638–639) says reversal pairs share `(saleRef, refNo, transactionDate)` with opposite-signed `net_amount`. Compare uses raw `COUNT(*)` for transactions (comparison.ts:102, 142, 186). Each refund therefore adds +2 to transactions (the original + the reversal) while the net_amount sum self-zeros. A heavily-refunded outlet looks "busier" than a clean one.
- Reproducer: outlet X has 100 sales; 10 are refunded. transactions = 100 (sales) + 10 (refunds) = 110. avgBasket = 90·basket / 110 = 0.82·basket. Outlet Y with 100 clean sales shows transactions=100 and the true basket. X looks worse on basket without the user knowing why.
- File: `comparison.ts:102` (`COUNT(*)::text AS transactions`).

**P1 — Hotel-group / region comparisons fan out via membership join, multiplying counts.**
`getHotelGroupMetrics` (comparison.ts:144–148) joins `salesRecords → locations → locationHotelGroupMemberships → hotelGroups`. Because a single location can belong to multiple hotel groups (schema comment line 466–472 explicitly states this — the legacy `locations.hotel_group` text col is not authoritative), a sale at a location that's a member of 2 hotel groups will be COUNT-ed in both. Same applies to `getRegionMetrics` (comparison.ts:188–190). The schema *does* assert each location belongs to one canonical region via `primary_region_id` (line 167–169), but the query joins via `location_region_memberships` which is many-to-many. Revenue and transactions are both inflated when the membership table has overlap.
- Reproducer: location L is a member of hotel groups G1 and G2. A single sale is attributed once to G1 and once to G2 → both groups' `revenue` and `transactions` count the sale. Compare(G1, G2) shows misleadingly correlated values.
- File: `comparison.ts:144–151` (hotel groups), `comparison.ts:188–193` (regions).

**P2 — `getEntityOptions` ignores user scoping.**
`fetchEntityOptions` calls `getUserCtx()` then ignores the result (actions.ts:26 — `// auth check`). The query in `comparison.ts:211–237` simply selects `id, name` from the table with no scoping. An external (scoped) user can therefore enumerate every location/hotel group/region in the database via the picker — the comparison query itself is scoped, so they get an empty result if they pick out-of-scope IDs, but the names and IDs leak.
- File: `comparison.ts:211–237`, `actions.ts:23–28`.

**P2 — `entityIds.map(id => '${id}')` SQL string interpolation.**
`comparison.ts:70` builds `idList = sql.raw(\`(${entityIds.map(id => \`'${id}'\`).join(",")})\`)`. The IDs come from the client, untrusted. There is no escaping. If `entityIds[i]` contains a single quote, this produces malformed SQL or, worse, allows injection. The picker only ever returns server-fetched UUID strings, so practical exploitability is low — but a small refactor that exposes a free-form ID input bypasses this assumption silently. Use parameter binding (`inArray` or `ANY`) instead of `sql.raw`.
- File: `comparison.ts:70`.

**P2 — `selectedIds` order leaks into result order via `ORDER BY revenue DESC`.**
Result rows come back ordered by revenue (comparison.ts:108, 151, 194). The cards / table render in result order, NOT in the order the user picked. A user who selected `[Marriott, Hilton, Hyatt]` may see them rendered as `[Hyatt, Marriott, Hilton]`. The "best" highlight is still correct, but the visual mapping breaks expectations and breaks any user shortcuts ("the leftmost is the one I picked first").
- File: `comparison.ts:107` (`ORDER BY revenue DESC`).

**P2 — Empty-result branch hides why.**
When `results.length === 0` after a compare, the EmptyState says "Try widening the date range or selecting different entities" (page.tsx:262). But the cause is often that `metricMode='revenue'` was set globally and the selected outlets have no fee rows in the date range. There is no debug breadcrumb showing which filters are active.
- File: `page.tsx:257–265`.

**P3 — Picker has no search/virtualisation.**
`max-h-48 overflow-y-auto` on the options list (page.tsx:179) caps height at ~12rem but there's no input search and no virtualisation. With ~hundreds of locations the list works but is unergonomic. With thousands it becomes browser-heavy on each render.
- File: `page.tsx:179–225`.

**P3 — `selectedIds < 2` button copy says "Compare (1)" but is disabled.**
Minor UX: when one selected, the button reads "Compare (1)" and is disabled; the user has to infer the "min 2" rule from the label "Select entities to compare (2+)". A tooltip on disabled state would help.
- File: `page.tsx:230–241`.

## Section: Comparison Cards (Revenue, Transactions, Avg Basket)

### Logic
- For each entity, the card shows three metrics: Revenue (using `useMetricLabel()` so the label changes with `metricMode`), Transactions (raw COUNT), Avg Basket (revenue / transactions, with safe div by zero).
- `getBestValues` picks `Math.max` per metric; the winning cell renders in emerald-600 (cards.tsx:11–17, 36).
- A summary table below the cards repeats the same data row-major.
- `avgBasket = transactions > 0 ? revenue / transactions : 0` is computed server-side per entity (comparison.ts:118, 161, 204).

### Issues

**P1 — `formatNumber(transactions)` of zero looks normal but breaks "best" semantics.**
A brand-new location with `transactions=0` and `revenue=0` and `avgBasket=0` participates in the `Math.max` comparison. If every entity has `transactions=0` (e.g. user picked locations all outside the date range), `Math.max(0,0,0) = 0` and *all three cards* light up emerald as "best" (since `value > 0` guard only suppresses the highlight if the winning value is zero, but `entity.revenue === best.revenue` is still true and the className includes the win class — re-checking: comparison-cards.tsx:36 only adds the highlight when `isBest && value > 0`, so all-zero entities get NO highlight, which is correct). However, when *one* entity has zero and others are positive, the zero entity is correctly never "best". OK on reflection. Downgrading this concern.
- Mitigation note only — no change required here.

**P1 — Avg Basket "best" is misleading when scale differs by 100×.**
Highlighting Avg Basket as "best" implies a positive signal, but a small kiosk in a high-end hotel can have AVG basket > a city centre flagship simply because of product mix. Without the user setting a `productIds` filter, the avg-basket comparison conflates product-mix with location performance. Card has no caveat.
- File: `comparison-cards.tsx:79–84`.

**P2 — "Best" treated as ordinal in table, but values can tie.**
`entity.revenue === best.revenue` highlights *every* entity tied for the max (comparison-cards.tsx:71). With small samples (e.g. two outlets, both £1234.50 revenue) both cards light up and the "winner" is ambiguous. UI doesn't say "tied" — visually it looks like both won outright. Probably fine for currency given decimal precision, but `transactions` ties (integers) are common.
- File: `comparison-cards.tsx:71, 116, 132, 148`.

**P2 — `metricLabel` vs hardcoded "Avg Basket" / "Transactions".**
`useMetricLabel()` swaps "Revenue" ↔ "Sales" depending on `metricMode` (page.tsx:67–68). But "Transactions" and "Avg Basket" remain hardcoded labels (comparison-cards.tsx:74, 80). In `revenue` mode, "Transactions" is now actually counting *fee rows* (since the WHERE restricts to fee rows) and "Avg Basket" becomes "average fee per fee row" — a meaningless metric. The label still reads "Avg Basket" and "Transactions" verbatim, with no indication that the underlying definition changed.
- Reproducer: set global `metricMode='revenue'`. Pick two locations. The cards show "Revenue" (labelled correctly), but "Transactions" is now COUNT(fee rows), and "Avg Basket" is feeRevenue/feeRowCount. User reads it as basket size; it is not.
- File: `comparison-cards.tsx:74, 80`; `shared.ts:51–53`.

# Pivot Table Dashboard — Logic & Audit

File map:
- Page: `src/app/(app)/analytics/pivot-table/page.tsx`
- Server action: `src/app/(app)/analytics/pivot-table/actions.ts`
- Field list: `src/app/(app)/analytics/pivot-table/field-list.tsx`
- Drop zones / toolbar: `src/app/(app)/analytics/pivot-table/drop-zones.tsx`, `pivot-toolbar.tsx`
- Result table: `src/app/(app)/analytics/pivot-table/pivot-result-table.tsx`
- Engine: `src/lib/analytics/pivot-engine.ts`
- Query orchestrator: `src/lib/analytics/queries/pivot.ts`
- Filter store: `usePivotFilterStore` in `src/lib/stores/analytics-filter-store.ts`
- Pivot store: `src/lib/stores/pivot-store.ts`

## Section: Field List + Pivot Builder (drag source + drop zones + toolbar)

### Logic
- `AVAILABLE_FIELDS` (pivot-store.ts:12–25) declares 9 dimensions and 3 metrics. Dimensions: `product_name`, `outlet_code`, `hotel_name`, `hotel_group`, `region`, `location_group`, `sale_month`, `sale_year`, `sale_hour`. Metrics: `gross_amount` (label "Revenue"), `quantity`, `booking_fee`.
- DnD: dimensions can drop into rows or columns; metrics can drop into values. Adding a dimension to one zone removes it from the other (pivot-store.ts:64–88), so a field cannot be both row and column. No "moves to filters" zone — there's no slicer/filter zone in the builder.
- Toolbar: `Run Analysis` button; `Clear All`; `MoM` and `YoY` toggles (mutually exclusive, click again to deselect).
- Default aggregation when adding a value: `'sum'` (page.tsx:78).
- "Run Analysis" disabled when `values.length === 0` (toolbar:17).

### Issues

**P0 — Pivot SQL references columns that no longer exist on `locations` and `sales_records`.**
The NetSuite ETL migration (schema comment line 634–639 and migration `0022_restructure_salesrecords_region_scoped.sql`) **dropped** `locations.region`, `sales_records.gross_amount`, `sales_records.quantity`, `sales_records.booking_fee`, `sales_records.sale_commission`, `sales_records.discount_amount`. But `pivot-engine.ts:38–50` (`ALLOWED_COLUMNS`) and the field list (`pivot-store.ts:12–25`) still expose all of them.
- Result: every pivot run that includes any of those metrics or selects "Region" as a dimension will fail at the database with Postgres error 42703 ("column does not exist"). Since the values zone *requires* at least one metric (toolbar:17), and all three exposed metrics are dropped columns, **the pivot table is broken end-to-end in production**.
- The unit tests (`pivot-engine.test.ts`) still reference `gross_amount` (lines 22, 48, 70, 79, 97, 106, 124, 126, 139) and pass because they only assert string composition, never executing SQL.
- Reproducer: drop "Hotel" into Rows, drop "Revenue" (gross_amount) into Values, click Run Analysis. Server returns 500. Same for any metric.
- Files: `pivot-engine.ts:45–50` (six broken column refs), `pivot-store.ts:17` (`region` dimension), `pivot-store.ts:22–24` (three broken metrics), `pivot-engine.test.ts` (tests still pass against stale schema).
- Fix direction: replace `gross_amount` → `net_amount`; remove `quantity` (no replacement — it doesn't exist in NetSuite ETL output); replace `booking_fee` with conditional `CASE WHEN is_booking_fee THEN net_amount ELSE 0 END`; drop `sale_commission`, `discount_amount`; replace `region` dimension with a join to `regions.name` via `primary_region_id` or `location_region_memberships`.

**P0 — `hotel_group` and `location_group` map to deprecated free-text columns.**
`pivot-engine.ts:43–44`:
```
["hotel_group", "locations.hotel_group"],
["location_group", "locations.location_group"],
```
Schema comment (line 466–472) explicitly says these free-text columns are **not authoritative**. The canonical mapping is via `location_hotel_group_memberships → hotel_groups.name` and `location_group_memberships → location_groups.name`. Many production locations have NULL or stale free-text values (the comment in 0022 implies these are kept only for ETL backfill). Pivoting by `hotel_group` will silently group on the wrong/stale value, producing rows that don't match the rest of the analytics surface (Compare, Heat Map, etc, all use the membership tables).
- Reproducer: pivot Hotel × Hotel Group with Revenue. The "Hotel Group" column will reflect `locations.hotel_group` (free text, stale) — different from what Compare(hotel_group=...) shows, which uses memberships. User sees "missing" hotels in pivot that the Compare dashboard happily aggregates.
- File: `pivot-engine.ts:42–44`.

**P1 — `outlet_code` is no longer globally unique.**
Migration 0022 dropped the global unique on `locations.outlet_code` (schema comment lines 160–162) — uniqueness is now `(primary_region_id, outlet_code)`. Pivot grouping by outlet_code (pivot-engine.ts:41) will collide outlets with the same code from different regions (e.g. "Q5" in GB and "Q5" in DE), summing their sales into one row labelled "Q5". Because `region` is broken (P0 above), the user has no way to disambiguate.
- File: `pivot-engine.ts:41`, `pivot-store.ts:14`.

**P1 — COUNT default returns "row count" not "distinct anything".**
When users drop a metric into Values they get aggregation="sum" by default. Switching to "count" produces `COUNT(expr)` (pivot-engine.ts:200) — counting *non-null values of the metric column*, NOT distinct dimensions. There's no `count_distinct` option. So:
- A user pivoting Hotel × Product with `count` of `gross_amount` (once that's fixed) gets the row count per cell. This includes booking fee rows, reversals, and comm rows (well, post-ETL: just fees + reversals). It does NOT count distinct sale_refs / distinct products / distinct customers.
- The label generator (pivot-engine.ts:427–429) emits "Count of Revenue" — meaningless to a user who wanted "how many transactions".
- File: `pivot-engine.ts:81–87` (no `count_distinct`), `drop-zones.tsx:101–107` (UI exposes only sum/avg/count/min/max).

**P1 — Grand totals for AVG aggregation are NOT a weighted average (Simpson's paradox bait).**
`formatPivotResults` (pivot-engine.ts:387–388):
```
} else if (v.aggregation === "avg") {
  total = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}
```
This computes the unweighted mean of the per-bucket averages. For a pivot of `Hotel × Month` with `AVG(net_amount)`, the grand total is the average of monthly-per-hotel averages — NOT the overall avg net_amount across all rows. A small hotel with one big transaction in January has the same weight as a big hotel with 10000 small transactions in July.
- Reproducer: two hotels. Hotel A: 1 transaction at £1000. Hotel B: 1000 transactions at £10. True grand-mean = (1·1000 + 1000·10) / 1001 ≈ £11. Pivot grand total = (1000 + 10) / 2 = £505. Off by 50× and the user has no way to know.
- Equivalent issue exists for MIN/MAX grand totals (lines 389–393): `Math.min/max` of per-bucket aggregates is NOT the true population min/max when buckets overlap or filter differently — though for MIN/MAX of buckets it happens to coincide *if* every row contributes to exactly one bucket. With column pivoting where some cells are empty, MIN/MAX is taken over all non-empty cells only, which is incidentally OK.
- File: `pivot-engine.ts:380–397`.

**P1 — Comparison columns labels do NOT clearly distinguish "current" from "previous" period values.**
With `periodComparison` on, `addPeriodComparison` (`pivot.ts:159–302`) appends `_change` columns (a percentage delta). Headers append " (% Change)" suffix (pivot.ts:259–261). However:
- Only the *delta* is shown, not the comparison-period absolute value. Users cannot see "previous period was £X, current is £Y, delta is +Z%". The percentage is presented in isolation.
- The header-matching for `_change` columns uses positional fallback (`pivot.ts:218–220, 273–274`): `prevCells[cellKey] ?? prevKeys[i]`. With column pivoting (e.g. Hotel × Month), the cell keys include the column dim values ("Jan 2026 | sum_net_amount"). When previous-period data has a different set of months (which it always does, by definition of a shifted period), the keys differ and positional matching is the only match. Positional matching here means "the i-th column in current matches the i-th in previous" — which is a category error if month columns don't align.
- Reproducer: rows = Hotel; columns = sale_month; values = sum_net_amount; periodComparison='yoy'. Current period Jan–Dec 2026 has 12 month columns. Previous period Jan–Dec 2025 also has 12 columns. Positional match works **only if** every hotel had data in every month in both periods, in the same order. New hotels (live since Mar 2025) have prev Jan/Feb columns missing → positional shift → "+15% delta" actually compares Jan 2026 to Mar 2025.
- File: `pivot.ts:213–256` (positional fallback), `pivot-result-table.tsx:78–98` (renders only cell.formatted with no prev-period value visible).

**P1 — Pivot uses its own filter store, separate from the global analytics filter bar.**
The page reads `usePivotFilters()` (page.tsx:46), which is `usePivotFilterStore` (analytics-filter-store.ts:163, 256–260) — a *different* zustand instance from `useAnalyticsFilterStore` (line 162). They share the same shape and defaults but **state never syncs**.
- Reproducer: on the Portfolio dashboard set date range to 1 Jan – 31 Mar 2026 and `metricMode=revenue`. Navigate to the pivot table. Pivot's date range is still the default (whatever defaults to) and its metricMode is `'sales'`. There's no filter bar visible on the pivot page (page.tsx renders no FilterBar), so the user has no way to discover or change pivot's filters from the UI. The pivot is being run against the default filters, silently.
- File: `analytics-filter-store.ts:162–163` (two separate stores), `pivot-table/page.tsx` (no FilterBar mounted).

**P1 — Pivot WHERE clause built by string interpolation (pivot.ts:97–106).**
`buildPivotWhereString` extracts Drizzle's parameter placeholders (`$1`, `$2`, …) and replaces them with raw string-escaped values (`pivot.ts:96–106`). Single-quote escaping is done as `param.replace(/'/g, "''")` (line 103). Other special characters (backslash, null bytes, U+2018 right single quote) are not normalised. Any predicate with non-trivial string content (e.g. dimension filter values, future predicates with `LIKE`/regex patterns) is at risk of malformed SQL. Currently inputs are all server-fetched UUIDs and dates, so practical exploitability is low. But the function is a generic SQL-string builder and will break the next time someone adds a string-typed dimension filter.
- Reproducer (theoretical): if a `productIds` filter ever accepted a non-UUID string and that string contained `\\`, the escape step would not handle it. With `standard_conforming_strings=on` (Postgres default since 9.1), `\` is literal — so that's safe today. If `standard_conforming_strings=off` (legacy), `\\` would be parsed as `\`. Fragile.
- Fix direction: build the pivot SQL via Drizzle's parameter binding (or via `pg`'s parameterised query) instead of string-baking. The current shim exists because pivot-engine works in raw strings to splice column expressions; but the WHERE clause has no column-name needs and could remain Drizzle-native if pivot-engine accepted a SQL fragment.
- File: `pivot.ts:43–109`.

**P2 — Empty cells render as "—" but grand totals use base-key lookup that drops column-pivoted cells.**
`pivot-result-table.tsx:103–122` renders the totals row by looking up `data.grandTotals[cellKey]` where `cellKey` is keyed by the column-pivoted key (e.g. "Jan 2026 | sum_net_amount"). But the grand totals are computed in `pivot-engine.ts:379–397` keyed only by `${aggregation}_${field}` (e.g. "sum_net_amount") — NOT by per-column. So the grand-totals row will show "—" for every column in a column-pivoted result. Quick check: `data.grandTotals` only has keys equal to `alias`, never per column. The result table's `cellKeys` (line 30) come from `firstRow.cells` which DOES have per-column keys. So `data.grandTotals[key]` returns `undefined` for every cell key in column-pivot mode, falling back to `"—"` (line 118). User sees no totals on cross-tabs.
- Reproducer: Rows=Hotel, Columns=Month, Values=SUM(net_amount). Total row at the bottom shows "—" in every cell. Without column pivoting (no Columns dim) the totals appear correctly.
- File: `pivot-engine.ts:380–398` (totals only keyed by alias), `pivot-result-table.tsx:110–121` (lookup by per-column cellKey).

**P2 — Truncation banner shows raw `rowCount`, but `rowCount` is post-truncation (capped at 10k).**
Pivot engine slices to `MAX_ROWS = 10_000` (pivot-engine.ts:341–342) and reports `rowCount: rows.length`. The `truncated` flag flips when `rawRows.length > MAX_ROWS`. So when truncation happens, `rowCount` reads exactly 10000. The banner says "Results truncated to 10,000 rows" (pivot-result-table.tsx:35–38) — accurate, but it never shows the *actual* total. User has no signal of "you're missing 50% of data".
- File: `pivot-engine.ts:341–344`, `pivot-result-table.tsx:34–39`.

**P2 — Comparison columns are rendered inline with current-period columns.**
The result table renders `cellKeys` in `Object.keys(firstRow.cells)` order (pivot-result-table.tsx:30, 78). With comparison on, current-period cells are inserted first (the `_change` cells are added via `{ ...row.cells, ...changeCells }` — line 254 of pivot.ts). Visually this places current and `_change` *interleaved* per metric, e.g. `[sum_net_amount, sum_net_amount_change, sum_quantity, sum_quantity_change]`. Easy to confuse for "current Jan + previous Jan + current Feb + previous Feb" when scanning.
- File: `pivot.ts:252–256`, `pivot-result-table.tsx:30, 78`.

**P3 — Toolbar "Clear All" button silently clears period comparison too.**
`clearAll` resets `periodComparison: null` (pivot-store.ts:114–120). Users who configured MoM/YoY then drag-rearranged fields and clicked Clear All to reset the layout will have their comparison toggle silently reset. Minor.

**P3 — Drag preview only shows label; no preview of where it would drop.**
The DragOverlay (page.tsx:175–187) only shows a chip clone. The drop zones do change border color when hovered (drop-zones.tsx:31–35), so this is mild.

## Section: Pivot Result Table

### Logic
- Renders `data.headers` on top, `data.rows[i].dimensions` (left) + `data.rows[i].cells` (right) per row.
- A "Totals" row sticks to the bottom (`sticky bottom-0`).
- `rowCount` printed below table; truncation warning above.
- `_change` columns render with `text-green-700` / `text-red-700` based on sign (lines 80–87).

### Issues
- See P2 (totals empty on cross-tabs) and P1 (comparison columns positional matching) above — both render here.
- **P3 — Header alignment between `dimensionKeys` and `cellKeys` uses positional fallback that double-iterates `Object.keys`.**
  Lines 47–63 of pivot-result-table.tsx try to map header strings to dimension keys via `dimensionKeys.indexOf(key)` and `cellKeys.indexOf(key)`. With column pivoting and comparison both on, header count mismatches `cellKeys.length` (because `_change` cells exist but `headers` was built from a smaller pre-comparison set). The fallback `data.headers.find((h) => h === key)` matches verbatim cell keys against headers — which doesn't correspond. A header like "Jan 2026" won't match cellKey "Jan 2026 | sum_net_amount". Result: most headers fall through to `?? key`, which renders the verbose cell key as the column label. Looks ugly and is hard to read.
  - File: `pivot-result-table.tsx:43–64`.

# Trend Builder Dashboard — Logic & Audit

File map:
- Page: `src/app/(app)/analytics/trend-builder/page.tsx`
- Server actions: `src/app/(app)/analytics/trend-builder/actions.ts`
- Series builder: `src/app/(app)/analytics/trend-builder/series-builder-panel.tsx`, `series-row.tsx`
- Trend chart: `src/app/(app)/analytics/trend-builder/trend-chart.tsx`
- Weather mini chart: `src/app/(app)/analytics/trend-builder/weather-mini-chart.tsx`
- Event annotations: `src/app/(app)/analytics/trend-builder/event-annotations.tsx`
- Granularity: `src/app/(app)/analytics/trend-builder/granularity-selector.tsx`
- Store: `src/lib/stores/trend-store.ts`
- Query: `src/lib/analytics/queries/trend-series.ts`
- Helpers: `src/lib/analytics/formatters.ts` (granularity), `src/lib/analytics/rolling-average.ts`, `src/lib/analytics/metrics.ts` (`getComparisonDates`)

## Section: Granularity Selector + Toggles (auto/daily/weekly/monthly + weather/events/yoy/rolling avg)

### Logic
- `autoGranularity(from, to)` (formatters.ts:105–112): `<= 31 days → daily`, `<= 90 → weekly`, otherwise monthly.
- Granularity is applied client-side in `TrendChart.mergeSeriesData` — the SQL query always returns daily rows (`trend-series.ts:124–132`).
- Bucketing: `dateToBucket` returns either the date itself, the ISO Monday of the week (`getISOWeekMonday`, formatters.ts:114–121), or the first-of-month string (`getMonthBucket`, formatters.ts:123–125).
- Toggles wire into `useTrendStore`: `showWeather`, `showEvents`, `showYoY`, `rollingAverage` (null | 7 | 30).
- Weather is gated on `weatherAllowed` (page.tsx:89–104): exactly one location group present in *either* per-series union OR (fallback) global filter store. If user toggles weather off-then-on while not allowed, the toggle is `disabled=true` (page.tsx:274). A `useEffect` (page.tsx:107–111) force-clears `showWeather` when not allowed.
- YoY: when `showYoY=true`, `fetchTrendSeriesDataYoY` runs in parallel; previous-year dates are fetched then mapped forward by +1 year client-side (actions.ts:102–110).

### Issues

**P1 — `autoGranularity` thresholds are hardcoded 31 / 90 days; range of exactly 31 days = daily (31 points), 32 days = weekly (5 points). Cliff edge.**
Crossing the 31-day boundary causes a sudden drop from 31 daily points to ~5 weekly points. Same at 90 days. Users moving the date picker by 1 day see the chart shape change qualitatively. There's no "smoothing transition" or tooltip explaining the switch.
- File: `formatters.ts:105–112`.

**P1 — `getISOWeekMonday` uses UTC math but `dateStr` is a local-time `YYYY-MM-DD` from the SQL `transactionDate::text` cast.**
`trend-series.ts:126` does `${salesRecords.transactionDate}::text AS date` — Postgres `date::text` is timezone-naive and yields `'YYYY-MM-DD'`. `getISOWeekMonday` (formatters.ts:114–121) parses it as `new Date(dateStr + "T00:00:00Z")` — UTC. UK is UTC+0 in winter and UTC+1 in summer (BST). So during BST, a sale recorded as `2026-04-25` (UK local Saturday) gets bucketed using UTC Saturday → Monday of week containing 2026-04-25 in UTC. For dates near month boundaries crossing midnight, this can shift bucket assignment by a day. Cross-region (DE = CET/CEST, IE = same as UK, AU = UTC+8/+10/+11) the bucketing is uniformly "Monday of UTC week" — Monday-Sunday in UTC, which for AU users straddles their local Sunday-Saturday. Users in different regions see the same data bucketed inconsistently with their local calendar.
- File: `formatters.ts:114–121`.

**P1 — `getMonthBucket` slices first 7 chars of date string (`dateStr.slice(0,7) + "-01"`) — partial first/last months are silently grouped under the same month label as the full month.**
If user picks 15 Jan – 14 Mar, the chart renders 3 dots: "Jan 2026" (with only 17 days of data), "Feb 2026" (full), "Mar 2026" (with only 14 days). All three look like full-month aggregates visually. Compared against the previous full month, the partial Jan and Mar are systematically lower (less data) — *not* because business is bad, but because the bucket is partial. Tooltips show no warning.
- File: `formatters.ts:123–125`, `trend-chart.tsx:154–164` (tick formatter doesn't disambiguate).

**P1 — YoY shifts every date by exactly 365 days via `setFullYear(getFullYear() - 1)`; aliases Feb 29 in non-leap years and shifts weekday alignment.**
In `actions.ts:106–109`, the dates are shifted by `setFullYear(d.getFullYear() + 1)` after fetching prev-year data. Issues:
- Non-leap year alignment: 2024-02-29 → 2025-02-28 (JavaScript clamps). The YoY value for Feb 28 2025 is the value from Feb 29 2024. Feb 28 2024 → Feb 28 2025; Feb 29 2024 → Feb 28 2025 (collision; JS Date setFullYear actually rolls over to Mar 1 2025 for Feb 29 → 2025-03-01, depending on engine — actually `new Date('2024-02-29').setFullYear(2025)` returns `2025-03-01`). So leap-day data ends up on a March 1 dot, separated from Feb 28. Subtle off-by-one for leap years.
- Weekday alignment: 2025-03-15 (Saturday) compared with 2024-03-15 (Friday). For weekly bucketing this means YoY weekly bars compare Mon-Sun-of-2025-week-X to Mon-Sun-of-2024-week-(X-1). YoY-vs-DoW alignment is silently off by 1 day.
- For "weekly" granularity specifically, YoY series points after re-bucketing land on the Monday of the *current* week, but were aggregated at the *previous-year's* daily granularity then bucketed in the chart layer. There's no guarantee the bucket centroids align.
- `getComparisonDates` in `metrics.ts:30–46` likewise calls `setFullYear(year - 1)` — same issue.
- File: `actions.ts:102–110`, `metrics.ts:30–46`.

**P1 — Rolling average 7 / 30 day on weekly or monthly data is meaningless but the UI does not prevent it.**
`applyRollingAverage` (rolling-average.ts:5–20) takes `windowSize` as a number of *array indices* — NOT calendar days. After `mergeSeriesData` buckets to weekly, indices are weeks. A "7-day rolling avg" becomes a "7-week rolling avg" (49 days). A "30-day rolling avg" on monthly data becomes a "30-month rolling avg" (2.5 years). The UI labels are "7d Avg" / "30d Avg" (page.tsx:241) — strictly wrong unless granularity = daily.
- Critically, **the rolling avg is applied AFTER bucketing in client code**, but the labels never adapt. Worse: `applyRollingAverage` is called on `seriesData` (the pre-bucketing daily data) inside the `chartData` useMemo (page.tsx:219–226), THEN `mergeSeriesData` buckets it inside `TrendChart`. So the rolling avg is over daily values, then bucketed — that's actually correct *if* the bucketing aggregator were a sum. But `mergeSeriesData` sums (line 58–59 of trend-chart.tsx), so summing 7-day averages over 7 days reproduces the daily sum (more or less) — which means the 7-day rolling avg is essentially invisible at weekly granularity.
- Net effect: turning on rolling avg has different visual meanings depending on granularity. UI does not gate (e.g. disabled at weekly/monthly).
- File: `page.tsx:219–226`, `trend-chart.tsx:41–72`, `rolling-average.ts:5–20`.

**P2 — `auto` granularity recomputes on every render via `new Date(dateFrom)` / `new Date(dateTo)`.**
Not memoized. Cheap, so just noted.
- File: `trend-chart.tsx:110–113`.

## Section: Series Builder Panel (per-series metric/filters/color/label/hide)

### Logic
- Up to 6 series (series-builder-panel.tsx:11). `pendingSeries` is the in-edit list; `appliedSeries` is what the chart renders. `Apply` button copies pending → applied (trend-store.ts:211–214).
- Each series has: id, metric (revenue|transactions|avg_basket_value|booking_fee), filters (productIds, locationIds, hotelGroupIds, regionIds, locationGroupIds), color (one of 8 brand colors cycled), label (auto-generated, optionally user-edited), hidden flag.
- Per-series filters override the absence of global filters — the trend page does NOT read the global filter store for *dimensional* filters (page.tsx:42–43 reads `globalLocationGroupFilter` for weather gating only). The query (`getTrendSeriesData`, trend-series.ts:96–138) only applies `seriesConditions` from the per-series filters, plus auth/active/date — NOT the global filter bar's `hotelIds/regionIds/productIds`.

### Issues

**P0 — Trend Builder ignores the global analytics filter bar entirely.**
The page reads `useAnalyticsFilterStore((s) => s.dateRange)` (page.tsx:41) and `(s) => s.locationGroupFilter` (page.tsx:42) — ONLY date range and location group (latter only used to gate the weather toggle). The trend query (trend-series.ts:96–138) takes `dateFrom`, `dateTo`, and `SeriesFilters` *only*; it never receives the global `hotelIds`, `regionIds`, `productIds`, `hotelGroupIds`, `metricMode`, `locationTypes`, or `maturityBuckets`.
- Concrete: a user navigates to Portfolio, sets `metricMode=revenue` + `regionIds=[GB,IE]`, then clicks Trend Builder in the nav. Their existing trend series has `filters: {}` (default = all). The chart renders ALL regions, ALL outlets, ALL products, INCLUDING fees — because the query doesn't gate on metricMode or regionFilter. The user has no signal that the global filter bar is being ignored.
- Worse: the trend-builder page does NOT mount the FilterBar at all (page.tsx renders no filter UI), unlike Portfolio. So the user can't even *see* what the global filters are while on this page. They have to per-series specify everything.
- File: `trend-builder/page.tsx:39–46` (only reads dateRange + locationGroupFilter), `trend-series.ts:96–138` (no metricMode, no global filter wiring).

**P1 — `metric=booking_fee` sums only `is_booking_fee=true` rows; ignores netsuite_code 9992 ("Cash Handling Fee").**
`metricExpression('booking_fee')` (trend-series.ts:85–91): `SUM(CASE WHEN ${salesRecords.isBookingFee} THEN ${salesRecords.netAmount} ELSE 0 END)`. The `is_booking_fee=true` flag is set only for netsuite_code 9991 — the comment in `shared.ts:40–46` is explicit: "9991=Booking Fee sets is_booking_fee=true; 9992=Cash Handling Fee does NOT (the flag is named after its original single purpose)". So `booking_fee` series in Trend Builder undercounts WKG fee revenue by the entire 9992 stream.
- Compare this to the rest of the analytics surface, which uses `buildIsFeeCondition()` (`shared.ts:45–47`) — `is_booking_fee = true OR netsuite_code IN ('9991','9992')`. Trend Builder's metric is inconsistent.
- Reproducer: on a region where 9992 cash-handling fees run ~10–30% of total fees (typical), the booking_fee series understates by that fraction. Compared against the Portfolio page in `metricMode=revenue` (which DOES include 9992), the totals diverge.
- File: `trend-series.ts:85–91`.

**P1 — Series filters and `locationIds` filter via `salesRecords.locationId IN (…)` without joining `locations`, but rely on `buildActiveLocationCondition` for active-location semantics.**
`trend-series.ts:42–43`: `inArray(salesRecords.locationId, filters.locationIds)`. The active-location predicate (line 108) is intersected. But IDs in `filters.locationIds` could include now-archived locations — the `IN` clause matches them by FK regardless. The *combined* WHERE is `(active-locations) AND (locationId IN selected)` — which means archived selected locations get filtered OUT silently. User selects 5 outlets, two are archived, only 3 worth of data shows — no UI signal.
- File: `trend-series.ts:42–43, 106–119`.

**P1 — Per-series `regionIds` filter uses `location_region_memberships` (many-to-many fanout), inflating counts.**
`trend-series.ts:54–62`: subquery over `location_region_memberships`. Same fanout issue as Compare's hotel-group / region queries (P1 above): a location attached to multiple regions via memberships will have its sales counted once per region in the subquery match. The subquery is `IN (SELECT locationId FROM memberships WHERE regionId IN (...))` — the IN dedupes, so technically a single sale is matched once. ✓ Actually safe here because it's `IN` (not `JOIN`). Downgrading concern.
- The schema does say each location has a *single* `primary_region_id` (line 167–169), so even if memberships had multi-region locations, joining via `primary_region_id` would be more semantically correct than via memberships. The query uses memberships — slight semantic drift from the canonical region but not a correctness bug at row-count level.
- File: `trend-series.ts:54–62`.

**P2 — Booking-fee series has no maturity / location-type gating.**
`buildSeriesDimensionFilters` (trend-series.ts:36–73) covers product, location, hotel-group, region, location-group. It does NOT cover `maturityBuckets` or `locationTypes`. So even if the user could pass these via `SeriesFilters`, they wouldn't be honored. (`SeriesFilters` type doesn't have those fields anyway — see `series-row.tsx:13–19`.) Inconsistent with the rest of analytics where these filters apply.
- File: `trend-series.ts:36–73`, `types.ts SeriesFilters`.

**P2 — Series colors cycle every 8 (`CHART_COLORS`); with 6 max, OK in practice — but a user could re-pick the same brand color on two series via no UI mechanism (color is auto-assigned, no picker exposed).**
Minor. Series-row.tsx renders the color swatch but no edit affordance for color (line 79–83).
- File: `trend-store.ts:172–185`, `series-row.tsx:79–83`.

**P2 — `pendingSeries` vs `appliedSeries` divergence has no "dirty" indicator.**
A user edits a series, doesn't click Apply, navigates away. On return the chart still shows old data. No indicator that pending != applied. The button just says "Apply" with no badge.
- File: `series-builder-panel.tsx:118–125`.

**P3 — Auto-generated label uses raw IDs not names.**
`generateSeriesLabel` (trend-store.ts:41–55) joins `[...productIds, ...locationIds, ...hotelGroupIds, ...regionIds, ...locationGroupIds]` directly. These are UUIDs. So a default label looks like `Revenue | 5f3a..., 8c1b..., ab02...`. The UI auto-applies this on every metric/filter change unless user has manually edited. Effectively useless as a label.
- File: `trend-store.ts:41–55`.

## Section: Main Trend Chart (multi-line, dual-axis, weather band, event annotations)

### Logic
- Recharts `LineChart`. Currency metrics (`revenue`, `avg_basket_value`, `booking_fee`) → left Y-axis ("currency"); count metrics (`transactions`) → right Y-axis ("count"). Single-axis if all series on the same side (trend-chart.tsx:140–184).
- Series merged + bucketed by date in `mergeSeriesData` (trend-chart.tsx:41–72). Sum across same-bucket points within a series.
- YoY data merged with `_yoy` suffix (trend-chart.tsx:117–134).
- Tooltip / Legend strip the `_yoy` suffix and look up the parent series for label (trend-chart.tsx:186–224).
- `EventAnnotations` (event-annotations.tsx) renders `ReferenceLine` for point events (no `endDate`) and `ReferenceArea` for range events. Filtered by `activeCategories` only.

### Issues

**P0 — Avg Basket bucketing computes the SUM of daily averages, not the weighted average.**
`mergeSeriesData` (trend-chart.tsx:55–61): when bucketing weekly/monthly, it does `row[series.id] = existing + pt.value`. For metric=`avg_basket_value`, `pt.value` is the daily average from the SQL query (`SUM(net_amount) / NULLIF(COUNT(*), 0)` — trend-series.ts:84). Summing 7 daily averages does NOT equal the weekly average.
- The code comments acknowledge this: "weekly/monthly bucketing sums them — which is an approximation. A full weighted-average implementation would require returning both numerator and denominator from the query. This is acceptable for the initial port." (trend-chart.tsx:63–67).
- Net effect: a weekly avg-basket trend can be **7×** higher than the true weekly avg basket. Monthly is ~30× off. A revenue line and an avg-basket line at weekly granularity are not comparable to each other or to other dashboards' avg-basket numbers. The chart Y-axis renders these inflated values as currency without any caveat.
- Reproducer: a series with `metric=avg_basket_value`. Set granularity=monthly. The chart displays values 30× bigger than the same metric on Portfolio's KPI tile.
- File: `trend-chart.tsx:55–67`, `trend-series.ts:84`.
- Fix direction: change the SQL to return `(numerator, denominator)` per day, sum both during bucketing, then divide at render time.

**P1 — Currency vs count classification forces `avg_basket_value` to currency Y-axis but it's averaged differently than revenue / booking_fee.**
With one revenue series + one avg-basket series, both share the left "currency" Y-axis. The Y-axis scale is set by the larger absolute (revenue is in £100k–£1M range; avg basket is £20–£200), so avg basket appears as a flat near-zero line. Users get no signal to flip to dual-axis or normalize. Worse, with the P0 bucketing bug above, avg-basket can be inflated to revenue scale and then they overlap visually but encode different things.
- File: `trend-chart.tsx:31–35` (CURRENCY_METRICS classification), no axis-scaling logic.

**P1 — `connectNulls` on line series invents data across gaps.**
`connectNulls` is `true` (trend-chart.tsx:245, 263). For a new outlet that came online mid-period, the chart draws a straight line connecting "no data before live date" → "first sale". Visually this looks like a smooth ramp-up, but it's actually `0 → first-day-revenue` interpolation. Same for outlets that go offline mid-period.
- File: `trend-chart.tsx:245, 263`.

**P1 — Event annotations are filtered by category only, NOT by series scope.**
`event-annotations.tsx:20–22`: `events.filter(e => activeCategories.includes(e.categoryName))`. Events have `scopeType` (global / hotel / region / hotel_group / location_group) and `scopeValue` (`trend-series.ts:155–187`). The chart shows ALL events that match the category, regardless of whether the event scope intersects the active series.
- Reproducer: a series filtered to `hotelGroupIds=[Marriott]`. An event scoped to `hotel_group=Hilton` shows up on the chart as a dashed line / shaded region anyway. User reads it as "this Hilton event affected my Marriott series" — false.
- File: `event-annotations.tsx:16–22`, `trend-series.ts:155–187` (scope is fetched but never matched).

**P1 — `ReferenceLine x={event.startDate}` and `ReferenceArea x1/x2={...startDate/endDate}` use raw ISO date strings, but the chart's X-axis dataKey is the *bucketed* date string.**
At daily granularity: event.startDate `2026-04-15` matches a chart row with `date='2026-04-15'`. ✓
At weekly granularity: chart rows are dated to ISO Mondays only, e.g. `2026-04-13`. An event on `2026-04-15` (Wednesday) doesn't fall on a Monday — Recharts renders the ReferenceLine at an x-value that doesn't exist on the X-axis. Recharts handles this via `type='number'` axis math, but our X-axis is `dataKey='date'` (categorical/string). The line ends up positioned at a fractional location between Monday-13 and Monday-20, which Recharts may approximate or drop entirely, depending on `allowDataOverflow` defaults.
- Same issue at monthly granularity: an event on Apr 15 doesn't fall on Apr 1 (the bucket label).
- File: `event-annotations.tsx:30–67`, `trend-chart.tsx:151–164` (categorical X-axis).

**P1 — Range events with `endDate` but no `startDate` matching a bucket → `ReferenceArea` may render as zero-width or omit silently.**
A `ReferenceArea x1='2026-04-15' x2='2026-04-20'` over a *weekly* axis with bucket Mondays `[2026-04-13, 2026-04-20]` covers the week of 2026-04-13 mostly. Recharts will draw an area between the X positions of those two dates — but neither date is on the categorical axis exactly. Unpredictable.
- File: `event-annotations.tsx:27–47`.

**P2 — Chart's `mergeSeriesData` uses `localeCompare` to sort dates as strings (line 69–71).**
ISO `YYYY-MM-DD` sorts lexicographically = chronologically, so this is OK in practice. Brittle if any series uses a different format.

**P2 — Y-axis right (`count`) has no `domain` or `allowDecimals=false` constraint.**
Transaction counts are integers. Recharts may render decimal ticks on the count axis (`12.5 transactions`). Minor.
- File: `trend-chart.tsx:177–184`.

**P2 — `appliedSeries.find(s => s.id === baseId)` fallback in tooltip / legend formatters returns undefined for stale `_yoy` keys after a series is removed.**
Edge case: rapid edits during `loadData` can leave `_yoy` keys for a series ID that has been removed from `appliedSeries`. Tooltip displays the raw ID.
- File: `trend-chart.tsx:191–224`.

**P3 — Legend onClick toggles via `onToggleHidden` only for non-`_yoy` data keys, but YoY lines have `legendType='none'` (line 264) — so they don't appear in the legend anyway. The guard at line 211 is dead code.**
- File: `trend-chart.tsx:206–214, 261–264`.

## Section: Weather Mini Chart (optional, requires exactly 1 location group)

### Logic
- Renders below main chart when `showWeather=true` and gating allows.
- `fetchWeatherForLocationGroup(groupId, dateFrom, dateTo)` (actions.ts:50–79): joins `location_group_memberships → locations`, picks the *first* location with non-null `latitude/longitude`, calls Open-Meteo.
- `WeatherMiniChart` (weather-mini-chart.tsx) is a `ComposedChart` with bars (precip) on right axis and dual lines (high/low temp) on left axis.

### Issues

**P1 — Picks "the first location with coordinates" — non-deterministic, no `ORDER BY`.**
`actions.ts:59–73`: the query has no `orderBy`. Postgres may return any row; in practice this is whatever index the planner picks. So a location group spanning multiple cities (e.g. "London Hotels" with 5 hotels across the city) gets weather for *some* hotel — possibly different hotel each time the query runs. Cache key incorporates `groupId` only, so cached weather may correspond to a different lat/lng than a fresh fetch.
- Reproducer: a location group with 3 hotels in different cities. Toggle weather off and on; the weather may switch between different city's coordinates on different sessions.
- File: `actions.ts:59–73`.

**P1 — Group is "exactly 1 location group" but the gate doesn't account for the group spanning many physical locations / cities.**
The UI gate is "exactly one location group" (page.tsx:101–104, tooltip line 290–293). But "London Hotels" can be a group with 50 hotels. The user thinks they're getting weather for "their hotel" but they're getting weather for one hotel in the group. The label on the weather card just says "Weather: Daily precipitation and temperature for the selected range" (page.tsx:355–356) — no mention of which hotel/city.
- Mitigation idea: show the resolved hotel name in the chart subtitle.
- File: `page.tsx:354–360`, `actions.ts:50–79`.

**P2 — `WeatherMiniChart` has no granularity awareness.**
The bar chart is daily regardless of main-chart granularity. Switching the main chart to monthly leaves the weather chart still daily — visual mismatch on the X-axis density.
- File: `weather-mini-chart.tsx:26–95`.

**P2 — No auth-scoped lat/lng access check.**
`fetchWeatherForLocationGroup` does `await getUserCtx()` (auth check) but doesn't verify the user has scope over the group. An external (scoped) user can query the weather for any group they know the ID of — which leaks "this group exists and has hotels with coordinates in city X" via the returned weather data and the time it takes.
- File: `actions.ts:50–79`.

# Cross-section issues

## C1 — Two duplicate / drifting comparison-period helpers

`getComparisonDates` lives in `src/lib/analytics/metrics.ts:30–46`, called by both pivot.ts (line 165) and trend-builder/actions.ts (line 102). So at least the comparison-period math is shared. ✓ (Low severity.)

But `Compare` dashboard does NOT use `getComparisonDates` — it has no comparison period at all (Compare is current-period side-by-side, not period-over-period). So users wanting "Marriott YoY Q1" need Trend Builder; "Marriott vs. Hilton current period" needs Compare. No single dashboard does period-over-period across multiple entities. Probably product intent — noting for awareness.

## C2 — Maturity anchored to `filters.dateTo` is consistent across compare and pivot but missing from trend-series

`shared.ts:119–157` (`buildMaturityCondition`) anchors to `filters.dateTo`. Pivot uses it (pivot.ts:60). Compare uses it (comparison.ts:46). Trend-series builds its WHERE clause inline (trend-series.ts:106–119) and **does not call `buildMaturityCondition`**. Even if `SeriesFilters` had a `maturityBuckets` field (it doesn't), the trend query wouldn't honor it. Concretely: a maturity filter set on the global analytics filter bar is silently ignored by Trend Builder both because the global filters aren't read AND because the maturity helper isn't called.

- File: `trend-series.ts:96–138`.

## C3 — `fee inclusion` definition drifts across the three tools

| Tool | Fee inclusion (default sales mode) | Fee inclusion (revenue mode) |
| --- | --- | --- |
| Compare | Includes fees in revenue + transactions | Restricts to `is_booking_fee=true OR netsuite_code IN (9991, 9992)` |
| Pivot | Includes fees (and reversals) | Same restriction |
| Trend Builder (`metric=revenue`) | Includes fees | n/a — no metricMode wiring |
| Trend Builder (`metric=booking_fee`) | Only `is_booking_fee=true` (excludes 9992) | n/a |

The Trend Builder `booking_fee` metric is **the odd one out**: it implements the fee filter as `is_booking_fee=true` only, dropping 9992 (cash handling). Every other surface uses the OR of both. Users comparing "trend of booking_fee over time" against "Portfolio revenue mode total" will see the trend chart's totals consistently below.

- File: `trend-series.ts:85–91` vs `shared.ts:45–47`.

## C4 — All three tools use raw COUNT for "transactions" — reversal pairs are double-counted

- Compare: `COUNT(*)` (`comparison.ts:102, 142, 186`).
- Pivot: `COUNT(expr)` per metric (`pivot-engine.ts:200`) — counts non-null rows.
- Trend Builder: `COUNT(*)::numeric` for `metric=transactions` (`trend-series.ts:81–82`).

Schema docstring (line 638–639) confirms reversal pairs share keys with opposite-sign `net_amount`. None of these tools subtract reversal rows from the count. A heavily-refunded period shows inflated transaction counts; revenue self-zeros (good); avg_basket_value is dragged down (bad).

- Concrete reproducer: pick a date range that includes a "reload" event where a CSV was reprocessed (the schema mentions blob-level idempotency at lines 686–704, so reloads SHOULD not duplicate; but if the CSV was re-issued with reversals + new records, transactions doubles).

## C5 — Schema drift not propagated to Pivot Table dimension/metric allowlists

The most severe pattern in this audit. The NetSuite ETL migration (2026-04-24) dropped `gross_amount`, `quantity`, `booking_fee`, `sale_commission`, `discount_amount` from `sales_records` and `region` from `locations`. Both are explicitly called out in the schema (lines 186, 472, 634–639). Yet:

- `pivot-engine.ts:38–50` — references all 6 dropped columns
- `pivot-store.ts:12–25` — exposes `region`, `gross_amount`, `quantity`, `booking_fee` to the user
- `pivot-engine.test.ts:22–139` — tests for these still pass because they don't hit the DB

Any pivot run will fail. This is a **P0 production bug** that should already be caught by the e2e test surface but evidently is not.

## C6 — No FilterBar mounted on Pivot Table or Trend Builder pages

The Portfolio page presumably mounts the global FilterBar. Pivot Table and Trend Builder do not — verified by inspection of `pivot-table/page.tsx` and `trend-builder/page.tsx`. Combined with C2 (trend ignores global filters) and the fact that pivot uses a separate filter store (P1 in pivot section), users cannot see or change filters on these pages. They are silently configured to defaults whenever a user lands on them via direct URL or after a navigation reset.

## C7 — Zero / tied "best" handling differs

- Compare: ties highlight all winners; never highlights when winning value is zero.
- Pivot: no "best" concept.
- Trend Builder: no "best" concept.

OK across the three. Just noting Compare's tie behavior in the Compare section.

## C8 — All three tools rely on `wrapAnalyticsQuery` / `unstable_cache` with 24h TTL — stale on partial reloads

Cached behind `getEntityMetricsCached`, `executePivotCached`, `getTrendSeriesDataCached` with TTL=86400s. Tags allow `/admin/cache` invalidation. If a CSV is reloaded mid-day for a single region (per the AU region work in commit `c2a5cfe`), the cached analytics for that region won't reflect the reload until either (a) admin manually invalidates, or (b) 24h elapses. Compare/Pivot/Trend Builder all share this.

The cache scope key collapses internal users into one bucket but isolates external scopes (per `cache-scope.ts` referenced in the queries). This is correct for performance but means **a single internal user with stale data has no path to "fresh fetch this query"** without admin intervention.
