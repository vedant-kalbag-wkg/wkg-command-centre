# Portfolio Dashboard — Logic & Audit

Source render entry: `src/app/(app)/analytics/portfolio/page.tsx`
Server actions:    `src/app/(app)/analytics/portfolio/actions.ts`
Core SQL:          `src/lib/analytics/queries/portfolio.ts`
Performer SQL:     `src/lib/analytics/queries/high-performer-analysis.ts` + `src/lib/analytics/queries/location-revenues.ts`
Shared helpers:    `src/lib/analytics/queries/shared.ts`
Active-locations:  `src/lib/analytics/active-locations.ts`

The default `metricMode` is `"sales"` (canonicalise-filters.ts:44, types.ts:54). In Sales mode the queries below count and sum **every** row in `sales_records` — including booking-fee (NetSuite 9991) and cash-handling-fee (NetSuite 9992) rows. In Revenue mode the WHERE clause restricts to those two fee codes (shared.ts:51-53).

Refunds: NetSuite emits a refund as a separate, opposite-signed row sharing `(saleRef, refNo, transactionDate)` with the original (schema.ts:638-639). `SUM(net_amount)` therefore nets correctly, but `COUNT(*)` and `COUNT(DISTINCT product_id)` count both legs.

The shared WHERE assembly is `buildPortfolioWhere()` (portfolio.ts:42-69) — it ANDs together: `dateCondition`, `scopeCondition` (RBAC), `activeLocationCondition`, `maturityCondition`, `metricModeCondition`, `dimensionConditions` (productIds, hotelIds, hotelGroupIds, regionIds, locationGroupIds, locationTypes). `archivedAt` on `locations` is **not** filtered by `buildActiveLocationCondition()` (active-locations.ts:29-46) — see Cross-section issue X1.

---

## Section: KPI Strip

Render: page.tsx:262-272 (renders 5 `StatCard`s from the `kpis` memo at page.tsx:145-188).
Data:   `getPortfolioSummary` — portfolio.ts:96-131 (called via cached wrapper from actions.ts:51).

### Logic

KPI strip = 5 cards. Values come from a single SQL query plus a derived avg-basket calculation. A second copy of the same query runs against the prior period (date-shifted by `getComparisonDates`, metrics.ts:30-46) to populate the `delta` chips.

| KPI label | Source field | SQL / aggregation | Notes |
|---|---|---|---|
| `metricLabel` ("Sales" or "Revenue") | `summary.totalRevenue` | `COALESCE(SUM(sales_records.net_amount), 0)` (portfolio.ts:110) | Nets refund rows. Includes/excludes fee rows depending on `metricMode`. |
| Transactions | `summary.totalTransactions` | `COUNT(*)::text` (portfolio.ts:111) | Every `sales_records` row. NOT distinct on saleRef/refNo. |
| Avg Basket | `summary.avgBasketValue` | `totalRevenue / totalTransactions` in JS (portfolio.ts:127) | Returns 0 when transactions=0. |
| Unique Outlets | `summary.uniqueOutlets` | `COUNT(DISTINCT sales_records.location_id)::text` (portfolio.ts:114) | Distinct active locations that transacted in window. |
| Unique Products | `summary.uniqueProducts` | `COUNT(DISTINCT sales_records.product_id)::text` (portfolio.ts:113) | Distinct product UUIDs (e.g. "Booking Fee" is one product). |

Comparison delta: `calculatePeriodChange(current, previous)` (metrics.ts:6-9) → `((c-p)/p)*100`. Returns `null` when previous=0; `toDelta` (page.tsx:61-73) then hides the chip. `direction` rounded at ±0.1pp; values in (-0.1, +0.1) render as `flat`.

`comparisonMode` toggle (`mom` / `yoy`) drives `getComparisonDates(dateFrom, dateTo, mode)` (metrics.ts:30-46). `mom` shifts by `(durationOfWindow + 1 day)` so periods are adjacent, non-overlapping. `yoy` does `setFullYear(-1)` on both endpoints — naively, so a Feb-29 input shifts to Mar-01 (no day-of-year alignment).

Filters that mutate this section: every filter in `buildPortfolioWhere` — date, scope, active-locations (exclusions), maturity, metricMode, productIds, hotelIds, hotelGroupIds, regionIds, locationGroupIds, locationTypes.

Business meaning: top-of-page "is the portfolio growing?" snapshot. Operators look at Revenue + Avg Basket for commercial direction; Unique Outlets / Products for breadth. A drop in Unique Outlets at constant Revenue means concentration risk.

Edge cases handled: `previousSummary` may be `null` (the catch in actions.ts:53-54) — `toDelta` then returns `undefined` and the chip is omitted. `previous=0` → null delta. `transactions=0` → `avgBasketValue=0` (not null).

### Issues

- **P0 — "Transactions" double-counts every booking that has a fee.** In Sales mode (the default) every fee row is its own `sales_records` row alongside the principal sale. A typical NetSuite booking emits 2 rows (sale + booking fee = 9991) or 3 rows (sale + booking fee + cash-handling fee = 9992). `COUNT(*)` counts all of them. portfolio.ts:111. So if a hotel did 100 underlying bookings and every booking had a 9991 fee, the KPI shows "200 Transactions". Cash-handling adds a third. The Transactions number is therefore not a count of customer transactions — it is a count of ledger lines. The user-visible label "Transactions" is misleading; the correct count would be `COUNT(DISTINCT (region_id, ref_no))` filtered to non-fee rows. Same bug propagates to Avg Basket (denominator is inflated → basket value is understated by ~50%).
- **P0 — Refunds inflate the Transactions count.** A reversal is a separate row in the same `(saleRef, refNo)` (schema.ts:639). `COUNT(*)` counts it as a positive transaction even though `SUM(net_amount)` nets it to ~0. So a fully-refunded booking with a fee shows up as **4 transactions** in the KPI (sale + fee + sale-reversal + fee-reversal). Same file/line as above.
- **P1 — `uniqueProducts` counts fee rows as distinct products.** Booking Fee and Cash Handling Fee are products (they have a row in `products`). In Sales mode the Unique Products KPI therefore includes them — claiming "we sold 8 distinct products" when the customer view is 6 distinct products + 2 fee SKUs. portfolio.ts:113.
- **P1 — `uniqueOutlets` only counts outlets that transacted in the window, not active outlets.** The label "Unique Outlets" implies portfolio size; the value is "outlets that recorded ≥1 row this period". An outlet that went live but had zero sales is invisible. portfolio.ts:114. (Often desired — but not what the label says.)
- **P2 — `avgBasketValue=0` when transactions=0 instead of null.** portfolio.ts:127 returns `0`, but `calculateAvgBasketValue` (metrics.ts:87-92) returns `null` for the same input. The portfolio summary disagrees with its own utility. UI then formats 0 as "£0.00" — looks like a real value.
- **P2 — YoY date shift is naive `setFullYear(-1)`.** metrics.ts:35-43. Leap-day windows (`Feb 29 → Feb 28 → Mar 1` JS quirk) shift to a different day-of-year. Doesn't matter for monthly aggregates but produces wrong comparison-period for short windows that span Feb 29.
- **P3 — Skeleton/placeholder array length is hardcoded to 5.** page.tsx:263. Fragile if a 6th KPI is added.

---

## Section: Threshold Editor

Render: page.tsx:275 (`<ThresholdEditor />`), component at threshold-editor.tsx.
Store:  `src/lib/stores/performer-threshold-store.ts`.

### Logic

Two numeric inputs (`Green cutoff %` / `Red cutoff %`) write to a Zustand store persisted in `localStorage` under key `wkg:performer-threshold` (performer-threshold-store.ts:48). Defaults: `green=30`, `red=30`. Yellow = `100 - green - red`.

Validation (threshold-editor.tsx:47-54): both must be ≥0, ≤100, and `green + red ≤ 100`. While the draft is invalid, the store is **not** updated (commitIfValid bails early, lines 59-66). On valid commit, `onChange` fires and the consumer re-fetches.

The store values are passed by `loadData` (page.tsx:117-118) into `fetchHighPerformerPatterns(filters, greenCutoff)` and `fetchLowPerformerPatterns(filters, redCutoff)`. They drive *only* the High Performer and Low Performer Patterns cards. They do **not** affect the Outlet Tiers table — that still uses the `appSettings`-based £-revenue thresholds (`threshold_red_max` / `threshold_green_min`, thresholds-server.ts:7).

Business meaning: per-user knob. A regional manager who only owns 20 outlets may want top-50%/bottom-50% to make patterns meaningful; an exec viewing the full portfolio uses 30/30.

Edge cases handled: typing freely in the input is allowed (drafts are local state), so inflight invalid pairs don't churn the store. Reset button restores 30/30. SSR no-op storage.

### Issues

- **P1 — Threshold values are persisted to `localStorage` but used in a server action**, so two analysts viewing the same dashboard see different "Green tier" definitions for the same filters. Not surfaced in the URL → not shareable, not exportable, not stamped in audit logs. threshold-editor.tsx + actions.ts:107-121.
- **P1 — Red cutoff and Green cutoff cards use the SAME label "Avg Sales/Room"** but compute the average across totally disjoint outlet sets. A user comparing "Avg / Room" between High Performer (green) and Low Performer (red) cards may not realise these are NOT the same metric on the same population. This is a presentation issue but the threshold editor is the only thing controlling tier assignment, so worth flagging here.
- **P2 — Initial render uses store defaults (30/30) before the persist middleware hydrates from localStorage.** On a slow hydrate the first server-action call sends 30/30, then a second call sends the persisted value — two server round-trips per page load. No loading guard against the hydrate race.
- **P3 — There is no visual link between this editor and the two cards it controls.** The control sits between the KPI strip and the High Performer card with no copy explaining "this only affects the next two cards" — a user could reasonably expect it to drive the Outlet Tiers traffic-light too.

---

## Section: High Performer Patterns

Render: page.tsx:279-291; component at high-performer-patterns.tsx.
Data:   `getHighPerformerData` → `computePerformerPatterns(direction='top')` — high-performer-analysis.ts:97-280.

### Logic

Step 1 — get per-location revenue for the filtered period via `getLocationRevenuesForRequest` (location-revenues.ts:76-95):

```sql
SELECT sales_records.location_id, locations.name, COALESCE(SUM(sales_records.net_amount), 0), locations.num_rooms
FROM sales_records INNER JOIN locations
WHERE <buildWhere>  -- date, scope, activeLocations, maturity, dimensions
GROUP BY location_id, name, num_rooms
```

The WHERE is **identical to `buildPortfolioWhere` minus `metricModeCondition`** (location-revenues.ts:35-51 vs portfolio.ts:42-69). So in Revenue mode, the universe of "locations" is pre-filtered to those with fee rows; in Sales mode, every row counts.

Step 2 — sort DESC, pick top `greenCutoff%` (high-performer-analysis.ts:71-82). Always picks `Math.max(1, Math.ceil(n*pct/100))` so any non-zero cutoff returns ≥1 location when the universe is non-empty.

Step 3 — three parallel queries against the picked tier:

A. **Region distribution** (lines 156-166): COUNT DISTINCT location_id per region, joined via `location_region_memberships`. Percentage = count / tierSize. Note this is membership count — a single location in two regions is counted twice (rare but possible).

B. **Avg kiosk count** (lines 169-181): subquery `COUNT(*)` over `kiosk_assignments WHERE unassigned_at IS NULL` per location, then `AVG(kiosk_count)`. Only counts locations with ≥1 active assignment — locations in the tier with zero kiosks are silently dropped from the average.

C. **Top 5 products by revenue for tier locations** (lines 186-199):
```sql
SELECT products.name, SUM(net_amount)
FROM sales_records JOIN products JOIN locations
WHERE location_id = ANY($tierIds)
  AND sales_records.is_booking_fee = false
  AND <whereClause>  -- buildWhere from above (no metric-mode predicate)
GROUP BY products.name
ORDER BY revenue DESC LIMIT 5
```

Step 4 — derived metrics in JS (lines 209-226):
- `avgRoomCount` = unweighted mean of `num_rooms` over tier members where num_rooms IS NOT NULL.
- `avgRevenuePerRoom` = `SUM(tier revenue where rooms>0) / SUM(tier rooms)` — weighted, not a mean of ratios. **Different formula from the per-row revenue/room shown in Outlet Tiers.**

Step 5 — string insights generated bullet-style (lines 235-265). Includes "{N} of {tier} top performers are in region {topRegion}" etc.

Filters: date, scope, active-locations, maturity, dimension filters (productIds, hotelIds, hotelGroupIds, regionIds, locationGroupIds, locationTypes). Notably absent: `metricModeCondition`. The `topProducts` sub-query manually adds `is_booking_fee = false` — see Issues.

Business meaning: "what do our best outlets have in common?" — used by ops to identify positive patterns to replicate (kiosk count, room count, location group, top SKUs).

Edge cases handled: empty universe → `count=0`, returns short-circuit shape with single insight string (lines 136-150). `tierRoomsTotal=0` → `avgRevenuePerRoom=null`. Top products list can be empty → bullet not emitted.

### Issues

- **P0 — Top-products sub-query inside green-tier card excludes Booking Fee but NOT Cash Handling Fee.** high-performer-analysis.ts:194 has `AND ${salesRecords.isBookingFee} = false`. That misses NetSuite 9992 (Cash Handling Fee) rows whose `is_booking_fee = false` but whose product name is "Cash Handling Fee". So Cash Handling Fee will appear in the "Top Products (Green-Tier Locations)" table — every other fee-aware analytics path uses `buildNonFeeCondition()` which OR's both, but this hand-rolled predicate doesn't. Same bug applies symmetrically to the Low Performer card (same code path, lines 153-200 of computePerformerPatterns). Reproducer: load any range with `metricMode=sales`, observe "Cash Handling Fee" rank in top 5 for the green tier.
- **P1 — Tier ranking ignores fee rows in Sales mode but does not in Revenue mode.** The "per-location revenue" used to bucket tiers is `SUM(net_amount)` over all rows passing `buildWhere` (location-revenues.ts). In Sales mode, fee rows count toward the tier ranking. So an outlet whose hotel-management-team aggressively books many low-margin services (driving fee count up) could outrank an outlet with higher actual product revenue. There is no explicit decision on whether tiering should be by product revenue or total ledger sum — the dashboard silently picks "total ledger".
- **P1 — `avgRevenuePerRoom` in this card uses a different formula from `revenuePerRoom` in the Outlet Tiers table.** Here it's `SUM(tier_revenue where rooms>0) / SUM(tier_rooms)` (weighted by room count). In Outlet Tiers it's `row.revenue / row.numRooms` per row. The two will not agree even when one outlet is shown in both contexts. high-performer-analysis.ts:218-226 vs portfolio.ts:407-408.
- **P1 — Region distribution percentages can sum to >100%.** A location may have multiple `location_region_memberships` rows. `COUNT(DISTINCT location_id)` per region is correct per region but the same location is counted in each of its regions — `sum(percentages)` then exceeds 100. high-performer-analysis.ts:158-166. Reproducer: any location with multi-region membership in the green tier.
- **P1 — `avgKioskCount` excludes tier locations with zero active kiosks.** The subquery only emits a row when `COUNT(*) > 0` (it groups by location_id from kiosk_assignments). Then `AVG(kiosk_count)` averages over surviving rows. So a tier with 10 outlets where 3 have no active kiosks would publish "avg 4.5 kiosks" but really it's 3.15 (45/14). high-performer-analysis.ts:169-181.
- **P2 — `avgRoomCount` silently drops outlets with NULL `num_rooms`.** The mean is taken over the filtered subset (line 213). The card label "Avg Rooms / Location" implies a tier-wide average. If 50% of the tier has unrecorded rooms, the displayed value is meaningfully biased toward whichever subset has been mapped.
- **P2 — `avgRevenuePerRoom` aggregator silently excludes tier members with NULL or zero rooms** (high-performer-analysis.ts:218-220) — same bias issue.
- **P2 — `clampCutoff` allows `0` to mean "empty tier"** (high-performer-analysis.ts:60), but the threshold editor only validates 0–100, so a user could set greenCutoff=0 and see a card with "0 of 200 locations are in the green tier" plus a single boilerplate insight. Cosmetic but ugly.
- **P3 — Hard-coded `£` symbol in insight string** (high-performer-analysis.ts:258). Multi-currency portfolios (when AU/IE come fully online) will see "Top performers average £200,000 revenue per room" for AUD/EUR data.

---

## Section: Low Performer Patterns

Render: page.tsx:293-305; component at low-performer-patterns.tsx.
Data:   `getLowPerformerData` → `computePerformerPatterns(direction='bottom')` — high-performer-analysis.ts:305-322.

Symmetric to High Performer. Picks the **bottom** `redCutoff%` of the same `sortedDesc` array using `slice(n - count)` (high-performer-analysis.ts:81). Same WHERE assembly, same three sub-queries, same JS-side aggregation.

### Logic

See High Performer Patterns. Identical pipeline; only the slice direction differs. The `redCount`, `regionDistribution`, `avgKioskCount`, `avgRoomCount`, `avgRevenuePerRoom`, and `topProducts` fields all describe the bottom-tier set.

Business meaning: "what do our worst outlets have in common?" — used to spot operational patterns (low kiosk count, low room count → undersized properties, particular region cluster → support gap).

### Issues

- All P0/P1/P2 issues from High Performer Patterns apply identically (same shared computation function). In particular:
  - **P0 — "Top Products (Red-Tier Locations)" includes Cash Handling Fee** (high-performer-analysis.ts:194 — same line, same bug, both directions).
  - **P1 — Bottom-tier ranking includes fee rows in Sales mode**, so a location with low product revenue but many fee rows can be misclassified out of the red tier.
- **P2 — `count === 0` insight string is misleading.** When everything is filtered out (e.g. user picked a maturity bucket with no locations) the card says "No locations currently qualify as bottom performers" (high-performer-analysis.ts:142) — which sounds like good news but actually means data is missing.

---

## Section: Daily Trends

Render: page.tsx:307-323; component at daily-trends.tsx.
Data:   `getDailyTrends` — portfolio.ts:273-299.
Events: `getBusinessEvents(dateFrom, dateTo)` — trend-series.ts:142-188.

### Logic

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

Two-line chart on `recharts`. Left Y-axis `revenue` (Azure #00A6D3 line); right Y-axis `transactions` (Graphite #121212 line). X-axis tick = `${day}/${month}` from `new Date(YYYY-MM-DD)` (daily-trends.tsx:39-43). Tooltip uses `toLocaleDateString("en-GB")`.

`EventAnnotations` overlays vertical lines for business events whose `[start_date, end_date]` overlaps the window (trend-series.ts:171-172). All `EVENT_CATEGORIES` are active by default for the portfolio view (page.tsx:98).

Filters: same as `buildPortfolioWhere`. So a regionId filter shrinks both lines.

Business meaning: trend trajectory and visible spikes / dips. The event overlay lets ops attribute movement to known events (school holidays, conferences, etc.).

Edge cases handled: missing dates aren't filled — the chart is sparse. Recharts draws a continuous line by skipping gaps, which can mask "we had zero revenue on Sunday".

### Issues

- **P0 — Same Transactions double-counting and refund inflation as the KPI strip** (portfolio.ts:287). The right-axis line is `COUNT(*)` over all rows passing the filter — fee rows and refund rows included. So a day with 100 bookings and 100 fees and 5 refunds shows 205 transactions. The shape of the line vs. the revenue line is therefore distorted: revenue may dip on a refund-heavy day while transactions visibly rise.
- **P1 — Date-string parsing is timezone-sensitive.** `new Date("2026-04-25")` is UTC midnight; in any negative-offset timezone the local-day rendering shifts to the previous day. UK/IE/AU users are fine (UTC≥0) but a US analyst impersonating into UK data sees X-axis labels off by one day. daily-trends.tsx:39-43 and tooltip 63-66.
- **P1 — Business events are not scoped to the user's view.** `getBusinessEvents(dateFrom, dateTo)` (trend-series.ts:142) does not filter by region, hotel, or scope_value; the `scopeType` and `scopeValue` columns come back unused. So a UK analyst viewing UK-only filtered data sees an Australian event annotation with the same prominence. (Internal users only — external get `[]` from actions.ts:104; but for internals it's wrong.)
- **P1 — Empty days are not interpolated.** A day with zero rows produces no SQL row. Recharts straight-lines across the gap, so a real "everyone closed for Boxing Day" looks identical to "data was missing for Boxing Day". Combine with P1 above (timezone) and the chart can subtly misrepresent the holiday shape.
- **P2 — Revenue line color is `#00A6D3` (brand Azure) hard-coded** (daily-trends.tsx:74). Fine here, but if the `metricMode=revenue` toggle is on, the line still says "Revenue" with the same Azure color as the Sales mode — there is no visual indicator that the metric definition has flipped from gross-sales to fee-revenue.
- **P3 — Y-axis revenue tick formatter shows full GBP (£12,345.00) per tick** (line 47), which crowds the axis on large-revenue portfolios. `formatCompactNumber` would be better.

---

## Section: Category Performance

Render: page.tsx:325-337; component at category-performance.tsx.
Data:   `getCategoryPerformance` — portfolio.ts:135-167.

### Logic

```sql
SELECT
  products.name AS category_name,           -- (sic) groups by PRODUCT name
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*)::text AS transactions,
  COUNT(*)::text AS quantity,                -- (sic) duplicate of transactions
  COALESCE(AVG(sales_records.net_amount), 0) AS avg_value
FROM sales_records INNER JOIN products
WHERE <buildPortfolioWhere>
GROUP BY products.name
ORDER BY revenue DESC
```

Horizontal bar chart of `revenue` per "category". Component renders `categoryName` on the Y-axis (category-performance.tsx:39-44) and revenue (Azure bar) on the X-axis.

Filters: same as `buildPortfolioWhere`.

Business meaning: "what do we sell?" breakdown. The `quantity` and `avg_value` fields are populated but never displayed in the bar chart — they live in the typed shape (`CategoryPerformanceRow`) for future use.

Edge cases handled: empty result → `hasCategoryData=false` triggers `<empty>` in `<ChartCard>` (page.tsx:330).

### Issues

- **P0 — This is NOT category performance. It is product performance with a misleading label.** The `products` table has a real `categoryName` column (schema.ts:353) that's denormalised from NetSuite. `getCategoryPerformance` ignores it and groups by `products.name` (portfolio.ts:149, 156). The card title is "Category Performance" / description "{metric} by product category". A user looking for "Tours & Activities" as a category sees instead every individual product (Booking Fee, Cash Handling Fee, Heathrow Express, Stansted Express, …) rendered as a "category". Either the SQL should use `products.category_name` or the card title should say "Product Performance". Same bug rolls through to Top Products which uses the same field.
- **P0 — Booking Fee / Cash Handling Fee appear as top "categories" in Sales mode.** No `buildNonFeeCondition` is applied (portfolio.ts:139). In a typical UK feed those two pseudo-products dominate the bar chart by revenue. Compare to Top Products (portfolio.ts:241) which correctly excludes them — Category Performance should follow the same rule but doesn't.
- **P1 — `quantity` is a copy of `transactions`, not a real quantity.** Both are `COUNT(*)::text` (portfolio.ts:151-152). The schema for sales_records lost `quantity` in the NetSuite ETL rewrite (schema.ts:635) so there is no quantity to sum — but the field name `quantity` and the UI type `CategoryPerformanceRow.quantity` (types.ts:72) suggest otherwise. Any future consumer that reads `quantity` as a unit count will be wrong.
- **P1 — `avg_value = AVG(net_amount)` is not "avg basket value".** It's the per-row average net amount, including fee rows (so it's pulled toward the £1.50–£3 fee range) and reversal rows (so refunded sales drag it negative). Misleading if displayed.
- **P2 — Chart height grows linearly with row count** (`Math.max(300, data.length * 40)`, category-performance.tsx:27). With 30+ products the card becomes a 1200px scroller in a 12-col grid — unusable.

---

## Section: Top Products

Render: page.tsx:339-349; component at top-products.tsx.
Data:   `getTopProducts` — portfolio.ts:171-269.

### Logic

Two distinct query shapes driven by `metricMode`:

**Sales mode (default), portfolio.ts:239-259:**
```sql
SELECT products.name AS product_name,
       COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
       COUNT(*)::text AS transactions,
       COUNT(*)::text AS quantity
FROM sales_records INNER JOIN products
WHERE <buildPortfolioWhere with metricMode forced to 'sales'>
  AND NOT (sales_records.is_booking_fee = true OR sales_records.netsuite_code IN ('9991','9992'))
GROUP BY products.name
ORDER BY revenue DESC
LIMIT 20
```

The non-fee predicate (`buildNonFeeCondition`, shared.ts:57-59) correctly excludes BOTH 9991 and 9992 here (this is the only place in the portfolio file that does so).

**Revenue mode, portfolio.ts:194-237:**
The fee row's product is generic ("Booking Fee" / "Cash Handling Fee"). To attribute fees to the thing the customer actually bought, the query LATERAL self-joins back into `sales_records`, finds a non-fee row in the same `region_id` whose `ref_no = REGEXP_REPLACE(parent.ref_no, '-b$', '')`, and groups by THAT row's product name. So Revenue mode reports "fees driven by product".

Filters: `buildPortfolioWhere` with `metricMode='sales'` forced — i.e. the metric-mode predicate is not applied (it's overridden to apply the explicit fee/non-fee condition instead).

UI columns (top-products.tsx:24-32): `#`, Product, `metricLabel` (revenue), `Avg metricLabel/Txn`, Transactions, Quantity. The "Avg / Txn" column = `revenue / transactions` (line 44).

Business meaning: ranking of revenue contribution by product. Sales mode = "what are people buying?" Revenue mode = "what booking lines drive WKG's commission?".

Edge cases handled: `transactions=0` → "—" (line 45). Region scoping in the LATERAL join is essential (portfolio.ts:217) since `(refNo)` repeats across regions.

### Issues

- **P1 — "Quantity" column is `COUNT(*)`, identical to "Transactions".** portfolio.ts:212/253. The UI shows two columns with identical numbers labelled differently, with the Quantity label implying units sold. Leftover from pre-NetSuite-ETL when sales_records had a real `quantity` field (schema.ts:635 confirms removal).
- **P1 — Revenue mode mis-attributes when the parent sale has been refunded but the fee has not** (or vice-versa). `LATERAL ... LIMIT 1` picks any non-fee row in the same region with the trimmed refNo — including reversals. If the LATERAL happens to pick a reversal row, the fee is attributed to that product correctly (reversal still has the same product_id), so this is actually OK. But if BOTH the fee and the parent are reversed and the chosen `parent_one` is the reversal, the rank still attributes correctly. Mostly fine — flagging because the LIMIT 1 is non-deterministic.
- **P1 — Revenue mode's parent-detection assumes the suffix is always exactly `-b`.** portfolio.ts:218: `REGEXP_REPLACE(ref_no, '-b$', '')`. The audit prompt notes both `-b` AND `-h` are reversal markers. Refund-of-a-fee is a real shape (`<orig>-b-h`?). If the fee row has any other suffix variant, the regex fails to strip it and the LATERAL picks no parent → the fee is dropped from Revenue mode entirely. Worth a count check on `ref_no` patterns in production.
- **P1 — Revenue mode "transactions" column counts fee rows, not parent transactions.** portfolio.ts:212 (`COUNT(*)`), measured on the outer fee-row scan. A booking with both 9991 and 9992 contributes 2 transactions to the same product. So the "Transactions" column in Revenue mode means "fee rows attributed to this product", which is not what the column header implies.
- **P2 — In Sales mode, `transactions` still includes refund rows.** The non-fee predicate filters fees but reversal rows for products are not excluded (they share `is_booking_fee=false` and a non-fee `netsuite_code`). So a popular product with a 5% refund rate inflates its transaction count by 10% (5% original + 5% reversal).
- **P2 — `categoryName` in the result is `productName`** (portfolio.ts:233, 264). Same misuse as Category Performance. Type field exists for backward compatibility but the value is wrong. No current UI consumer uses `categoryName` in this card.
- **P3 — `LIMIT 20` is hardcoded** (portfolio.ts:226, 258). No way to "see more" from the UI.

---

## Section: Hourly Distribution

Render: page.tsx:351-363; component at hourly-distribution.tsx.
Data:   `getHourlyDistribution` — portfolio.ts:303-331.

### Logic

```sql
SELECT
  EXTRACT(HOUR FROM sales_records.transaction_time)::int::text AS hour,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*)::text AS transactions
FROM sales_records
WHERE <buildPortfolioWhere>
  AND sales_records.transaction_time IS NOT NULL
GROUP BY EXTRACT(HOUR FROM transaction_time)
ORDER BY hour ASC
```

Bar chart of `revenue` per hour-of-day (0..23). Tooltip shows hour range. Filters identical to `buildPortfolioWhere` plus an explicit `transaction_time IS NOT NULL` (portfolio.ts:308-309) — necessary because `transaction_time` is nullable on the schema (schema.ts:652).

Business meaning: when do customers transact? Drives staffing, opening hours discussions, outage detection ("why is hour 14 zero today vs every other day").

Edge cases handled: NULL times are excluded — but invisibly (no count shown of dropped rows). DST-affected hours (Mar/Oct in UK) are blended into local-time bins because `transaction_time` is stored without timezone (schema.ts:652).

### Issues

- **P0 — `EXTRACT(HOUR FROM transaction_time)` operates on the time-of-day column with no timezone awareness.** `transaction_time` is `time` (no zone) in the schema. So if NetSuite delivers UTC times for an Australian feed (UTC+10/+11), the chart bins everything in Sydney's "UTC time of day" — a peak that locally happens at 18:00 shows up at 07:00 (wrong by 11h) on the chart. Even within UK, BST/GMT changes mean a 14:00 BST transaction in Mar–Oct lands in either 13:00 or 14:00 depending on whether the parser shifted to UTC. portfolio.ts:317. Worth verifying what timezone the CSV/feed actually emits.
- **P1 — Transaction count includes fee+refund rows.** Same as Daily Trends (portfolio.ts:319). The "transactions" field is computed but the bar chart only shows revenue — however the field is on the wire and exported via PortfolioData.
- **P2 — Rows with NULL `transaction_time` are silently dropped from the revenue bar chart.** There is no "unknown hour" bucket and no UI hint that some revenue is missing. If the feed ever drops time, the totals on this chart < KPI strip totals.
- **P2 — Hours with zero rows are not rendered** (no `0` bar). If a portfolio has zero sales between 02:00–05:00, the chart is missing those bars rather than showing them as flat zero — distorts the perceived "shape" of the daily curve.
- **P3 — Tooltip says `HH:00 - HH:59`** (hourly-distribution.tsx:46) — accurate but cosmetic.

---

## Section: Outlet Tiers

Render: page.tsx:365-382; component at outlet-tiers.tsx.
Data:   `getOutletTiers` — portfolio.ts:335-426.
Tier classifier: `classifyOutletTier(percentile)` — metrics.ts:97-102.

### Logic

```sql
SELECT
  locations.id AS location_id,
  COALESCE(locations.outlet_code, '') AS outlet_code,
  locations.name AS hotel_name,
  (SELECT MIN(kiosk_assignments.assigned_at) FROM kiosk_assignments
     WHERE kiosk_assignments.location_id = locations.id)::text AS live_date,
  COALESCE(<canonicalHotelGroupNameFragment>, NULL) AS hotel_group_name,
  (SELECT COUNT(*)::int FROM kiosk_assignments
     WHERE location_id = locations.id AND unassigned_at IS NULL) AS kiosk_count,
  locations.num_rooms AS num_rooms,
  COALESCE(SUM(sales_records.net_amount), 0) AS revenue,
  COUNT(*)::text AS transactions
FROM sales_records INNER JOIN locations
WHERE <buildPortfolioWhere>
GROUP BY locations.id, locations.outlet_code, locations.name, locations.num_rooms
ORDER BY revenue DESC
LIMIT 200
```

`canonicalHotelGroupNameFragment()` (shared.ts:187-200) resolves to the operator's group: first, `hotel_groups` joined via `locations.operating_group_id`; else, the `MIN(hotel_group_id)` from `location_hotel_group_memberships` (deterministic but lexicographic — arbitrary tie-break); else NULL.

Per-row JS post-processing (portfolio.ts:399-425):
- `percentile` = binary-search rank of revenue in sorted-asc revenues × 100/n.
- `sharePercentage` = revenue / sum(revenues) × 100.
- `tier` = `classifyOutletTier(percentile)`: ≥80 Premium, ≥50 Standard, ≥20 Developing, else Emerging.
- `revenuePerKiosk` = revenue / kioskCount, null when kioskCount === 0.
- `revenuePerRoom` = revenue / numRooms, null when numRooms is null or ≤0.

Maturity bucket displayed in UI (outlet-tiers.tsx:90-101): `calculateMaturityBucket(liveDate, NOW())` — **uses `new Date()` as reference, not `filters.dateTo`** (maturity.ts:13). Compare to the maturity FILTER (`buildMaturityCondition`, shared.ts:119-157) which correctly uses `filters.dateTo::timestamp`. Fix in commit f374da7 was to the SQL filter; the UI label fell out of scope.

Traffic-light pill (outlet-tiers.tsx:133-155): uses `appSettings`-stored `redMax`/`greenMin` GBP thresholds (thresholds-server.ts) — independent of the percentage-based threshold editor.

Filters: same as `buildPortfolioWhere`. Top 200 only (line 376) — silent truncation for >200-outlet portfolios.

Business meaning: full outlet leaderboard. Each row exposes Outlet Code, Hotel, Hotel Group, Maturity bucket, Kiosks, Rooms, Total revenue, Transactions, Revenue/Kiosk, Revenue/Room, Tier, traffic-light Status, and inline flag actions. The richest row in the dashboard.

Edge cases handled: 
- `outletCode` defaults to `''` (line 364), rendered as "—" (component line 85).
- `kioskCount=0` → revenuePerKiosk=null (rendered "—").
- `numRooms` null OR 0 → revenuePerRoom=null.
- `n=0` → `sortedRevenues.length=0`, `percentile=0` → tier='Emerging' for everyone (binarySearchRank returns 0 on empty). But the section is `hasOutletTiersData=false` first so empty state takes over.

### Issues

- **P0 — Maturity bucket displayed in the table uses `new Date()` (today) as the reference date**, not `filters.dateTo`. outlet-tiers.tsx:91-93 → maturity.ts:13 default param. So when an analyst views a March 2025 historical window in April 2026, an outlet that went live February 2025 is shown as "6+ Months" (live for 14 months as of today), even though for the reported window it was 0–1 month mature. The maturity FILTER in the SQL (shared.ts:125) was correctly fixed in commit f374da7 to use `filters.dateTo`, but this UI-side display fell out of scope. Reproducer: filter to a date range >1 year in the past, observe Maturity column.
- **P0 — `transactions` column double-counts fees and refunds.** portfolio.ts:371 (`COUNT(*)`). Identical issue to KPI strip; here it's even more exposed because it sits next to "Total Revenue" on the same row, encouraging the mental math of `Avg / Txn = Revenue / Transactions` which would be off by a fee multiplier.
- **P1 — `live_date` is `MIN(kiosk_assignments.assigned_at)`, not `locations.live_date`.** shared.ts:117. The schema has BOTH (`locations.live_date`, schema.ts:207, and `kiosk_assignments.assigned_at`). Per docs comment shared.ts:114-116, this is intentional ("first time any kiosk was assigned, regardless of whether it's still active"). But this disagrees with the `locations.live_date` column an admin can edit. If an outlet had a kiosk install date set manually (Feb 2025) but the first assignment record is from a later import (Mar 2025), the analytics view says Mar even though admin set Feb. No surfacing of this discrepancy.
- **P1 — `revenuePerKiosk` uses CURRENT active kiosk count for HISTORICAL revenue.** `kioskCount` = `COUNT(*) WHERE unassigned_at IS NULL` (shared.ts:207-214) — i.e. as of today. If an outlet had 4 kiosks in Q1, dropped to 1 in Q2, and the user views Q1, they see Q1 revenue ÷ 1 kiosk = inflated revenue/kiosk. Should use a point-in-time count anchored to `dateTo`, or at minimum `dateFrom` ≤ `assigned_at` ≤ `dateTo`.
- **P1 — Hotel group resolution is region-blind.** `canonicalHotelGroupNameFragment()` uses `MIN(hotel_group_id)` lexicographically (shared.ts:197) when no `operating_group_id` is set. UUIDs are random → arbitrary tie-break for properties belonging to multiple groups. Two analysts looking at the same outlet code can see two different "Hotel Group" labels if one of the memberships was added after the other. Documented in the comment (shared.ts:196-198) — flagged because ops have hit it.
- **P1 — `LIMIT 200` silently truncates large portfolios.** portfolio.ts:376. The card shows no "showing top 200 of N" indicator. KPI strip's `uniqueOutlets` could exceed 200 while the table only shows 200.
- **P1 — `revenuePerKiosk` and `revenuePerRoom` are unweighted by metric mode.** In Sales mode, revenue includes fee rows (so the per-kiosk number is "all transactions value per kiosk"); in Revenue mode it's "fee revenue per kiosk". Switching modes silently changes the meaning of the column with no visual cue beyond the metric label.
- **P2 — Traffic-light pill (`Status` column) and Tier badge can disagree.** Tier is percentile-based (relative); Status is GBP-threshold-based (absolute). An outlet at the 85th percentile in a low-revenue portfolio (Premium tier) could be classified `red` (below `redMax=500`). Two badges side-by-side telling different stories with no explanation. outlet-tiers.tsx:125-152.
- **P2 — Percentile calc breaks ties non-deterministically across renders.** `binarySearchRank` (portfolio.ts:428-437) uses a strict less-than on equality, so all rows with the same revenue get the same rank — but the placement within `sortedRevenues` is sort-order-dependent and the comparator `(a,b) => a-b` is stable in V8, so reproducible enough. P2 only because it's not strictly broken but `(rank/n)*100` for tied-revenue groups buckets them into a single percentile — multiple outlets all show as "Premium" or all as "Emerging" instead of being split.
- **P3 — `outletCode` empty string fallback** (portfolio.ts:364) means the row key (`row.outletCode || row.hotelName`, outlet-tiers.tsx:83) collides if two unmapped outlets share a hotel name. React will warn about duplicate keys.

---

## Section: Flags Drawer

Render: page.tsx:387-429 (Sheet from radix); button trigger at page.tsx:241-249.
Data:   `fetchActiveFlags` → `fetchLocationFlags()` — flags/actions.ts:71-76.

### Logic

Side panel listing all unresolved `location_flags` rows (DB query: `WHERE resolved_at IS NULL`, ordered by `created_at` ASC). Result is unstable_cache'd (TTL 86400s, tag `analytics:flags`).

For each flag the panel shows:
- `<FlagBadge flagType={f.flagType} />` — colored chip for `relocate` / `monitor` / `strategic_exception`.
- `formatDate(f.createdAt)` — created date, top-right.
- `f.reason` (if non-null) — operator's freeform note.
- `Raised by ${f.actorName}` — capture at insert time, not joined live.

Active-flag count is also rendered in the toolbar button (page.tsx:248).

The same `flags` array is also passed into Outlet Tiers (page.tsx:378) where existing flags render inline next to each row's `FlagDialog` button.

Filters: NONE. The drawer shows all unresolved flags portfolio-wide, regardless of the current filter state (date, region, etc.).

Business meaning: workflow follow-ups raised from the Outlet Tiers row action. Reviewed daily by ops to close out items.

Edge cases handled: empty list → "No active flags…" copy. SSR-safe (the actions file is "use server"). 401-style auth gate sits outside the cache (flags/actions.ts:74).

### Issues

- **P1 — Drawer is filter-blind.** A regional manager filtered to "UK only" still sees flags for Australian outlets in their drawer (and the count badge on the toolbar button). The Outlet Tiers section, by contrast, only shows flags for the rows it renders. Mismatch between the two surfaces. flags/actions.ts:52 has no scope/region condition.
- **P1 — "Raised by" displays the captured `actorName` snapshot at the time of flag creation,** not a live join to `user.name`. flags/actions.ts:31. If the actor changes their display name, historical flag attribution lags.
- **P2 — Cache TTL is 24h** (flags/actions.ts:68, `revalidate: 86400`). Flags created in the last 24h appear immediately because of the `revalidateTag(FLAGS_TAG, "max")` call after `createFlag` (line 114), but only if the create flow ran in the same Next.js process. Cross-process invalidation works via tag — fine. But a flag resolved by another user can take up to 24h to disappear from this drawer if no other event triggers a tag invalidation (resolveFlag does call revalidate on line 151 — OK).
- **P2 — Flag count doesn't change when a flag is created from another tab / by another user without page reload.** No live polling or WebSocket; only changes on `loadData` re-fetch (which is triggered by filter or comparisonMode changes). Mostly cosmetic.
- **P3 — Drawer is not virtualised.** A real portfolio with hundreds of flags would render every `<li>` in the DOM at once.

---

## Cross-section issues

- **X1 — `locations.archivedAt` is NOT honored by `buildActiveLocationCondition()`.** active-locations.ts:34-43 only filters via `outlet_exclusions`. The audit prompt asserts archived locations are filtered out via `buildActiveLocationCondition()`; this is **not true in the code**. So all sections of the Portfolio dashboard include sales rows from archived locations in their aggregates (`SUM`, `COUNT`, distinct counts, tier rankings, etc.). The Outlet Tiers table will even render archived locations as live rows. Repro: archive any location with sales rows; watch it persist in Outlet Tiers and contribute to KPI strip totals.
- **X2 — `locationTypes` filter silently drops NULL-typed outlets.** When the user selects "Hotel" or "Retail Desk", the predicate is `locations.location_type IN (...)` (shared.ts:101-106). Outlets where `location_type IS NULL` (a documented "not yet categorised" state per schema.ts:191-194) are excluded with zero UI signal. KPI strip `uniqueOutlets`, daily trends transactions, every section is affected. Reproducer: in dev/staging filter by any location type and compare totals to the unfiltered view — the difference is often material.
- **X3 — `outletCode` is unique per `(primaryRegionId, outletCode)`, not globally** (schema.ts:217-218 confirms `locations_region_outlet_unique`). Several pieces of analytics surface use `outletCode` for display (Outlet Tiers, exports). If two outlets in different regions share the same code (e.g. "MAR1" in UK and IE), the Outlet Tiers React `key` (`row.outletCode || row.hotelName`, outlet-tiers.tsx:83) collides. Same for any consumer that joins on outlet code without region. The query itself is keyed by `locations.id` so the SQL is fine; the UI rendering is not.
- **X4 — `metricMode` toggle is a hidden global filter.** Defined in `useAnalyticsFilterStore` and threaded into every server action via `canonicalise-filters.ts:44`. Switching it changes the meaning of every section on this dashboard (KPI label flips, but the chart titles like "{metric} by hour of day" rely on `useMetricLabel()` to swap). Categories Performance and Hourly Distribution still show currency in the same Azure colour and same axis ticks regardless of mode; the fact that the underlying SQL has switched from "all rows" to "fee rows only" is invisible to the user beyond the label text. P1 risk that an analyst views Revenue mode and reasons about it as gross sales.
- **X5 — Portfolio dashboard wires its inputs through TWO different cache code paths.**
  - The summary, category, top-products, daily-trends, hourly, outlet-tiers queries flow through `actions.ts` → `*Cached` wrappers (Next.js `unstable_cache`).
  - The high/low performer queries flow through `actions.ts:107-121` → `getHighPerformerData` / `getLowPerformerData` directly (NO `unstable_cache` wrapper).
  - Cache invalidation via `analytics:portfolio` tag therefore won't blow away the performer-pattern cards. They're not cached, but they re-run aggregate SQL on every render including the per-location revenue scan. P2 perf risk and P3 inconsistency.
- **X6 — The Top Products card and the High/Low Performer "Top Products" subsections use DIFFERENT fee-exclusion logic.**
  - Portfolio Top Products uses `buildNonFeeCondition()` (excludes 9991 OR 9992) — correct.
  - Performer-card top products uses `is_booking_fee = false` only (high-performer-analysis.ts:194) — incorrect.
  - Two tables labelled "Top Products" on the same dashboard, computed differently. Worth aligning on `buildNonFeeCondition()`.
- **X7 — Comparison delta on KPI strip uses `getComparisonDates`,** which does NOT carry forward filters that should logically shift (e.g. a "currently active outlets" filter doesn't account for outlets that came online between the prior period and now). MoM comparisons of Unique Outlets count are therefore artificially low for the prior period — outlets that didn't exist yet show as "no data". Probably the right behaviour but worth surfacing in copy.
- **X8 — Every "Transactions" / "Quantity" / "Avg Basket" number on this dashboard is wrong by the same factor in Sales mode** because none of them de-duplicate fee rows or reversal rows (consolidated repeat of P0s above). The fix is one helper:
  ```ts
  COUNT(DISTINCT (region_id, ref_no)) FILTER (WHERE NOT <fee> AND net_amount > 0)
  ```
  applied uniformly across `getPortfolioSummary`, `getDailyTrends`, `getHourlyDistribution`, `getCategoryPerformance`, `getOutletTiers`. The current `COUNT(*)` is structurally incorrect for everything labelled "Transactions" in user-facing copy.
