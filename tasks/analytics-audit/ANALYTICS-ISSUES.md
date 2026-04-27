# Analytics Issues — Prioritised

## Executive summary

This document catalogues every potential misrepresentation, correctness defect, and data-leak risk found in a deep audit of the analytics surface in `wkg-kiosk-tool` (Portfolio, Maturity Analysis, Heat Map, Regions, Hotel Groups, Location Groups, Compare, Pivot Table, Trend Builder, Commission, Experiments, Actions). The audit covered every dashboard section's render path, server action, and SQL, plus the cross-cutting infrastructure in `shared.ts`, `active-locations.ts`, `metrics.ts`, `scoped-query.ts`, `analytics-filter-store.ts`, and `sales-csv.ts`.

The highest-impact pattern is structural: many "Transactions" / "Avg Basket" / "Records with Commission" KPIs use raw `COUNT(*)` over `sales_records` while the underlying ETL emits one row per ledger line. Booking-fee rows (NetSuite `9991`) and cash-handling-fee rows (`9992`) inflate counts by 2-3× in the default sales mode; reversal/refund rows inflate them further. The compounding misrepresentation cascades into Avg Basket (denominator inflated → values understated), `revenuePerKiosk` (denominator separately wrong), composite Heat Map scoring (transactions weight inflated), tier rankings, percentile bands, and category leaderboards. Top Products is the only place that correctly excludes fees via `buildNonFeeCondition()`; every other dashboard is wrong by an unknown factor.

A second systemic pattern is silent location loss. `buildActiveLocationCondition()` does not filter `archivedAt`, so soft-deleted locations leak into every aggregate. `buildMaturityCondition()` silently drops locations with NULL `kioskLiveDate` from every bucket. `locationTypes` filter excludes NULL-typed locations with no UI signal. Membership tables (`location_region_memberships`, `location_hotel_group_memberships`, `location_group_memberships`) permit multi-membership but every group dashboard joins via INNER JOIN without de-duplication, so multi-region/multi-group locations are double-counted across rows and KPIs. The Pivot Table is broken end-to-end against the post-migration-0022 schema (it references six dropped columns and the dropped `region` dimension) — every pivot run fails at the database. Commission queries are fully unscoped (regional managers see whole-portfolio commission), and the reversal-handling contract on the commission ledger leaves `is_reversal=true` rows excluded by the dashboard filter while the recalc inserts a fresh row that double-counts.

P0 totals (confirmed misrepresentation, data corruption, or financial impact) sit at roughly two dozen findings, distributed across every dashboard. P1 totals (likely misrepresentation in common cases) are roughly fifty. The dashboards still ship usable directional signal in many cases, but every absolute number — and most relative comparisons — should be regarded as suspect until the systemic fixes (cross-cutting section at the end of this doc) are applied.

---

## P0 — Confirmed misrepresentation, data corruption, or financial impact

### Cross-cutting / systemic

- **[Cross-cutting] Archived locations leak into every analytics dashboard**
  - File: `src/lib/analytics/active-locations.ts:29-46, 60-67`
  - `getActiveLocationIds()` only excludes via `outlet_exclusions` — it does NOT filter `locations.archivedAt IS NULL`. Every dashboard's "active locations" predicate inherits this leak.
  - User impact: an archived hotel still contributes its 2024 sales to YTD revenue, still appears in tier tables, still distorts percentile rank in Heat Map and Peer Analysis.
  - Fix: add `WHERE archived_at IS NULL` to `getActiveLocationIds`. Make this explicit/configurable per dashboard if "include historical sales of archived hotels" is sometimes desired.

- **[Cross-cutting] `buildMaturityCondition` silently drops locations with NULL `kioskLiveDate` from every bucket**
  - File: `src/lib/analytics/queries/shared.ts:131-156`
  - When any bucket is selected, the predicate compares `kioskLiveDateSubquery` against `dateTo - INTERVAL`. If the subquery returns NULL (no `kiosk_assignments` row), every comparison is NULL → row is excluded from every bucket. Includes `6+mo` (which one might think should "include unknowns").
  - User impact: locations with `locations.live_date` set but no `kiosk_assignments` row vanish from any maturity-filtered view with no UI signal.
  - Fix: explicit fallback to `locations.live_date` when the subquery is NULL, OR a separate "unbucketed" filter chip.

- **[Cross-cutting] Internal viewer/member with zero `userScopes` is unrestricted**
  - File: `src/lib/scoping/scoped-query.ts:92`
  - `if (scopes.length === 0) return null;` for internal users — no filter applied. An internal user provisioned without scopes is treated identically to an admin. External users with zero scopes correctly throw; internal users do not.
  - User impact: silent global read of every analytics surface.
  - Fix: default-deny for internal users with zero scopes, or throw to surface the provisioning bug.

- **[Cross-cutting] Default sales mode includes fee rows in COUNT(*) → "Transactions" inflated by 2-3× across every dashboard**
  - File: `src/lib/analytics/queries/shared.ts:51-53` (`buildMetricModeCondition` returns undefined in sales mode), plus every `COUNT(*)` site enumerated below.
  - In sales mode (the default), each booking emits a base row + (sometimes) a `9991` booking-fee row + (sometimes) a `9992` cash-handling-fee row. `COUNT(*)` counts all of them. Avg Basket (`revenue / transactions`) is correspondingly suppressed. `revenuePerKiosk` and similar derived metrics are distorted.
  - User impact: every dashboard reporting "Transactions" in sales mode is overstating by ~2× (booking-fee only) or ~3× (booking + cash-handling). Avg Basket is understated by the inverse factor.
  - Fix: define "Transactions" canonically (e.g. `COUNT(DISTINCT (region_id, ref_no)) FILTER (WHERE NOT <fee>)` in sales mode) or apply `buildNonFeeCondition()` consistently.

- **[Cross-cutting] Reversal rows inflate every COUNT(*) across the codebase**
  - File: schema-wide; no central helper. Schema docstring `src/db/schema.ts:638-639` documents the convention.
  - `sales_records` has no `is_reversal` column. Reversals appear as opposite-signed rows sharing `(saleRef, refNo, transactionDate)` with the original. `SUM(net_amount)` correctly nets to zero; `COUNT(*)` counts both legs.
  - User impact: a heavily-refunded period shows inflated transaction counts; revenue self-zeros (correct); avg basket dragged down (incorrect).
  - Fix: introduce `buildNonReversalCondition()` (e.g. via refNo suffix detection), apply alongside `buildNonFeeCondition()` to all "transaction" KPIs.

- **[Cross-cutting] CSV parser sets `isBookingFee` only on exact-string `"Booking Fee"`**
  - File: `src/lib/csv/sales-csv.ts:179`
  - Variants `"booking fee"`, `"BOOKING FEE"`, `"Booking  Fee"` (double space), typos like `"Booking Fees"` are NOT flagged. Cash-handling fee is intentionally never flagged (relies on `netsuite_code='9992'`). The OR in `buildIsFeeCondition` masks most of this — but data integrity between `is_booking_fee` and `netsuite_code` cannot be assumed.
  - User impact: per-flag debugging produces inconsistent results. `SELECT product_name FROM sales_records WHERE netsuite_code='9991' AND is_booking_fee=false` is liable to return rows.
  - Fix: case-insensitive whitespace-collapsing comparison: `productName.replace(/\s+/g, ' ').trim().toLowerCase() === 'booking fee'`.

- **[Cross-cutting / Regions / Hotel Groups / Location Groups] Membership tables permit multi-membership; queries treat membership as 1:1**
  - Files: `regions.ts:66-72, 184-191, 206-227`, `hotel-groups.ts:62-66, 201-217`, `location-groups.ts:65-69, 142-150`.
  - Composite PKs allow multiple `(location, dimension_a)` and `(location, dimension_b)` rows. INNER JOINs on membership tables fan out by membership count. Manifests as: cross-row inflation in lists, multi-select KPI inflation, and breakdown-table inflation.
  - User impact: SUM-of-region-cards > portfolio total. Selecting two regions/groups that share a location double-counts. Hotel-group breakdown within a region inflates revenue across rows.
  - Fix: introduce canonical resolvers (mirror `canonicalHotelGroupNameFragment` for region and location-group), or pre-aggregate by location via CTE and join afterwards.

### Portfolio dashboard

- **[Portfolio / KPI Strip] "Transactions" double-counts every fee row and every reversal**
  - File: `src/lib/analytics/queries/portfolio.ts:111`
  - `COUNT(*)` over all rows passing `buildPortfolioWhere`. A typical UK booking with both 9991 and 9992 produces 3 rows. A fully-refunded booking with both fees produces 4 rows. Avg Basket inherits the inflated denominator.

- **[Portfolio / Daily Trends] Same Transactions double-counting**
  - File: `src/lib/analytics/queries/portfolio.ts:287`
  - Right-axis transactions line is `COUNT(*)`. The shape vs the revenue line is distorted (refund-heavy days show the lines diverging).

- **[Portfolio / Outlet Tiers] Maturity badge uses `new Date()` (today), not `filters.dateTo`**
  - File: `src/app/(app)/analytics/portfolio/outlet-tiers.tsx:91-93` → `src/lib/analytics/maturity.ts:13`
  - Commit `f374da7` fixed the SQL filter; the UI badge fell out of scope. Viewing a March 2025 historical window in April 2026 labels every outlet by its age as of today.
  - Fix: thread `filters.dateTo` to the component, pass to `calculateMaturityBucket(date, new Date(filters.dateTo))`.

- **[Portfolio / Outlet Tiers] Transactions column double-counts fees and refunds**
  - File: `src/lib/analytics/queries/portfolio.ts:371`
  - Same root cause as KPI strip; here it's exposed next to "Total Revenue" on the same row, encouraging the user to mentally compute `Avg / Txn` from these two columns — which is wrong.

- **[Portfolio / High Performer / Low Performer Patterns] Top-products sub-query excludes Booking Fee but NOT Cash Handling Fee**
  - File: `src/lib/analytics/queries/high-performer-analysis.ts:194`
  - Hand-rolled `AND ${salesRecords.isBookingFee} = false` instead of `buildNonFeeCondition()`. Cash Handling Fee will appear in "Top Products (Green-Tier Locations)" and "Top Products (Red-Tier Locations)".

- **[Portfolio / Category Performance] Card is mislabelled — groups by `products.name`, not `products.category_name`**
  - File: `src/lib/analytics/queries/portfolio.ts:149, 156`
  - `products` has a real `categoryName` column denormalised from NetSuite (`schema.ts:353`). The query ignores it. Card description says "by product category" but the bars are per-product.
  - Fix: use `products.category_name` or rename the card.

- **[Portfolio / Category Performance] Booking Fee / Cash Handling Fee dominate as top "categories" in sales mode**
  - File: `src/lib/analytics/queries/portfolio.ts:139`
  - No `buildNonFeeCondition` is applied. In a typical UK feed, those two pseudo-products dominate the bar chart by revenue.

- **[Portfolio / Hourly Distribution] No timezone awareness on `EXTRACT(HOUR FROM transaction_time)`**
  - File: `src/lib/analytics/queries/portfolio.ts:317`
  - `transaction_time` is `time` (no zone). For an Australian feed delivering UTC times, a peak that locally happens at 18:00 lands in the 07:00 bin (off by 11h). Even within UK, BST/GMT changes blend hours.

### Maturity Analysis dashboard

- **[Maturity / Section B Ramp Curve] Survivor bias: not a true cohort view**
  - File: `src/lib/analytics/queries/maturity-analysis.ts:147-152`
  - `avg_revenue` per `monthsSinceInstall` divides by "distinct locations seen in that bucket". A kiosk live for 6+ months contributes to every months_since 0..6 bucket; a kiosk that died after month 1 contributes only to bucket 0. Denominator differs per bucket — early buckets oversample short-lived kiosks, later buckets only include long-survivors. The chart title implies cohort progression; the SQL gives a population view conflated with attrition.

- **[Maturity / Section C Install Cohorts] "Avg Monthly metric" is NOT monthly**
  - File: `src/lib/analytics/queries/maturity-analysis.ts:198-207`
  - Column header says "Avg Monthly metric"; SQL is `SUM(net_amount) / COUNT(DISTINCT location_id)` with no division by month count. With a 12-month window the displayed value is 12× the truth.
  - Fix: divide by months_in_window, or rename the column.

### Heat Map dashboard

- **[Heat Map / Top 20 / Bottom 20] Min-max normalisation collapses to "everyone gets ~3" when one outlet dominates**
  - File: `src/lib/analytics/queries/heat-map.ts:96-102, 217-237`
  - With a power-law revenue distribution and one flagship outlier, every other outlet's normalised revenue lands in the bottom decile. The composite then ranks the outlier #1 and discriminates poorly between everyone else.
  - Fix: winsorise outliers, log-scale, or use percentile rank.

- **[Heat Map / Top 20 / Bottom 20] Composite score's "transactions" component inflated by fee rows in sales mode**
  - File: `src/lib/analytics/queries/heat-map.ts:144-146`
  - 20% default weight on `transactions`. Fee rows make outlets with high fee mix bubble up the rankings. Toggling to revenue mode produces different rankings.

- **[Heat Map / All Hotels] Archived locations are NOT excluded**
  - File: `src/lib/analytics/active-locations.ts:60-67`
  - Soft-deleted locations continue to render as live rows in "All Hotels".

### Regions / Hotel Groups / Location Groups dashboards

- **[Regions / Selector + Metrics] Multi-select double-counts revenue when any location is in multiple selected regions**
  - File: `src/lib/analytics/queries/regions.ts:152-158, 248-254`
  - INNER JOIN on `location_region_memberships` fans rows by membership. Two-region selection of a multi-region location → revenue and transaction count doubled. KPI strip reads 2× what Portfolio reads for the same range.

- **[Regions / Hotel Groups in Region] Membership double-counts revenue across hotel groups**
  - File: `src/lib/analytics/queries/regions.ts:184-191`
  - Locations in {Group A, Group B} contribute full revenue to both group rows. SUM-of-rows > region total.

- **[Regions / Hotel Groups in Region] `hotel_count` cross-row sum > distinct hotels in region**
  - File: `src/lib/analytics/queries/regions.ts:182`
  - Same fan-out as above — summing the column across the breakdown does not match the region's distinct hotel count.

- **[Regions / Location Groups in Region] `SUM(locations.num_rooms)` over a sales-records JOIN multiplies by transaction count**
  - File: `src/lib/analytics/queries/regions.ts:218`
  - One row per `sales_records` row post-join. A 100-room hotel with 5,000 transactions yields `total_rooms = 500,000`. Numbers are unusable.

- **[Regions / Location Groups in Region] Membership double-counting carries through**
  - File: `src/lib/analytics/queries/regions.ts:206-227`
  - Locations in multiple location groups contribute revenue to each group row.

- **[Hotel Groups / Selector + Metrics] Multi-selecting hotel groups double-counts shared locations**
  - File: `src/lib/analytics/queries/hotel-groups.ts:124-137, 201-217`
  - Identical fan-out. Even single-select inflates if a location's membership row is duplicated (composite PK prevents this today, but no defensive layer exists).

- **[Hotel Groups / Selector] `hotel_count` is not stable under `metricMode` toggle**
  - File: `src/lib/analytics/queries/hotel-groups.ts:114-137, 209`
  - Sales mode counts hotels with any sale; revenue mode counts only hotels with at least one fee row. Toggling Sales↔Revenue moves the number even though group composition didn't change.

- **[Hotel Groups / Daily Trends] Multi-group selection double-counts daily revenue**
  - File: `src/lib/analytics/queries/hotel-groups.ts:265-278`
  - Same membership fan-out at the date-bucket level.

- **[Location Groups / Selector] `SUM(DISTINCT locations.num_rooms)` is mathematically wrong**
  - File: `src/lib/analytics/queries/location-groups.ts:95, 146`
  - `SUM(DISTINCT)` deduplicates by VALUE, not row. Two hotels both 100 rooms → `total_rooms = 100`, not 200. Bounded by the cardinality of distinct `num_rooms` values across the group.

- **[Location Groups / Selector + Metrics] Membership double-counting**
  - File: `src/lib/analytics/queries/location-groups.ts:65-69, 80-101, 142-150`
  - Locations in multiple location groups contribute revenue to each.

- **[Location Groups / KPI strip] `total_rooms` bug carries through to the KPI card**
  - File: `src/lib/analytics/queries/location-groups.ts:146`, render `location-metrics.tsx:50-54`
  - Displays the `SUM(DISTINCT)` value directly.

- **[Location Groups / Capacity Metrics] All "per room" metrics multiplied by an unknown factor**
  - File: `src/lib/analytics/queries/location-groups.ts:146, 159-160`
  - `revenuePerRoom = revenue / wrong_total_rooms`. In a homogeneous group (all hotels same size), Rev/Room is multiplied by N hotels.

- **[Location Groups / Capacity Metrics] Capacity numerator vs denominator timestamp mismatch**
  - File: `src/lib/analytics/queries/location-groups.ts:159-161`; ubiquitous
  - Numerator is "revenue over historical period"; denominator is current `num_rooms` read at query time. A 50-room → 100-room hotel has 2024 revenue understated 2×. Same defect for `kioskAssignments` ("active right now" vs "active during window").

- **[Location Groups / Capacity Metrics] `txnPerKiosk` always null**
  - File: `src/lib/analytics/queries/location-groups.ts:147, 161`
  - `total_kiosks` hard-coded NULL.

- **[Location Groups / Peer Analysis] Peer cohort is "all location groups", not "groups of same `location_type`"**
  - File: `src/lib/analytics/queries/location-groups.ts:164-189`
  - Compares Airport-only vs Hotel-only vs Retail Desk groups indiscriminately. Location Groups have no single `location_type` so the peer set is structurally awkward.

- **[Location Groups / Peer Analysis] Percentiles inherit membership double-count and `SUM(DISTINCT num_rooms)` bug**
  - File: `src/lib/analytics/queries/location-groups.ts:165-168`
  - Computing percentile against a contaminated cohort propagates the error.

### Compare / Pivot Table / Trend Builder

- **[Pivot Table / Engine] References columns dropped in migration 0022**
  - File: `src/lib/analytics/pivot-engine.ts:38-50`
  - `ALLOWED_COLUMNS` references `gross_amount`, `quantity`, `booking_fee`, `sale_commission`, `discount_amount` (all dropped from `sales_records`) and `region` (dropped from `locations`).
  - The field list (`pivot-store.ts:12-25`) still exposes all of these to the user. Every pivot run that selects any of these fails at the database with Postgres error 42703 ("column does not exist"). Since values zone requires a metric (toolbar:17) and all three exposed metrics map to dropped columns, the pivot table is broken end-to-end in production.
  - Unit tests `pivot-engine.test.ts` still reference `gross_amount` and pass because they assert string composition only.
  - Fix: replace `gross_amount → net_amount`; remove `quantity`; replace `booking_fee` with `CASE WHEN is_booking_fee THEN net_amount ELSE 0 END`; drop `sale_commission`, `discount_amount`; replace `region` dimension with a join via `regions.name`.

- **[Pivot Table] `hotel_group` and `location_group` map to deprecated free-text columns**
  - File: `src/lib/analytics/pivot-engine.ts:42-44`
  - `locations.hotel_group` and `locations.location_group` are NOT authoritative (schema comment line 466-472). Other dashboards use the membership tables. Pivoting by `hotel_group` produces rows that don't match Compare / Heat Map.

- **[Trend Builder] Ignores the global analytics filter bar entirely**
  - File: `src/app/(app)/analytics/trend-builder/page.tsx:39-46`, `trend-series.ts:96-138`
  - Reads only `dateRange` and `locationGroupFilter` (latter for weather gating). `hotelIds`, `regionIds`, `productIds`, `hotelGroupIds`, `metricMode`, `locationTypes`, `maturityBuckets` are not propagated. The page does not mount a FilterBar.
  - User impact: an analyst sets `metricMode=revenue + regionIds=[GB,IE]` on Portfolio, navigates to Trend Builder, and the chart silently renders ALL regions, ALL outlets, ALL products, ALL fees.

- **[Trend Builder / Avg Basket] Bucketing computes SUM of daily averages, not weighted average**
  - File: `src/app/(app)/analytics/trend-builder/trend-chart.tsx:55-67`, `trend-series.ts:84`
  - `mergeSeriesData` sums daily values when bucketing weekly/monthly. For `avg_basket_value`, summing 7 daily averages does NOT equal the weekly average. A weekly avg-basket trend can be 7× higher than truth; monthly is ~30×.
  - Fix: change SQL to return `(numerator, denominator)` per day; sum both during bucketing; divide at render time.

### Commission

- **[Commission / KPIs + By Location + By Product + Monthly] Reversal double-counting**
  - File: `src/app/(app)/analytics/commission/actions.ts:97-104, 174, 213, 249`; `src/lib/commission/processor.ts:339-356`
  - `triggerRecalculation` inserts a reversal row with `commissionAmount = -original` but `commissionableAmount = +original` (unchanged), then inserts a fresh `is_reversal=false` row. The dashboard filter `is_reversal=false` excludes the negative reversal entirely, so total commission, total commissionable, and recordCount are all overstated by the original amount on every recalc.
  - User impact: financial misrepresentation that affects month-end reporting. Anyone who runs a recalc inflates commissionable revenue and record counts without realising it.
  - Fix: either delete the original row on recalc, or net the reversal (sign-aware sum without `is_reversal=false` filter), or insert reversal with negative commissionable too.

- **[Commission / All sections] Commission queries do NOT apply `scopedSalesCondition`**
  - File: `src/app/(app)/analytics/commission/actions.ts:70-82`
  - No call to `scopedSalesCondition`. A regional manager scoped to UK sees commission across the entire portfolio.
  - User impact: data leak. Commission numbers are commercially sensitive (they leak WKG's revenue from competitors' hotel groups).

### Experiments

- **[Experiments / Temporal Analysis] Ignores all global filters except `dateFrom`/`dateTo`**
  - File: `src/lib/analytics/queries/experiments.ts:262-265`
  - `getCohortMetrics` is called with a NEW filters object containing only date strings. `metricMode`, `maturityBuckets`, `productIds`, `hotelGroupIds`, `regionIds`, `locationGroupIds`, `locationTypes` are all dropped.
  - User impact: with revenue mode active globally, the Cohort vs Control cards correctly use revenue mode but the Temporal Analysis cards use ALL transactions including hotel sales — different denominator, looks ~10× larger. Same effect with productIds, etc.

- **[Experiments / Cohort vs Control] Delta is RAW (not per-location); `rest_of_portfolio` makes it meaningless**
  - File: `src/app/(app)/analytics/experiments/actions.ts:198-203`
  - `delta.revenue = cohort.revenue - control.revenue`. With `rest_of_portfolio`, control may be 1000+ locations vs a 5-location cohort — delta is dominated by absolute scale, displayed as a giant red number with no normalisation.
  - Fix: divide both by `numLocations` to get revenue-per-location, or by `numKiosks`.

---

## P1 — Likely misrepresentation in common cases

### Cross-cutting

- **[Cross-cutting] `locationTypes` filter silently excludes NULL `location_type`**
  - File: `src/lib/analytics/queries/shared.ts:97-107`
  - Schema explicitly allows NULL ("not yet categorised"). When user picks any combination of types, all unmapped locations vanish. Even "select all" excludes NULL.

- **[Cross-cutting] YoY leap-year wrap-around bug in `getComparisonDates`**
  - File: `src/lib/analytics/metrics.ts:35-44`
  - `setFullYear(year - 1)` rolls Feb 29 → Mar 1. Affects every YoY comparison card and YoY change indicator.

- **[Cross-cutting] `canonicalHotelGroupNameFragment` tie-breaks by UUID lexicographic order**
  - File: `src/lib/analytics/queries/shared.ts:187-200`
  - Properties in multiple groups (no `operating_group_id`) get a deterministic but human-arbitrary label. Two analysts may see the same hotel under different groups.
  - Fix: order by `hotel_groups.name` or `created_at`.

- **[Cross-cutting] URL filter values are unvalidated**
  - File: `src/lib/stores/analytics-filter-store.ts:225-227`
  - Only `locationTypeFilter` is whitelisted. Crafted URLs with invalid UUIDs throw a Postgres `invalid input syntax for type uuid` error and the dashboard shows a generic error toast.

- **[Cross-cutting] `maturityFilter` from URL is unbounded**
  - File: `src/lib/analytics/queries/shared.ts:131-156`
  - `switch` falls through silently on unknown values. A typo `?maturity=00-1mo` yields no condition (no filter), not an error. User thinks they filtered; they did not.

- **[Cross-cutting] `outlet_exclusions` is not region-scoped**
  - File: `src/db/schema.ts:758`
  - `outletCode` is unique per `(primaryRegionId, outletCode)`, but `outlet_exclusions.outletCode` is free-text. An exclusion rule for `"Q5"` matches every region's `Q5`. With AU region added (PR #26), this is a real risk.

- **[Cross-cutting] `userScopes` re-read on every analytics call**
  - File: `src/lib/scoping/scoped-query.ts`
  - No caching. Hidden N+1 for users with many scopes.

- **[Cross-cutting] Cache wrapper bypasses caller `userCtx` and uses admin context**
  - File: `src/lib/analytics/cached-query.ts:73-95`
  - For internal admins this is a no-op; for any future scoped-internal user it would silently return unscoped data from the shared cache.

- **[Cross-cutting] Membership tables have no time-bound validity (no SCD-2)**
  - File: `src/db/schema.ts:526-575`
  - A location moved between hotel groups mid-period silently re-attributes ALL revenue to the new group. No `valid_from`/`valid_to` columns.

- **[Cross-cutting] No FilterBar mounted on Pivot Table or Trend Builder**
  - File: `src/app/(app)/analytics/pivot-table/page.tsx`, `trend-builder/page.tsx`
  - Users cannot see or change filters on these pages. Pivot uses an independent store; Trend Builder ignores most global state.

- **[Cross-cutting] `transactionDate` is `date`, not `timestamptz`; cross-region bucketing depends on ETL**
  - File: `src/db/schema.ts:651`
  - Day-bucketing collapses time-of-day. Multi-region group totals can show "spikes" that are timezone-bucketing artefacts.

### Portfolio

- **[Portfolio / KPI Strip] `uniqueProducts` counts fee rows as distinct products**
  - File: `src/lib/analytics/queries/portfolio.ts:113`
  - Booking Fee and Cash Handling Fee are products. In sales mode the count includes them.

- **[Portfolio / KPI Strip] `uniqueOutlets` counts only outlets that transacted in the window, not active outlets**
  - File: `src/lib/analytics/queries/portfolio.ts:114`
  - Label implies portfolio size; the value is "outlets that recorded ≥1 row this period".

- **[Portfolio / Threshold Editor] Threshold values persisted to localStorage but used in a server action**
  - File: `src/app/(app)/analytics/portfolio/threshold-editor.tsx`
  - Two analysts viewing the same dashboard see different "Green tier" definitions. Not URL-shareable, not stamped in audit logs.

- **[Portfolio / Threshold Editor] Red and Green cards use the same label "Avg Sales/Room"** but compute over disjoint outlet sets. Comparing the two values is invalid.

- **[Portfolio / High Performer / Low Performer] Tier ranking ignores fee rows in revenue mode but not in sales mode**
  - File: `src/lib/analytics/queries/location-revenues.ts`
  - Sales mode includes fee rows in tier-ranking revenue.

- **[Portfolio / High Performer / Low Performer] `avgRevenuePerRoom` formula differs from Outlet Tiers**
  - File: `src/lib/analytics/queries/high-performer-analysis.ts:218-226` vs `portfolio.ts:407-408`
  - Performer card uses weighted (`SUM(rev where rooms>0)/SUM(rooms)`); Outlet Tiers uses per-row `revenue/numRooms`. Cross-card comparisons disagree.

- **[Portfolio / High Performer / Low Performer] Region distribution percentages can sum to >100%**
  - File: `src/lib/analytics/queries/high-performer-analysis.ts:158-166`
  - Multi-region locations counted in each of their regions.

- **[Portfolio / High Performer / Low Performer] `avgKioskCount` excludes tier locations with zero active kiosks**
  - File: `src/lib/analytics/queries/high-performer-analysis.ts:169-181`
  - Inflates the displayed avg.

- **[Portfolio / Daily Trends] Date-string parsing is timezone-sensitive**
  - File: `src/app/(app)/analytics/portfolio/daily-trends.tsx:39-43`
  - `new Date("2026-04-25")` is UTC midnight. Negative-offset timezones see X-axis labels off by one day.

- **[Portfolio / Daily Trends] Business events are not scoped to the user's view**
  - File: `src/lib/analytics/queries/trend-series.ts:142`
  - A UK analyst sees Australian event annotations.

- **[Portfolio / Daily Trends] Empty days are not interpolated**
  - File: `src/app/(app)/analytics/portfolio/daily-trends.tsx`
  - Recharts straight-lines across the gap, masking real "everyone closed" days.

- **[Portfolio / Category Performance] `quantity` field is identical to `transactions`**
  - File: `src/lib/analytics/queries/portfolio.ts:151-152`
  - Both are `COUNT(*)::text`. The `sales_records.quantity` column was dropped in 0022.

- **[Portfolio / Category Performance] `avg_value` is per-row average, not avg basket**
  - File: `src/lib/analytics/queries/portfolio.ts:153`
  - `AVG(net_amount)` includes fee rows (£1.50-£3) and reversal rows (negative). Not basket value.

- **[Portfolio / Top Products] "Quantity" column is `COUNT(*)`, identical to "Transactions"**
  - File: `src/lib/analytics/queries/portfolio.ts:212, 253`

- **[Portfolio / Top Products] Revenue-mode parent-detection assumes the suffix is always `-b`**
  - File: `src/lib/analytics/queries/portfolio.ts:218`
  - `REGEXP_REPLACE(ref_no, '-b$', '')`. Other suffix variants (`-h`, `-b-h`) drop the fee from revenue mode entirely.

- **[Portfolio / Top Products] Revenue-mode "transactions" column counts fee rows, not parent transactions**
  - File: `src/lib/analytics/queries/portfolio.ts:212`

- **[Portfolio / Hourly Distribution] Transaction count includes fee + refund rows**
  - File: `src/lib/analytics/queries/portfolio.ts:319`
  - On the wire even though the chart only shows revenue.

- **[Portfolio / Outlet Tiers] `live_date` is `MIN(kiosk_assignments.assigned_at)`, not `locations.live_date`**
  - File: `src/lib/analytics/queries/shared.ts:117`
  - Disagrees with the column an admin can edit.

- **[Portfolio / Outlet Tiers] `revenuePerKiosk` uses CURRENT active kiosk count for HISTORICAL revenue**
  - File: `src/lib/analytics/queries/shared.ts:207-214`
  - Q1 revenue divided by today's kiosk count → inflated number.

- **[Portfolio / Outlet Tiers] Hotel group resolution is region-blind (UUID tie-break)**
  - File: `src/lib/analytics/queries/shared.ts:197`

- **[Portfolio / Outlet Tiers] `LIMIT 200` silently truncates large portfolios**
  - File: `src/lib/analytics/queries/portfolio.ts:376`
  - No "showing top 200 of N" indicator.

- **[Portfolio / Outlet Tiers] `revenuePerKiosk` and `revenuePerRoom` silently change meaning under metricMode toggle**
  - File: `src/lib/analytics/queries/portfolio.ts:399-425`
  - Sales mode = "all-row revenue per kiosk"; revenue mode = "fee revenue per kiosk".

- **[Portfolio / Flags Drawer] Drawer is filter-blind**
  - File: `src/app/(app)/analytics/flags/actions.ts:52`
  - A regional manager filtered to UK still sees Australian flags.

- **[Portfolio / Flags Drawer] "Raised by" displays snapshot, not live join**
  - File: `src/app/(app)/analytics/flags/actions.ts:31`
  - Lags display-name changes.

### Maturity Analysis

- **[Maturity / Section A] Bucket boundaries differ from the global maturity filter**
  - File: `src/lib/analytics/maturity.ts:1-43`
  - Buckets here are days (0-30/31-60/61-90/90+); filter chip uses months. Setting `0-1mo` globally and viewing this dashboard shows three apparently empty buckets.

- **[Maturity / Section A] Negative-day kiosks bucketed as `0-30d`**
  - File: `src/lib/analytics/queries/maturity-analysis.ts:88-93`
  - CASE ladder uses `<= 30` with no lower bound. `kioskLiveDate > dateTo` produces a negative number which falls into 0-30d.

- **[Maturity / Section B] Last bucket (`months_since=6`) silently aggregates months 6..N**
  - File: `src/lib/analytics/queries/maturity-analysis.ts:147-150`
  - Y-axis tooltip says "Month 6 (and beyond)" but does not normalise.

- **[Maturity / Section B] `kioskLiveDateSubquery IS NOT NULL` excludes locations with `locations.live_date` set but no assignment row**
  - File: `src/lib/analytics/queries/shared.ts:117`

- **[Maturity / Section C] Cohorts whose install month is outside the window still appear if they have transactions in-window**
  - File: `src/lib/analytics/queries/maturity-analysis.ts:194-207`

- **[Maturity / Section D Plateau] Compares 31-60d (30-day window) against 90+d (unbounded window)**
  - File: `src/app/(app)/analytics/maturity/page.tsx:28-75`, `src/lib/analytics/queries/maturity-analysis.ts:88-101`
  - Not comparable. The "plateau" label is meaningless for any window > 60 days.

- **[Maturity / Section D Plateau] Division by negative `avg3160` not handled**
  - File: `src/app/(app)/analytics/maturity/page.tsx:50-58`
  - Reversal-dominated tiny cohort flips the verdict.

- **[Maturity / Section D Plateau] ±10% threshold is arbitrary and undocumented**
  - File: `src/app/(app)/analytics/maturity/page.tsx:59-74`
  - 9.9% reads "plateaus", 10.1% reads "continues to grow".

### Heat Map

- **[Heat Map / Top 20] Reversal rows inflate transactions count**
  - File: `src/lib/analytics/queries/heat-map.ts:144-146`

- **[Heat Map / Top 20] Maturity badge anchored to `new Date()`, not `filters.dateTo`**
  - File: `src/app/(app)/analytics/heat-map/performance-table.tsx:114-117`
  - Same bug as Outlet Tiers.

- **[Heat Map / Top 20] `kioskCount` in table is "active right now"; `txnPerKiosk` (scoring) uses a window-scoped count**
  - File: `src/lib/analytics/queries/heat-map.ts:118-123, 143, 191, 195, 198`
  - Two divisions in adjacent columns of the same row use different denominators.

- **[Heat Map / Bottom 20] When `allPerformers.length ∈ [21..39]`, top 20 and bottom 20 overlap**
  - File: `src/lib/analytics/queries/heat-map.ts:286-293`
  - Up to 19 outlets appear in both tables. No warning.

- **[Heat Map / All Hotels] Excludes outlets with no transactions in the window**
  - File: `src/lib/analytics/queries/heat-map.ts:135-151`
  - "All Hotels" is "All Hotels with sales activity in the window".

### Regions / Hotel Groups / Location Groups

- **[Regions / Selector] Selector counts ignore all dashboard filters**
  - File: `src/lib/analytics/queries/regions.ts:107-118`
  - Query 2 has no WHERE clause whatsoever. Counts are all-time. Detail panel uses period-active counts → two different definitions of "Hotel Group Count" on the same page.

- **[Regions / Cross-region multi-membership] Selector double-counts revenue across rows when a location is in two regions**
  - File: `src/lib/analytics/queries/regions.ts:66-72, 90-102`

- **[Regions / Hotel Groups in Region] `avgRevenuePerHotel` inherits double-count**
  - File: `src/lib/analytics/queries/regions.ts:201`

- **[Hotel Groups / Inconsistency] Uses `buildExclusionCondition`; Regions and Location Groups use `buildActiveLocationCondition`**
  - File: `src/lib/analytics/queries/hotel-groups.ts:42`
  - Functionally equivalent today but predicates can diverge.

- **[Hotel Groups / Hotels in Group] `quantity` is `COUNT(*)`, identical to transactions**
  - File: `src/lib/analytics/queries/hotel-groups.ts:236-237`

- **[Hotel Groups / Hotels in Group] `kiosks` is hard-coded NULL**
  - File: `src/lib/analytics/queries/hotel-groups.ts:239`
  - Column listed in the response shape, never populated.

- **[Hotel Groups / Hotels in Group] `revenuePerRoom` denominator is current `num_rooms`, not as-of-period**
  - File: `src/lib/analytics/queries/hotel-groups.ts:238, 260`

- **[Hotel Groups / Hotels in Group] Outlet code shown without region disambiguation**
  - File: `src/app/(app)/analytics/hotel-groups/hotel-list.tsx:50-54`
  - "Q5" exists in GB and DE; both rows render identical code with no region indicator.

- **[Hotel Groups / Daily Trends] Cross-region selections may bucket inconsistently because `transaction_date` is set per-region at ETL time**
  - File: `src/lib/analytics/queries/hotel-groups.ts:271`, `src/db/schema.ts:651`

- **[Location Groups / Selector] `total_kiosks` always NULL**
  - File: `src/lib/analytics/queries/location-groups.ts:96, 147`
  - `txnPerKiosk` and Total Kiosks cards forever display "—".

- **[Location Groups / Group Metrics] `hotel_count` shifts on metricMode toggle**
  - File: `src/lib/analytics/queries/location-groups.ts:145`

- **[Location Groups / Capacity Metrics] `kioskAssignments` requires temporal-validity choice not made**
  - File: `src/lib/analytics/queries/location-groups.ts:147`, `shared.ts:207-214`

- **[Location Groups / Peer Analysis] Self-inclusion in peer set**
  - File: `src/lib/analytics/metrics.ts:106-110` + `location-groups.ts:172-189`
  - Tiny peer sets (3 groups) yield P33/P67/P100.

- **[Location Groups / Peer Analysis] Tiny peer set produces meaningless percentiles**
  - File: `src/lib/analytics/metrics.ts:106-110`

- **[Location Groups / Peer Analysis] `locationType` filter excludes NULL-typed members silently**
  - File: `src/lib/analytics/queries/shared.ts:97-107`

- **[Location Groups / Hotels in Group] Multi-group selection with shared locations: row appears once but with double-counted revenue**
  - File: `src/lib/analytics/queries/location-groups.ts:215, 221-223`

### Compare / Pivot / Trend Builder

- **[Compare / Cards] Mixing-scale comparisons silently allowed**
  - File: `src/app/(app)/analytics/compare/comparison-cards.tsx:11-17`, `comparison.ts:84-207`
  - 5-day-old outlet vs 5-year-old outlet — `isBest` highlights whichever has the larger absolute number. No per-day, per-room, or per-kiosk normalisation.

- **[Compare / Cards] Avg Basket includes booking-fee rows in default sales mode**
  - File: `src/lib/analytics/queries/comparison.ts:101-107`, `shared.ts:51-53`
  - Two outlets with identical product sales but different fee mixes compare incorrectly.

- **[Compare / Cards] Reversal pairs double-count transactions**
  - File: `src/lib/analytics/queries/comparison.ts:102, 142, 186`

- **[Compare / Cards] Hotel-group / region comparisons fan out via membership join**
  - File: `src/lib/analytics/queries/comparison.ts:144-151, 188-193`
  - Multi-membership locations counted in every selected group/region.

- **[Compare / Cards] Avg Basket "best" misleading when scale differs by 100×**
  - File: `src/app/(app)/analytics/compare/comparison-cards.tsx:79-84`
  - Conflates product-mix with location performance.

- **[Pivot Table] `outlet_code` is no longer globally unique**
  - File: `src/lib/analytics/pivot-engine.ts:41`, `pivot-store.ts:14`
  - Migration 0022 dropped the global unique. Pivoting by outlet_code collides "Q5" GB with "Q5" DE.

- **[Pivot Table] COUNT default returns row count, not distinct anything**
  - File: `src/lib/analytics/pivot-engine.ts:81-87, 200`
  - No `count_distinct` option exposed.

- **[Pivot Table] Grand totals for AVG aggregation are unweighted means of bucket averages**
  - File: `src/lib/analytics/pivot-engine.ts:380-397`
  - Simpson's-paradox bait. A 1-transaction hotel weighted equally to a 1000-transaction hotel.

- **[Pivot Table] Comparison columns show only the % delta, not the comparison-period absolute value**
  - File: `src/lib/analytics/queries/pivot.ts:213-256`, `pivot-result-table.tsx:78-98`
  - Header-matching for `_change` columns uses positional fallback when key sets differ.

- **[Pivot Table] Pivot uses its own filter store, separate from the global analytics filter bar**
  - File: `src/lib/stores/analytics-filter-store.ts:162-163`, `pivot-table/page.tsx`
  - State never syncs. Pivot page renders no FilterBar.

- **[Pivot Table] WHERE clause built by string interpolation**
  - File: `src/lib/analytics/queries/pivot.ts:97-106`
  - Single-quote escaping only. Backslash, null bytes, smart quotes not normalised.

- **[Trend Builder / autoGranularity] Hardcoded 31/90 day cliffs**
  - File: `src/lib/analytics/formatters.ts:105-112`
  - 31 days = daily (31 points), 32 days = weekly (5 points). Sudden visual change.

- **[Trend Builder / weekly bucketing] `getISOWeekMonday` uses UTC math on TZ-naive date strings**
  - File: `src/lib/analytics/formatters.ts:114-121`
  - Weekly bucket boundaries shift by a day in some user timezones / DST conditions.

- **[Trend Builder / monthly bucketing] Partial first/last months silently grouped under same label**
  - File: `src/lib/analytics/formatters.ts:123-125`
  - Three monthly bars, two of which are partial, all rendered as full months.

- **[Trend Builder / YoY] `setFullYear(year - 1)` aliases Feb 29; weekday alignment shifts by a day**
  - File: `src/app/(app)/analytics/trend-builder/actions.ts:102-110`, `metrics.ts:30-46`

- **[Trend Builder / Rolling avg] `windowSize` is array indices, not calendar days**
  - File: `src/lib/analytics/rolling-average.ts:5-20`, `page.tsx:219-226`
  - "7d Avg" on weekly granularity is actually 7 weeks. Labels never adapt.

- **[Trend Builder / metric=booking_fee] Sums only `is_booking_fee=true` rows; ignores 9992**
  - File: `src/lib/analytics/queries/trend-series.ts:85-91`
  - Inconsistent with `buildIsFeeCondition` used everywhere else. Undercounts WKG fee revenue by the 9992 stream.

- **[Trend Builder / Series filters + locationIds] Archived selected locations silently filtered out by active-location predicate**
  - File: `src/lib/analytics/queries/trend-series.ts:42-43, 106-119`

- **[Trend Builder / Main chart] `connectNulls` true → invents data across gaps**
  - File: `src/app/(app)/analytics/trend-builder/trend-chart.tsx:245, 263`

- **[Trend Builder / Event annotations] Filtered by category only, NOT by series scope**
  - File: `src/app/(app)/analytics/trend-builder/event-annotations.tsx:20-22`
  - A Hilton-scoped event shows up on a Marriott-only series.

- **[Trend Builder / Event annotations] `ReferenceLine x={event.startDate}` doesn't match bucketed X-axis**
  - File: `src/app/(app)/analytics/trend-builder/event-annotations.tsx:30-67`, `trend-chart.tsx:151-164`
  - At weekly/monthly granularity the X-axis is categorical with bucket-Mondays / first-of-months; events on other dates render unpredictably.

- **[Trend Builder / Weather] Picks "first location with coordinates" — non-deterministic**
  - File: `src/app/(app)/analytics/trend-builder/actions.ts:59-73`
  - No `ORDER BY`. A multi-city group gets weather for whichever hotel the planner returned.

- **[Trend Builder / Weather] Group can span many cities — gate doesn't account for this**
  - File: `src/app/(app)/analytics/trend-builder/page.tsx:101-104`

### Commission

- **[Commission / By Location] No row limit; can render thousands of rows**
  - File: `src/app/(app)/analytics/commission/actions.ts:163-176`

- **[Commission / By Product] React row key is `productName`, not `productId`**
  - File: `src/app/(app)/analytics/commission/page.tsx:255`
  - Two products with the same name collide.

- **[Commission / Monthly Trend] Partial first/last month rendered as full month → spurious dips**
  - File: `src/app/(app)/analytics/commission/actions.ts:240-251`

- **[Commission / Cross-section] Inconsistent application of global filters**
  - Commission ignores `metricMode` and `maturityBuckets`. Experiments Temporal Analysis ignores `metricMode`, `maturityBuckets`, AND all dimension filters. Three dashboards on the same screen, three different filter contracts.

### Experiments

- **[Experiments / Cohort List] `listLocationsForPicker` ignores user scope and exclusions**
  - File: `src/app/(app)/analytics/experiments/actions.ts:78-87`
  - User can pick locations they cannot see or that are excluded; `getCohortMetrics` later silently drops them.

- **[Experiments / Cohort List] No deduplication when a location belongs to multiple cohorts**

- **[Experiments / Temporal Analysis] Pre/During hardcoded at 30 days, not user-configurable**
  - File: `src/lib/analytics/queries/experiments.ts:232-246`

- **[Experiments / Temporal Analysis] Date arithmetic uses `new Date(isoDate)` then `setDate(...)` then `toISOString()`**
  - File: `src/lib/analytics/queries/experiments.ts:230, 233, 235, 239, 240`
  - UTC-based on a JS Date; can shift by a day in local-TZ deploys. Compare to existing `toLocalISODate` helper which is not used here.

- **[Experiments / Temporal Analysis] During period extends 30 days into the FUTURE**
  - File: `src/lib/analytics/queries/experiments.ts:239-241`
  - `interventionDate = today` → duringTo in the future → returns 0 rows → "−100% change" panic.

- **[Experiments / Temporal Analysis] During vs Pre assumed equal length, but During can be partial**
  - Same file. `revChange` raw without partial-window flagging.

- **[Experiments / Cohort vs Control] `named_control` with empty `controlLocationIds` returns zero everything**
  - File: `src/lib/analytics/queries/experiments.ts:32-34`
  - Cohort form doesn't enforce ≥1 control. Delta = cohort - 0 = cohort, displayed as a giant green number.

- **[Experiments / Cohort vs Control] Cohort/control overlap silently allowed**
  - File: `src/app/(app)/analytics/experiments/actions.ts:186-196`

- **[Experiments / Cohort vs Control] `rest_of_portfolio` doesn't honour user scope shape correctly**
  - File: `src/lib/analytics/queries/experiments.ts:80-131`

### Actions Dashboard

- **[Actions / Cross-section] `flag → action` workflow is broken**
  - File: `src/components/analytics/flag-dialog.tsx:117-127`, `flags/actions.ts:85-117`
  - "Create Action Instead" passes `sourceType="flag"` but no `sourceId` (because the flag was never created). `createFlag` does not create an action item. Flagged outlets pile up in `location_flags` with no triage queue.

- **[Actions / Table] `listActionItems` re-runs full query inside `createActionItem` and `updateActionItemStatus`**
  - File: `src/app/(app)/analytics/actions-dashboard/actions.ts:148-149, 212-213`

- **[Actions / Table] Overdue items not surfaced as overdue**
  - File: `src/app/(app)/analytics/actions-dashboard/page.tsx:226-228`

- **[Actions / Table] Items with `locationId IS NULL` always visible regardless of location filter** (semantic ambiguity once a filter is added).

- **[Actions / Table] Order is `createdAt ASC` (oldest first)** — counterintuitive default.

- **[Actions / Table] `resolvedAt` stored but never displayed**
  - File: `src/db/schema.ts:922`

- **[Actions / Cross-section] Cohort form picker exposes locations the user cannot see (or excluded)** — same root as Experiments Cohort List P1.

---

## P2 — Subtle / edge case

- **[Cross-cutting / `buildDateCondition`] No validation that `dateFrom <= dateTo`** — silent zero-row queries on swapped bounds (`shared.ts:32-34`).

- **[Cross-cutting / `buildIsFeeCondition`] Magic-string duplication** — codes hard-coded; `FEE_NETSUITE_CODES` is exported but unused inside SQL (`shared.ts:46, 58`).

- **[Cross-cutting / `buildMetricModeCondition`] No type-narrowing on `metricMode`** — stale client passing `"foo"` silently falls back to sales mode (`shared.ts:51-53`).

- **[Cross-cutting / `buildMaturityCondition`] Unbounded "0-1mo" bucket** — future-dated assignments still match (`shared.ts:131-156`).

- **[Cross-cutting / `buildMaturityCondition`] Bucket-string typed as `string[]`; switch falls through silently** — typo in URL → no condition (`shared.ts:131-156`).

- **[Cross-cutting / `getActiveLocationIds`] `React.cache` per-request — admin's "add exclusion → see updated metrics" flow may show stale data on a page that batches multiple analytics calls.

- **[Cross-cutting / `getActiveLocationIds`] `sql\`FALSE\`` empty-state semantics differ from `undefined`** — when exclusions match every location, every dashboard returns 0 rows with no diagnostic surface.

- **[Cross-cutting / Scope] Conflicting cross-dimension scopes are OR'd, not AND'd** — admins may expect AND (`scoped-query.ts`).

- **[Cross-cutting / Comparisons] Different month lengths bias raw totals in MoM** — labels say "previous period" without indicating "shifted by 28 days, not previous calendar month" (`metrics.ts:13-26`).

- **[Cross-cutting / `classifyTrafficLight`] Boundary `revenue === redMax === 0` → red; symmetric for green** — both inclusive, intuition expects exclusive `<` for red (`thresholds.ts:8-15`).

- **[Cross-cutting / Filter store] Pivot store and main store both initialise to YTD; users land on Pivot to find their dashboard filters reset** (`analytics-filter-store.ts`).

- **[Cross-cutting / CSV parser] `parseDate` interprets 2-digit year always as `20YY`** — future risk for legacy data (`sales-csv.ts`).

- **[Cross-cutting / CSV parser] `currency = "GBP"` default when missing** — multi-region CSVs without currency column silently coerce to GBP.

- **[Cross-cutting / CSV parser] Header canonicalisation strips `_` and ` ` but not `-`** — `OUTLET-CODE` is not recognised.

- **[Portfolio / KPI Strip] `avgBasketValue=0` when transactions=0 instead of null** — `portfolio.ts:127` disagrees with `metrics.ts:87-92`.

- **[Portfolio / KPI Strip] YoY date shift naive `setFullYear(-1)`** — leap-day windows shift wrong (`metrics.ts:35-43`).

- **[Portfolio / Threshold Editor] Initial render uses store defaults before localStorage hydrates** — two server round-trips per page load.

- **[Portfolio / High Performer / Low Performer] `avgRoomCount` silently drops outlets with NULL `num_rooms`** (`high-performer-analysis.ts:213`).

- **[Portfolio / High Performer / Low Performer] `avgRevenuePerRoom` aggregator silently excludes tier members with NULL or zero rooms** (`high-performer-analysis.ts:218-220`).

- **[Portfolio / High Performer / Low Performer] `clampCutoff` allows 0 to mean "empty tier"** (`high-performer-analysis.ts:60`).

- **[Portfolio / Low Performer] `count === 0` insight string is misleading** — "No locations currently qualify as bottom performers" sounds like good news but means data is missing (`high-performer-analysis.ts:142`).

- **[Portfolio / Daily Trends] Revenue line colour hard-coded `#00A6D3`** — same colour in revenue and sales mode despite definition flip.

- **[Portfolio / Top Products] Sales mode `transactions` includes refund rows** — non-fee predicate doesn't filter reversals (`portfolio.ts:239-259`).

- **[Portfolio / Top Products] `categoryName` in result is `productName`** — same misuse as Category Performance (`portfolio.ts:233, 264`).

- **[Portfolio / Hourly Distribution] NULL `transaction_time` rows silently dropped from revenue chart** (`portfolio.ts:308-309`).

- **[Portfolio / Hourly Distribution] Hours with zero rows not rendered** — distorts daily curve shape.

- **[Portfolio / Outlet Tiers] Traffic-light pill and Tier badge can disagree** — percentile-based vs absolute-£-based (`outlet-tiers.tsx:125-152`).

- **[Portfolio / Outlet Tiers] Percentile calc breaks ties non-deterministically** (`portfolio.ts:428-437`).

- **[Portfolio / Flags Drawer] Cache TTL is 24h** — flag state can lag without other tag invalidations (`flags/actions.ts:68`).

- **[Portfolio / Flags Drawer] Flag count doesn't change without page reload** — no live polling.

- **[Maturity / Section A] `avgRevenue` is total/locations, not per-month** (`maturity-analysis.ts:95`).

- **[Maturity / Section A] Bucket `locationCount` mixes sub-period populations** — bucket assignment by end-of-window age (`maturity-analysis.ts:79-92`).

- **[Maturity / Section A] Multi-kiosk locations anchored to first kiosk only** (`shared.ts:117`).

- **[Maturity / Section B] Months computed using `30.44` here vs `<= 30` in Section A vs `INTERVAL` in global filter** — three conventions in one dashboard.

- **[Maturity / Section C] No upper-bound on cohort row count** — long portfolios overflow the `<table>` (`page.tsx:255-291`).

- **[Maturity / Section D Plateau] "Insufficient data" path collapses three different conditions into one phrase** (`page.tsx:32-55`).

- **[Heat Map / Score Weights] Server-side `resolveWeights` accepts any non-negative finite weights; sum NOT required to be 1.0** (`heat-map.ts:51-64`).

- **[Heat Map / All sections] `numRooms` filter behaviour silent** — composite score quietly recomputes with re-normalised weights (`metrics.ts:55-67`).

- **[Heat Map / All sections] Traffic light uses raw `revenue`, not composite score** — top-20 outlet can be amber (`performance-table.tsx:165-187`).

- **[Heat Map / All sections] `avgBasketValue ?? 0` masks "no transactions"** — drags min-max normalisation min to 0 (`heat-map.ts:213`).

- **[Heat Map / Bottom 20] When fewer than 20 outlets exist, entire bottom table hidden with misleading empty-state copy** (`heat-map.ts:291-293`).

- **[Heat Map / All Hotels] No virtualisation** (`performance-table.tsx`).

- **[Regions / Hotel Groups in Region] Booking-fee semantics asymmetric — `hotel_count` shifts on metricMode** (`regions.ts:172-191`).

- **[Regions / Location Groups in Region] `outlet_count` cross-row sum > distinct outlets** (`regions.ts:217`).

- **[Hotel Groups / Group Metrics] Comparison period uses pure period-shift, not "MoM"/"YoY"** — no UI toggle (`hotel-groups.ts:286-289`).

- **[Hotel Groups / Hotels in Group] Reversal rows count as transactions but net to revenue** (`hotel-groups.ts:236`).

- **[Hotel Groups / Hotels in Group] Multi-group selection: rows once but with inflated revenue via fan-out** (`hotel-groups.ts:235, 241-243`).

- **[Hotel Groups / Daily Trends] No date-bucketing for long ranges** (`hotel-groups.ts:265-278`).

- **[Hotel Groups / Daily Trends] Empty days absent rather than zero** (`hotel-groups.ts:265-278`).

- **[Location Groups / Selector] `hotel_count` toggles under metricMode** (`location-groups.ts:94`).

- **[Location Groups / Capacity] `txnPerRoom` exists in CapacityMetrics card but not in original spec** (`capacity-metrics.tsx:25-29`).

- **[Location Groups / Peer Analysis] Recursive call to `getLocationGroupsList` doubles cost of detail fetch** (`location-groups.ts:165`).

- **[Location Groups / Peer Analysis] No comparison toggle** (`location-groups.ts:164-189`).

- **[Compare / Cards] "Best" treated as ordinal but values can tie**; UI doesn't say "tied" (`comparison-cards.tsx:71`).

- **[Compare / Cards] `metricLabel` swap covers Revenue but not "Avg Basket" / "Transactions" labels** (`comparison-cards.tsx:74, 80`).

- **[Compare / Control panel] `getEntityOptions` ignores user scoping** — picker leaks IDs/names of out-of-scope entities (`comparison.ts:211-237`).

- **[Compare / Control panel] `entityIds.map(id => '${id}')` SQL string interpolation** — UUID-only inputs make this safe today, fragile (`comparison.ts:70`).

- **[Compare / Control panel] `selectedIds` order leaks into result order via ORDER BY revenue DESC** (`comparison.ts:107`).

- **[Compare / Control panel] Empty-result branch hides why** (`page.tsx:257-265`).

- **[Pivot Table] Empty cells render as "—"; grand totals show "—" in every cell on cross-tabs**
  - File: `pivot-engine.ts:380-398`, `pivot-result-table.tsx:110-121`
  - Grand totals only keyed by alias, never per column.

- **[Pivot Table] Truncation banner shows post-truncation `rowCount` (capped at 10k)** — no signal of how much data is missing (`pivot-engine.ts:341-344`).

- **[Pivot Table] Comparison columns rendered inline with current-period columns** — interleaved, easy to misread (`pivot-result-table.tsx:30, 78`).

- **[Trend Builder / Series filters] Booking-fee series has no maturity / location-type gating** (`trend-series.ts:36-73`).

- **[Trend Builder / Series colors] Cycle 8 colors but no UI picker; two series can share a colour** (`trend-store.ts:172-185`).

- **[Trend Builder / Pending vs applied] No "dirty" indicator on Apply button** (`series-builder-panel.tsx:118-125`).

- **[Trend Builder / Main chart] Currency vs count classification forces `avg_basket_value` to currency Y-axis but it's averaged differently** (`trend-chart.tsx:31-35`).

- **[Trend Builder / Y-axis] Right (count) axis has no `allowDecimals=false` constraint** (`trend-chart.tsx:177-184`).

- **[Trend Builder / Tooltip] `appliedSeries.find(s => s.id === baseId)` returns undefined for stale `_yoy` keys after series removal** (`trend-chart.tsx:191-224`).

- **[Trend Builder / Weather] No granularity awareness** — main chart monthly, weather chart daily (`weather-mini-chart.tsx:26-95`).

- **[Trend Builder / Weather] No auth-scoped lat/lng access check** (`actions.ts:50-79`).

- **[Commission / KPI cards] Division-by-zero edge cases display "0.00%" instead of "—"** (`actions.ts:109-111, 132-134`).

- **[Commission / KPI cards] Hardcoded GBP / `formatCurrency` ignores AU region** — verify shared formatter handles region (`page.tsx`).

- **[Commission / By Location] Sort key vulnerable to nulls** (`actions.ts:163-176`).

- **[Commission / By Location] `effectiveRate=0` rendered as "0.00%"** instead of "—".

- **[Commission / By Product] No fee-row filter** — defensible because every commission row is fee-derived, but worth a comment (`actions.ts:196-227`).

- **[Commission / Monthly] Sort key is `to_char(...)` lexicographic; works because of zero-padding but footgun if format changes** (`actions.ts:240-251`).

- **[Commission / Monthly] Bar chart ignores commissionable series; fetched but unused** (`page.tsx:291`).

- **[Experiments / Cohort List] Archived locations stay in cohort** (`actions.ts:96-129`).

- **[Experiments / Cohort List] No validation that `controlLocationIds` is non-empty for `named_control`** (`actions.ts:96-117`).

- **[Experiments / Cohort List] Race in `setSelectedId` after delete** (`page.tsx:256-263`).

- **[Experiments / Temporal Analysis] No active-location / scope check on YoY periods that fall outside data window** — silent zeros.

- **[Experiments / Temporal Analysis] `revChange` uses Pre as baseline; no consideration of seasonality** (`page.tsx:99-101, 111`).

- **[Experiments / Temporal Analysis] Transactions shown alongside revenue but no commentary on refund interaction**.

- **[Experiments / Cohort vs Control] `findSimilarLocations` revenue/room thresholds hardcoded** (`queries/experiments.ts:179-186`).

- **[Experiments / Cohort vs Control] `findSimilarLocations` ignores cohorts that share `numRooms IS NULL`** (`queries/experiments.ts:207`).

- **[Experiments / Cohort vs Control] `findSimilarLocations` returns 10 max but no jitter / no diversity** (`queries/experiments.ts`).

- **[Actions / Filter Tabs] No "Mine only" filter** despite `ownerId` support in query (`actions.ts:51`).

- **[Actions / Filter Tabs] No location filter on the page** (`page.tsx`).

- **[Actions / Filter Tabs] Filter changes trigger a full reload** — no client-side filtering on already-fetched data (`page.tsx:89-92`).

- **[Actions / Table] `locationName` shows "—" for null but description is line-clamped to 1** — descriptions >50 chars truncated with no expand affordance (`page.tsx:206-209`).

- **[Actions / Table] `outcomeNotes` shown only for resolved items, single line, in Actions cell** — cramming (`page.tsx:257-261`).

- **[Actions / Table] Inline resolve form takes over the table; appears at the bottom, not next to the actual row** (`page.tsx:266-307`).

---

## P3 — Cosmetic / inconsistency

- **[Portfolio / KPI Strip] Skeleton/placeholder array length hard-coded to 5** (`page.tsx:263`).

- **[Portfolio / Threshold Editor] No visual link between editor and the cards it controls**.

- **[Portfolio / High Performer / Low Performer] Hard-coded `£` symbol in insight string** (`high-performer-analysis.ts:258`).

- **[Portfolio / Daily Trends] Y-axis revenue tick formatter shows full GBP per tick** — crowded for large portfolios (`daily-trends.tsx:47`).

- **[Portfolio / Hourly Distribution] Tooltip shows `HH:00 - HH:59`** (cosmetic).

- **[Portfolio / Top Products] `LIMIT 20` hard-coded** (`portfolio.ts:226, 258`).

- **[Portfolio / Outlet Tiers] `outletCode` empty-string fallback collides React keys when two unmapped outlets share a hotel name** (`portfolio.ts:364`, `outlet-tiers.tsx:83`).

- **[Portfolio / Flags Drawer] Drawer not virtualised** (`flags/actions.ts:71-76`).

- **[Maturity / Section A] Empty heuristic ignores `locationCount`** — empty branch is dead code (`page.tsx:139, 143-150, 182-184`).

- **[Maturity / Section B] All-zero ramp empty-state fine; single-nonzero point still draws a line** (`page.tsx:118, 197`).

- **[Maturity / Section C] Sort by install_month DESC** — newest cohorts have least data (`maturity-analysis.ts:206`).

- **[Maturity / Section D Plateau] Discards 0-30d and 61-90d buckets** (`page.tsx:28-75`).

- **[Heat Map / Score Weights] Apply button check exact `=== 100`; `setPending` rounds per input** — locks integer invariant (`heatmap-weights-store.ts:56-62, 98`).

- **[Heat Map / Score Weights] localStorage rehydration doesn't validate shape** (`heatmap-weights-store.ts:113-125`).

- **[Heat Map / Score Weights] Cache key includes weights JSON; power user can blow cache** (`heat-map.ts:311-314`).

- **[Heat Map / Top 20 / Bottom 20] Score colour thresholds hard-coded `≥70/≥40` in `performance-table.tsx:40-44`** — different from traffic-light cutoffs.

- **[Heat Map / Top 20 / Bottom 20] Sticky columns "Rank" + "Hotel" use hard-coded width — overflows at 1000+ outlets** (`performance-table.tsx:73-78, 99-102`).

- **[Heat Map / Bottom 20] `bottomPerformers` shown reversed; rank column reads bottom-up** (`heat-map.ts:287`).

- **[Regions / Selector] `calculatePeriodChange` imported but unused** (`regions.ts:26`).

- **[Regions / Selector] Region cards show no MoM/YoY indicator** (cards.tsx).

- **[Regions / Selector] No `previousMetrics` cap on cards** (`region-selector.tsx`).

- **[Regions / KPI grid] `loading` skeleton drift** (`region-metrics.tsx:18-56`).

- **[Regions / Hotel Groups in Region] Hotel groups not joined back to operating-group canonicalisation** — inconsistency with Portfolio.

- **[Hotel Groups / Selector] `revenueChange`/`transactionChange` per row computed but unused** (`hotel-groups.ts:168-170`).

- **[Hotel Groups / Hotels in Group] `outletCode` defaults to empty string not NULL, then UI conditionally renders only on truthy** (`hotel-groups.ts:233`).

- **[Compare / Picker] No search/virtualisation** (`page.tsx:179-225`).

- **[Compare / Picker] Disabled-state Compare button reads "Compare (1)"** — needs tooltip (`page.tsx:230-241`).

- **[Pivot Table / Toolbar] "Clear All" silently clears period comparison too** (`pivot-store.ts:114-120`).

- **[Pivot Table / DnD] Drag preview only shows label, no preview of where it would drop** (`page.tsx:175-187`).

- **[Pivot Table / Result table] Header alignment double-iterates `Object.keys` with positional fallback** — verbose cell keys render as column labels (`pivot-result-table.tsx:43-64`).

- **[Trend Builder / Auto granularity] Recomputed on every render via `new Date()`** — not memoized (`trend-chart.tsx:110-113`).

- **[Trend Builder / Series labels] Auto-generated label uses raw IDs, not names** (`trend-store.ts:41-55`).

- **[Trend Builder / Main chart] Date sort uses `localeCompare` on strings — OK because ISO dates sort lex = chrono** (`trend-chart.tsx:69-71`).

- **[Trend Builder / Legend] Dead code in legend `onClick` toggle for `_yoy` keys** (`trend-chart.tsx:206-214, 261-264`).

- **[Commission / KPI cards] "Records with Commission" label is ambiguous** — counts non-reversal rows even with commission=0 (`page.tsx:187`).

- **[Experiments / `findSimilarHotels` button] Ignores already-selected control locations** (`cohort-form.tsx:75-85`).

- **[Experiments / Cohort name uniqueness not enforced**.

- **[Actions / Cross-section] `ChartCard` collapsible state is per-page; no session persistence**.

- **[Actions / Performance] `listActionItems` re-runs full users join purely to denormalize one row** (`actions.ts:148-149, 212-213`).

---

## Systemic patterns

These cross-cutting issues re-surface across many dashboards. Each is the root cause of multiple P0/P1 findings above; fixing the root mostly fixes the descendants.

- **Default `metricMode='sales'` includes fee rows in COUNT(*)** — inflates "Transactions" 2-3× across every dashboard except Top Products. Cascades into Avg Basket, Heat Map composite scoring, tier rankings, and category leaderboards. Root file: `src/lib/analytics/queries/shared.ts:51-53`.

- **`buildActiveLocationCondition` does NOT filter `archivedAt`** — soft-deleted locations leak into every aggregate, every tier table, every percentile rank. Root file: `src/lib/analytics/active-locations.ts:29-46`.

- **Reversal rows have no flag and are counted by `COUNT(*)` everywhere** — every dashboard's transaction count is inflated by the refund volume. Root: `sales_records` schema has no `is_reversal` column; no helper exists.

- **Maturity reference-date inconsistency** — SQL filter (post-`f374da7`) uses `filters.dateTo`; client-side `calculateMaturityBucket` defaults to `new Date()` (today). Outlet Tiers and Heat Map performance-table render the wrong maturity for historical windows.

- **Membership joins fan out without de-duplication** — `INNER JOIN location_*_memberships` multiplies rows for any multi-membership location. Affects Regions selector + KPIs + breakdown tables, Hotel Groups selector + KPIs + daily trends, Location Groups selector + KPIs + peer analysis, Compare hotel-group/region cards.

- **Schema drift after migration 0022 not propagated to Pivot Table, Trend Builder, or `EDITABLE_LOCATION_FIELDS`** — Pivot exposes six dropped columns (`gross_amount`, `quantity`, `booking_fee`, `sale_commission`, `discount_amount`, `region`) and runs fail at the database; Trend Builder's `metric=booking_fee` ignores `9992` while every other dashboard ORs it; `EDITABLE_LOCATION_FIELDS` lists `region` against a column that no longer exists.

- **Maturity and percentage thresholds hard-coded** — `±10%` plateau threshold, `≥70/≥40` heat-map score colours, `≥80/≥50/≥20` outlet-tier cutoffs all live as inline magic numbers in code, with no settings-driven equivalent.

- **Every dashboard that exposes `outlet_code` does so without region disambiguation** — `(primaryRegionId, outletCode)` is the natural key but UI shows only the code. Multi-region groups produce confusing duplicates labelled identically.
