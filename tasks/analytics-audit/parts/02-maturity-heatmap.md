# Maturity Analysis Dashboard — Logic & Audit

Files audited:
- `src/app/(app)/analytics/maturity/page.tsx`
- `src/app/(app)/analytics/maturity/actions.ts`
- `src/lib/analytics/queries/maturity-analysis.ts`
- `src/lib/analytics/maturity.ts`
- `src/lib/analytics/queries/shared.ts` (helpers)
- `src/lib/analytics/active-locations.ts` (active-location predicate)

The page fetches a single combined `MaturityAnalysis` payload via `fetchMaturityAnalysis` → `getMaturityAnalysisCached` (`maturity-analysis.ts:235-238`), which fans out to three queries via `Promise.all` (`maturity-analysis.ts:218-229`). Bucket boundaries differ from the global maturity filter — see Section A and the Cross-section block.

---

## Section A: Revenue / Sales by Maturity Bucket (KPI grid + bar chart)

### Logic

- Render: `src/app/(app)/analytics/maturity/page.tsx:134-186`. Renders four `KpiCard`s (one per bucket) plus a `BarChart` with `dataKey="avgRevenue"`, fill `#00A6D3`, X-axis from `bucket -> label` (DETAILED_MATURITY_BUCKETS).
- Title is dynamic — `${metricLabel} by Maturity Bucket` where `metricLabel` is `"Sales"` or `"Revenue"` (`src/lib/analytics/metric-label.ts:8-10`).
- Empty test: `data.bucketMetrics.some(b => b.totalRevenue > 0)`. This is fired only when no bucket has total > 0; an all-zero result still renders the four zero KPI cards (looks alive but is empty).
- Data: `getRevenueByMaturityBucket` (`maturity-analysis.ts:65-126`). SQL:

  ```sql
  SELECT
    CASE
      WHEN EXTRACT(EPOCH FROM (filters.dateTo::timestamp - kioskLiveDateSubquery)) / 86400 <= 30  THEN '0-30d'
      WHEN EXTRACT(EPOCH FROM (filters.dateTo::timestamp - kioskLiveDateSubquery)) / 86400 <= 60  THEN '31-60d'
      WHEN EXTRACT(EPOCH FROM (filters.dateTo::timestamp - kioskLiveDateSubquery)) / 86400 <= 90  THEN '61-90d'
      ELSE '90+d'
    END AS bucket,
    COUNT(DISTINCT location_id)                                                  AS location_count,
    COALESCE(SUM(net_amount::numeric) / NULLIF(COUNT(DISTINCT location_id), 0), 0) AS avg_revenue,
    COALESCE(SUM(net_amount::numeric), 0)                                        AS total_revenue
  FROM sales_records INNER JOIN locations ON sales_records.location_id = locations.id
  WHERE <buildMaturityWhere> AND kioskLiveDateSubquery IS NOT NULL
  GROUP BY bucket
  ```

  `kioskLiveDateSubquery` (`shared.ts:117`) is `(SELECT MIN(assigned_at) FROM kiosk_assignments WHERE location_id = locations.id)` — i.e. the location's **earliest ever** kiosk assignment, regardless of whether that kiosk is still active or has been swapped out.
- WHERE clause built by `buildMaturityWhere` (`maturity-analysis.ts:30-56`): combines (date condition `transaction_date BETWEEN dateFrom AND dateTo`, scoping condition, **active location condition** = `outletExclusions` only — see Cross-section), maturity-buckets filter from the global filter store, metric-mode filter, and dimension filters. The active-location predicate ignores `locations.archivedAt`.
- Output massaging (`maturity-analysis.ts:103-125`): the four buckets are zero-filled if SQL returned fewer (e.g. no kiosks live <30d in window).

### Issues

- **P1 — Bucket boundaries differ from the global maturity filter and confuse the user.**
  `src/lib/analytics/maturity.ts:38-43` defines this page's buckets as **0-30d / 31-60d / 61-90d / 90+d** (days), while `MATURITY_BUCKETS` (line 3-8) used by every other dashboard's filter chip is **0-1mo / 1-3mo / 3-6mo / 6+mo** (months). They overlap loosely (1mo ≈ 30.44d, 3mo ≈ 91.3d, 6mo ≈ 182.6d) but a user setting `maturityBuckets=['0-1mo']` in the global filter and looking at this page sees four buckets with three of them seemingly empty — the first bucket `0-30d` is selected but `31-60d` and `61-90d` overlap into "1-3mo" so they're filtered out. There is no UI affordance disclosing this. **Reproducer:** set the global maturity filter to `0-1mo`, open `/analytics/maturity`. Bar chart shows just one bar (or two — see next bug). File: `src/lib/analytics/maturity.ts:1-43`.

- **P1 — Negative-day kiosks get bucketed as `0-30d`.**
  `maturity-analysis.ts:89-92`: the `CASE` ladder uses `<= 30` / `<= 60` / `<= 90` with no lower bound. If `kioskLiveDate > filters.dateTo` (kiosk was installed after the reporting window's end — e.g. user picks dateTo = 2024-12-31 but kiosk went live 2025-03-01), `EXTRACT(EPOCH FROM (refDate - liveDate))/86400` is negative, which is `<= 30`, so the kiosk falls into `0-30d`. In practice the date filter on `transaction_date` will exclude their transactions so the row is dropped silently, **but** if any row from such a kiosk leaks into the window (e.g. early test transactions imported with a transaction_date inside the window but assignment recorded later), it gets reported in the "0-30d" bucket. Confirm this can't happen via `kiosk_assignments` data, or change the CASE to `WHEN >= 0 AND <= 30`. File: `src/lib/analytics/queries/maturity-analysis.ts:88-93`.

- **P2 — `avgRevenue` is total-revenue-over-window divided by unique-locations, not "average revenue per month".**
  Despite the section labelled "Average revenue grouped by days-since-install" and the description saying "Average ${metricLabelLower}", the SQL is `SUM(net_amount) / COUNT(DISTINCT location_id)`. For `dateFrom..dateTo` of 6 months that produces "average revenue **per location over those 6 months**" (NOT per day, per month, or per kiosk). When user changes the global date range, the bar height proportionally scales — making it impossible to compare to a 1-month window vs. a 12-month window. File: `src/lib/analytics/queries/maturity-analysis.ts:95`. Tooltip even labels it "Avg ${metricLabel}" (`page.tsx:171-173`) which doesn't disclose "per location, summed over filter window".

- **P2 — Bucket `locationCount` mixes locations from very different sub-periods.**
  A location was 0-30d old at the START of a 12-month filter window and 90+d old by the END. Which bucket does it land in? Answer (`maturity-analysis.ts:88-92`): based on `filters.dateTo - kioskLiveDate`, so it lands in **the bucket it is by the end of the window**. All of its early-life revenue (when it was actually 0-30d) is summed into the 90+d bucket. The bar chart therefore conflates "kiosks that are this mature now" with "revenue earned at any point during the window, even when the kiosk was less mature" — defeating the purpose of "ramp by maturity". Documenting the choice in the UI ("kiosks classified by maturity at end of window") would help. File: `src/lib/analytics/queries/maturity-analysis.ts:79-92`.

- **P2 — Multi-kiosk locations anchored to first kiosk only.**
  `kioskLiveDateSubquery` returns `MIN(assigned_at)` (`shared.ts:117`). A hotel that got its first kiosk Jan 2024 and a second kiosk Mar 2026 is treated as 2yo+ everywhere — including for the new kiosk's revenue ramp. The transactions from the new kiosk are counted in the 90+d bucket. For a small portfolio (~few hundred outlets) where multi-kiosk hotels are deliberate (lobby + restaurant), this distorts the curve. File: `src/lib/analytics/queries/shared.ts:117`.

- **P3 — Empty heuristic ignores `locationCount`.** `page.tsx:116`: `hasBucketData = data.bucketMetrics.some(b => b.totalRevenue > 0)`. A bucket with `locationCount > 0` but `totalRevenue == 0` (location had assignments but no transactions in window) renders no bar but a KPI card showing `(N locations)` with a `£0.00` value. Acceptable but inconsistent with the empty-state branch — page.tsx:139 also uses `!hasBucketData && !data?.bucketMetrics.length` (always falsy because `bucketMetrics` is zero-filled to 4). Empty branch is dead code. File: `src/app/(app)/analytics/maturity/page.tsx:139,143-150,182-184`.

---

## Section B: Revenue / Sales Ramp Curve (line chart)

### Logic

- Render: `src/app/(app)/analytics/maturity/page.tsx:188-244`. Recharts `LineChart` with `dataKey="avgRevenue"` against `monthsSinceInstall` (0-6 inclusive; "6" labelled as "6+").
- Empty test: `data.rampCurve.some(p => p.avgRevenue > 0)` (`page.tsx:118`).
- Data: `getRevenueRampCurve` (`maturity-analysis.ts:130-179`). SQL:

  ```sql
  SELECT
    LEAST(
      FLOOR(EXTRACT(EPOCH FROM (transaction_date::timestamp - kioskLiveDateSubquery)) / (30.44 * 86400)),
      6
    )::int AS months_since,
    COALESCE(SUM(net_amount::numeric) / NULLIF(COUNT(DISTINCT location_id), 0), 0) AS avg_revenue,
    COUNT(DISTINCT location_id) AS location_count
  FROM sales_records INNER JOIN locations ON sales_records.location_id = locations.id
  WHERE <buildMaturityWhere> AND kioskLiveDateSubquery IS NOT NULL
    AND transaction_date::timestamp >= kioskLiveDateSubquery
  GROUP BY months_since
  ORDER BY months_since
  ```

- Output massaging (`maturity-analysis.ts:172-178`): zero-fills months 0..6.
- The `transaction_date >= kioskLiveDate` predicate is the only thing preventing pre-install transaction rows from leaking in (and is well-placed).

### Issues

- **P0 — `avg_revenue` is "revenue divided by distinct locations seen in that month-bucket", not per-location-per-month.**
  At `monthsSinceInstall = 0` you get all rows from kiosks in their first month; the divisor is the count of distinct locations whose `transaction_date - liveDate` floor=0. A kiosk that lived for >6 months contributes to **every** months_since 0..6 bucket; a kiosk that died after month 1 contributes only to bucket 0 (and maybe 1). The denominator therefore differs per bucket, so the "ramp curve" is **not** a constant cohort's progression — early buckets oversample short-lived kiosks, later buckets only include long-survivors. Survivor bias inflates the right side of the curve. The chart title "Revenue Ramp Curve" implies a cohort view; the SQL gives a population view conflated with attrition. **Reproducer:** install three kiosks A,B,C all generating £1k/month. Kiosk C is removed after month 1. Filter window covers 12 months. Expected curve: flat £1k. Actual curve: month0=£1k (3 locs, £3k), month1=£1k (3 locs, £3k), month2..6=£1k (2 locs, £2k). Looks flat here because revenue scaled, but if C had been a high performer (£5k/m) you would see a "drop" at month 2 that's purely attrition. File: `src/lib/analytics/queries/maturity-analysis.ts:147-152`.

- **P1 — Last bucket (`months_since=6`) silently aggregates months 6..N.**
  `LEAST(..., 6)` collapses months 6..N into one bucket. The X-axis label "6+" tells users this. **But** the divisor `COUNT(DISTINCT location_id)` for month 6 is the count of locations that *ever reached* 6+ months in the window. A 24-month window for kiosks live for years means that single bucket sums months 6..24 worth of revenue divided by the count of locations seen. So month=6 looks 18× bigger than month=5 unless you read the X-axis carefully. The y-axis tooltip labels it "Month 6 (and beyond)" which helps but does not normalise. File: `src/lib/analytics/queries/maturity-analysis.ts:147-150,233-238`.

- **P1 — Filtering on `kioskLiveDateSubquery IS NOT NULL` excludes locations whose `liveDate` column on `locations` is set but whose `kiosk_assignments` row was never created.**
  Schema (`schema.ts:207`) has `locations.liveDate` (a manually-tracked column) plus `kiosk_assignments.assigned_at`. The maturity SQL uses ONLY the latter (`shared.ts:117`). If an admin set `locations.live_date` but never recorded an assignment row (or vice versa), the location is silently excluded. There is no fallback to `locations.live_date`. File: `src/lib/analytics/queries/shared.ts:117` and the `IS NOT NULL` predicates at `maturity-analysis.ts:71,136,189`.

- **P2 — Months computed using 30.44 in SQL but `INTERVAL '1 month'` for the global filter.**
  Section A's bucket SQL uses `<= 30` (clean days). Section B uses `30.44` (average month length). The global filter (`shared.ts:131-150`) uses Postgres `INTERVAL '1 month'` (calendar months, varies 28-31). Three different month-length conventions in the same dashboard. Off-by-day misclassifications at edges. File: `src/lib/analytics/queries/maturity-analysis.ts:148`, `src/lib/analytics/queries/shared.ts:131-150`.

- **P3 — All-zero ramp (no transactions) renders the empty state correctly, but a single nonzero point still draws a line that visually implies a trend.** Cosmetic. File: `src/app/(app)/analytics/maturity/page.tsx:118,197`.

---

## Section C: Install Month Cohorts (table)

### Logic

- Render: `src/app/(app)/analytics/maturity/page.tsx:246-292`. HTML `<table>` (not the shadcn Table). Three columns: Install Month (YYYY-MM), # Locations, Avg Monthly ${metricLabel}.
- Empty test: `data.installCohorts.length > 0` (`page.tsx:119`).
- Data: `getInstallCohorts` (`maturity-analysis.ts:183-214`). SQL:

  ```sql
  SELECT
    TO_CHAR(kioskLiveDateSubquery, 'YYYY-MM')                                    AS install_month,
    COUNT(DISTINCT location_id)                                                  AS location_count,
    COALESCE(SUM(net_amount::numeric) / NULLIF(COUNT(DISTINCT location_id), 0), 0) AS avg_monthly_revenue
  FROM sales_records INNER JOIN locations ON sales_records.location_id = locations.id
  WHERE <buildMaturityWhere> AND kioskLiveDateSubquery IS NOT NULL
  GROUP BY install_month
  ORDER BY install_month DESC
  ```

### Issues

- **P0 — `avg_monthly_revenue` is **NOT** monthly. It is "total revenue in the filter window per location", **not** divided by months.**
  The column header (`page.tsx:267-268`) says "Avg Monthly ${metricLabel}", and the section description (`page.tsx:249`) says "Average monthly ${metricLabelLower} by install cohort". The SQL (`maturity-analysis.ts:202`) is `SUM(net_amount) / COUNT(DISTINCT location_id)` — there is **no** division by month count. With a 12-month filter window, the "Avg Monthly Revenue" displayed is actually 12× the truth. **Reproducer:** filter Jan 2025 - Dec 2025 (12 months); a cohort installed Jan 2025 with £1k/month uniform shows "Avg Monthly Revenue = £12,000" instead of £1,000. The audit task brief explicitly asks "is it sum/locations/months_in_range or sum/locations/distinct_months_with_data?" — the answer is **NEITHER**. It's just `sum/locations`. File: `src/lib/analytics/queries/maturity-analysis.ts:198-207`. Either fix to `sum / locations / months_in_window` (assuming continuous data) or rename to "Avg Lifetime Revenue Per Location" / "Total Per Location In Window".

- **P1 — Cohorts whose install month falls outside `dateFrom..dateTo` still appear as long as transactions exist in the window.**
  The WHERE applies a date filter on `salesRecords.transactionDate`, not on `kioskLiveDate`. So a cohort with `install_month = 2024-03` and transactions in `2025-Q1` will still surface as a row. The page header description ("Average monthly revenue by install cohort") doesn't make clear whether all cohorts are shown or just cohorts whose install month falls in the window. Fine if intentional — but combined with the previous bug, the values are misleading because cohort "2024-03" might have transactions only in the window's last few months while cohort "2025-01" has them across the whole window, yet both are divided by `COUNT(DISTINCT location_id)` only. File: `src/lib/analytics/queries/maturity-analysis.ts:194-207`.

- **P2 — No upper-bound on number of cohort rows.** A long-running portfolio (3+ years live) yields 36+ rows; the `<table>` has no virtualisation, no pagination, and `overflow-x-auto` only — vertical overflow isn't guarded. File: `src/app/(app)/analytics/maturity/page.tsx:255-291`. Acceptable for now (current scale ~24 cohorts) but will degrade.

- **P3 — Sort is by `install_month DESC` (newest first). For a "ramp / maturity" view the newest cohorts have the LEAST data. Some users might want chronological ASC.** No control offered. File: `src/lib/analytics/queries/maturity-analysis.ts:206`.

---

## Section D: Plateau Detection (insight card)

### Logic

- Render: `src/app/(app)/analytics/maturity/page.tsx:294-326`. `getPlateauInsight()` (`page.tsx:28-75`) compares `bucket3160.avgRevenue` to `bucket90.avgRevenue` from Section A's data:

  ```ts
  const pctChange = ((avg90 - avg3160) / avg3160) * 100;
  if (pctChange > 10)  → "Mature kiosks continue to grow (+X%)"  green
  if (pctChange < -10) → "${metricLabel} declines after maturity (-X%)" red
  else                 → "${metricLabel} plateaus after 90 days"  grey
  ```

- Guard rails: returns "Insufficient data..." if either bucket missing, has `locationCount === 0`, or `avg3160 === 0` (`page.tsx:35-55`).

### Issues

- **P1 — Compares 31-60d (a 30-day window) against 90+d (an unbounded window).**
  31-60d is a fixed 30-day sliver. 90+d is open-ended (kiosks live 91 days through years). Section A bug already noted: `avg_revenue = SUM/locations`, summed over the **entire filter window**. So `avg3160` covers per-location revenue earned (during the window) by kiosks classified by their end-of-window age as 31-60d (a thin slice of 30 day-equivalent locations). `avg90` covers per-location revenue earned (during the window) by kiosks classified as 90d+ (which can include kiosks live for 5 years generating revenue across the entire window). These are not comparable — the comparison is "young kiosks' contribution to the window" vs "old kiosks' contribution to the window", **not** "young kiosks at age 30-60d" vs "same kiosks at 90+d". The "plateau" label is therefore meaningless for any window > 60 days. File: `src/app/(app)/analytics/maturity/page.tsx:28-75` + `src/lib/analytics/queries/maturity-analysis.ts:88-101`.

- **P1 — Division by zero / negative `avg3160` not handled.**
  Line 50-55 guards `avg3160 === 0` but **not** `avg3160 < 0`. `avgRevenue` is `SUM(netAmount)/COUNT_DISTINCT_LOCS`. If reversals dominate a tiny cohort (one customer refunded everything), `SUM` is negative, denominator positive → `avg3160 < 0`. Then `pctChange = (avg90 - avg3160)/avg3160 * 100`. Sign flips. E.g. avg3160 = -10, avg90 = +100: `pctChange = (110)/(-10)*100 = -1100%` → renders "Sales declines after maturity (-1100%)" which is the opposite of true. **Reproducer:** small portfolio in Section A with reversed booking exceeding net, narrow filter. File: `src/app/(app)/analytics/maturity/page.tsx:50-58`.

- **P1 — `±10%` threshold is arbitrary and undocumented.** A 9.9% increase shows "plateaus", 10.1% shows "continues to grow". With small N (a few hundred outlets, of which maybe a dozen are in 31-60d) noise easily crosses 10%. Fix: confidence-band or display the actual percentage with the verdict so users can judge. File: `src/app/(app)/analytics/maturity/page.tsx:59-74`.

- **P2 — "Insufficient data" path uses neutral grey but does NOT log/surface why.** Three different conditions (missing bucket, zero locations, zero avg) collapse into one phrase. A user can't distinguish "no kiosks in 31-60d" from "no revenue in 31-60d" from "schema bug". File: `src/app/(app)/analytics/maturity/page.tsx:32-55`.

- **P3 — Page also discards 0-30d and 61-90d buckets.** Those buckets are computed but the plateau insight ignores them. A monotone ramp 0-30d → 90+d is more informative than the 31-60d vs 90+d two-point comparison. File: `src/app/(app)/analytics/maturity/page.tsx:28-75`.

---

# Heat Map Dashboard — Logic & Audit

Files audited:
- `src/app/(app)/analytics/heat-map/page.tsx`
- `src/app/(app)/analytics/heat-map/actions.ts`
- `src/app/(app)/analytics/heat-map/performance-table.tsx`
- `src/app/(app)/analytics/heat-map/weight-editor.tsx`
- `src/lib/stores/heatmap-weights-store.ts`
- `src/lib/analytics/queries/heat-map.ts`
- `src/lib/analytics/queries/heat-map.test.ts`
- `src/lib/analytics/metrics.ts`
- `src/lib/analytics/thresholds.ts` / `thresholds-server.ts`

---

## Section 1: Score Weights Editor

### Logic

- Render: `src/app/(app)/analytics/heat-map/weight-editor.tsx`. Five integer inputs (revenue, transactions, revenuePerRoom, txnPerKiosk, basketValue), stacked bar visualisation, total banner.
- Store: `src/lib/stores/heatmap-weights-store.ts`. Persists `weights` (applied) to localStorage under key `heatmap-weights`. `pending` is hydrated from `weights` on load (`store:118-122`).
- `setPending` clamps each input to 0..100 (rounded integer) (`store:91-94, 56-62`).
- `apply()` (`store:96-101`) only commits `pending → weights` if `sumWeights(pending) === 100` exactly. Apply button is disabled (`weight-editor.tsx:70`) when `!isValid || !isDirty`. Validation banner shows when `total !== 100` with under/over delta.
- Default: `revenue=30, transactions=20, revenuePerRoom=25, txnPerKiosk=15, basketValue=10` (sum=100).
- Adapter: `toScoreWeights()` (`store:134-142`) converts integer percents → fractions (×0.01) before passing to `getHeatMapData`.

### Issues

- **P2 — Server-side `resolveWeights` accepts any non-negative finite weights; sum is **not** required to be 1.0.**
  `heat-map.ts:51-64`: only checks `total > 0` and rejects weights with `NaN/Infinity/negative`. A caller passing `{revenue: 5, transactions: 0, revenuePerRoom: 0, txnPerKiosk: 0, basketValue: 0}` (sum 5) is accepted; `calculateCompositeScore` (`metrics.ts:55-67`) re-normalises by `totalAvailableWeight`, so the final score is `normRevenue * 1.0 = normRevenue`. That's fine **as math**, but it means: if the UI is bypassed (server action called directly, persisted localStorage tampered with, or the UI bug from `setPending` rounding allows non-100 sum to slip through — see next point), the displayed weights in the UI may not match what was scored. File: `src/lib/analytics/queries/heat-map.ts:51-64` + `src/lib/analytics/metrics.ts:55-67`.

- **P2 — Apply button check is exact `=== 100`, but `setPending` calls `Math.round` per input. Rounding errors cannot occur because input is integer-only.** OK as long as nobody adds a slider component later. Worth a comment locking the integer invariant. File: `src/lib/stores/heatmap-weights-store.ts:56-62,98`.

- **P3 — `localStorage` persistence stores `weights` only and rehydrates `pending` from `weights`. If a user has stale weights from a previous deploy (e.g. v0 had different keys), `onRehydrateStorage` does NOT validate that the persisted shape has all five expected keys.** `store:118-122` blindly does `state.pending = { ...state.weights }`. If `weights` is missing one key (schema migration), `pending` is too, and downstream `pending.revenue + pending.transactions + ...` evaluates to NaN, sum check fails, Apply stays disabled, but the stacked bar shows weird sub-100 totals. File: `src/lib/stores/heatmap-weights-store.ts:113-125`. Add a runtime shape check / fall back to DEFAULT_WEIGHTS.

- **P3 — Weight editor allows the user to re-shape scoring on any page load, but the cache key includes the weights via `wrapAnalyticsQuery` JSON.stringify of all args**. Each unique weights config burns a separate cache entry; a power user iterating weights could blow the cache. File: `src/lib/analytics/queries/heat-map.ts:311-314`. Acceptable, but worth noting.

---

## Section 2: Top 20 Performers (table)

### Logic

- Render: `src/app/(app)/analytics/heat-map/page.tsx:106-122`. `<PerformanceTable data={heatMap.topPerformers}>` inside a `ChartCard`.
- Empty test: `heatMap.topPerformers.length > 0` (page.tsx:79).
- Data: from `getHeatMapData` (`heat-map.ts:106-297`); `topPerformers = allPerformers.slice(0, 20)` (`heat-map.ts:286`). `allPerformers` is `scored.sort((a,b) => b.compositeScore - a.compositeScore)` — descending compositeScore — with `rank = idx + 1` assigned (`heat-map.ts:278-283`).
- Column metrics on each row (computed in `heat-map.ts:187-274`):
  - `revenue` = `SUM(salesRecords.netAmount)` from sales rows for the location, after `buildHeatMapWhere` (date, scoping, active-location, maturity, metricMode, dimensions).
  - `transactions` = `COUNT(*)` of those rows.
  - `numRooms` = `locations.numRooms` (nullable).
  - `kioskCount` displayed in table = `activeKioskCountFragment()` correlated subquery: count of `kiosk_assignments` rows where `unassigned_at IS NULL` (i.e. **right now**). NOT scoped to the date range.
  - `revenuePerKiosk` = `revenue / kioskCount` (using the "active right now" count). `null` when kioskCount==0.
  - `revenuePerRoom` = `revenue / numRooms` via `calculateRevenuePerRoom` (`metrics.ts:71-77`); null when numRooms is null/0.
  - `txnPerKiosk` (used in **scoring**) = `transactions / kiosks` where `kiosks` comes from a **separate** SQL fetched query (`heat-map.ts:155-170`) counting distinct `kiosk_assignments` whose `assigned_at <= dateTo` AND `unassigned_at IS NULL OR unassigned_at > dateFrom` — i.e. kiosks active at any point during the filter window.
  - `avgBasketValue` = `revenue / transactions`, null falling back to 0 (`heat-map.ts:213` — `?? 0`).
  - `compositeScore` = weighted sum of min-max normalised metrics (revenue, transactions, revenuePerRoom, txnPerKiosk, avgBasketValue), each scaled to 0-100, weights re-normalised when a metric is null (`metrics.ts:55-67`). `Math.round(score * 100) / 100` → 2dp (`heat-map.ts:269`).
- Maturity badge in table: `calculateMaturityBucket(row.liveDate ? new Date(row.liveDate) : null)` — **with default `referenceDate = new Date()`** (today, not filters.dateTo). See Issues.
- Traffic light: `classifyTrafficLight(row.revenue, thresholdConfig)` — uses **raw revenue**, not composite score. Thresholds come from `app_settings` table (`thresholds-server.ts:11-26`), defaults `redMax=500, greenMin=1500`.

### Issues

- **P0 — Min-max normalisation collapses to "everyone gets 50" when any single outlet dominates.**
  `heat-map.ts:98-102`: `minMaxNormalize(value, min, max) = ((value - min)/(max - min)) * 100`, and `if (max === min) return 50`. With a small-N portfolio (a few hundred outlets) and one outlier — a flagship hotel doing 100× the revenue of the typical outlet — `max` is the outlier and every other outlet's normalised revenue lands in the bottom decile. The score collapses by metric: 99% of outlets cluster in the 0-3 score range on revenue, the outlier sits at 100. The composite then ranks the outlier #1 and discriminates poorly between everyone else. **Reproducer:** in any reasonably real dataset (which has a power-law revenue distribution), check the scoreColorClass distribution — most rows will be red (<40). No winsorisation, no log scaling, no percentile rank. File: `src/lib/analytics/queries/heat-map.ts:96-102, 217-237`.

- **P0 — Composite score "Top/Bottom 20 Performers" can rank by `transactions` count which is inflated by booking-fee rows in `metricMode='sales'`.**
  In `metricMode='sales'` (the default) the SQL has no fee filter, so each booking emits **two** rows: the actual transaction AND the booking-fee row (and possibly more for cash-handling fee). `COUNT(*)` (`heat-map.ts:145-146`) counts all of them. The "transactions" component of the composite score (20% weight by default) is therefore inflated by ~2-3× for high-fee outlets. Avg basket value is similarly suppressed (revenue/inflated_count). Only outlets with very different fee mix would surface this as a divergence. **Reproducer:** Set metricMode=sales, eyeball top 20 — outlets with high fee row counts will bubble up. Switch to revenue mode — different rankings appear. File: `src/lib/analytics/queries/heat-map.ts:144-146`. Compare with `buildNonFeeCondition()` pattern (`shared.ts:57-59`) used in Top Products.

- **P1 — Reversal rows inflate transactions count.**
  `salesRecords` has no `is_reversal` column (`schema.ts:640-683`). Refunds are opposite-signed `netAmount` rows. `SUM(netAmount)` correctly nets to 0, but `COUNT(*)` counts both the original and the reversal as two transactions, so the displayed "Transactions" column over-counts by 2× the refunded volume. Avg basket value (revenue/count) is correspondingly suppressed, txnPerKiosk inflated. File: `src/lib/analytics/queries/heat-map.ts:144-146`. Same pattern affects every COUNT(*)-based metric across the codebase.

- **P1 — Maturity badge in the table is anchored to `new Date()`, not `filters.dateTo`.**
  `performance-table.tsx:114-117`: `calculateMaturityBucket(row.liveDate ? new Date(row.liveDate) : null)`. The function (`maturity.ts:10-21`) defaults `referenceDate = new Date()`. The whole f374da7 fix ("anchor maturity to filters.dateTo") was applied to SQL conditions in `shared.ts` and `maturity-analysis.ts` but **not** to the client-side bucket badge here. So if a user picks a historical date range (e.g. dateTo = 2024-06-30), the table still labels every hotel by its maturity *as of today*, contradicting the rest of the dashboard. File: `src/app/(app)/analytics/heat-map/performance-table.tsx:114-125` (and same bug in `src/app/(app)/analytics/portfolio/outlet-tiers.tsx:91`).

- **P1 — "kioskCount" in the table is "active right now", not "active during filter window". revenuePerKiosk uses this. txnPerKiosk uses a different (window-scoped) count.**
  `heat-map.ts:118-123`: comment notes the discrepancy but the code embraces it. `kiosk_count` from `activeKioskCountFragment()` (`shared.ts:207-214`) counts `unassigned_at IS NULL`, ignoring `assigned_at`. `revenuePerKiosk` for a hotel that had 3 kiosks during the window but lost 2 of them yesterday is now displayed as `revenue / 1` — looks impossibly high. The same row's `txnPerKiosk` divides by 3. The two divisions in adjacent columns of the same row use different denominators. **Reproducer:** any hotel with kiosk churn during the window. File: `src/lib/analytics/queries/heat-map.ts:118-123, 143, 191, 195, 198`.

- **P1 — `kioskCount` from `activeKioskCountFragment` ignores the active-location and scoping predicates inherited by the outer query — unrelated to outlet exclusions but worth noting.** Less impactful: the correlated subquery is per `locations.id`. OK.

- **P1 — Bottom 20 dedup hack: when `allPerformers.length <= 20`, bottomPerformers is set to []; when 21..40 are present, top and bottom **overlap** by 40 - allPerformers.length items.**
  `heat-map.ts:286-293`: `topPerformers = slice(0, 20)`, `bottomPerformers = slice(-20).reverse()`. If `allPerformers.length === 25`, top has ranks 1-20 and bottom has ranks 6-25 reversed → 15 outlets are in **both** tables. The dedup check (`bottomPerformers.length === allPerformers.length ? [] : bottomPerformers`) only triggers at length ≤ 20. There's no warning to the user. File: `src/lib/analytics/queries/heat-map.ts:286-293`.

- **P2 — `numRooms` filter behaviour is silent.** `revenuePerRoom` is null when `numRooms` is null/0 (`metrics.ts:71-77`). The min-max normalisation filters out null values for range calc (`heat-map.ts:220`), and `calculateCompositeScore` re-normalises remaining weights when one is null (`metrics.ts:55-67`). So an outlet missing `numRooms` has its composite score computed using only 4 of the 5 weights, re-scaled — but the displayed compositeScore (rounded to 2dp) doesn't disclose this. Two outlets with same revenue but one missing `numRooms` get different composite scores with no visible reason. File: `src/lib/analytics/metrics.ts:55-67`, `src/lib/analytics/queries/heat-map.ts:240-257`.

- **P2 — Traffic light uses raw `revenue`, not composite score.**
  `performance-table.tsx:165-187`: `classifyTrafficLight(row.revenue, thresholdConfig)`. Defaults `redMax=500, greenMin=1500`. So a top-20 outlet (best composite score) generating £600 in the window is "amber", and a bottom-20 outlet generating £1500 is "green". Status column is ranking-uncorrelated. Confusing UX given the table is called "Top Performers". File: `src/app/(app)/analytics/heat-map/performance-table.tsx:165-187` + `src/lib/analytics/thresholds.ts:8-15`.

- **P2 — `avgBasketValue ?? 0` masks the "no transactions" case.**
  `heat-map.ts:213`: `calculateAvgBasketValue(revenue, transactions)` returns null when transactions==0 (`metrics.ts:87-93`); the `?? 0` coerces null → 0. Then 0 is fed into min-max normalisation alongside legitimate ABV values. `min` is dragged to 0 by these zero-row outlets, distorting the normalised scale for every other outlet. File: `src/lib/analytics/queries/heat-map.ts:213`. Should follow the same null-pass-through-to-composite pattern as `revenuePerRoom`/`txnPerKiosk`.

- **P3 — Score colour thresholds (≥70 green, ≥40 amber, else red) are hard-coded in `performance-table.tsx:40-44`** and don't reference `thresholdConfig`. So the score badge uses one set of cutoffs and the traffic-light pill uses a different set. File: `src/app/(app)/analytics/heat-map/performance-table.tsx:40-44`.

- **P3 — Sticky columns "Rank" + "Hotel" use `left-0` and `left-12` with hard-coded width `w-12` and `min-w-[180px]`.** When the rank exceeds 3 digits (1000+ outlets) it overflows. Not a current concern with ~few hundred outlets. File: `src/app/(app)/analytics/heat-map/performance-table.tsx:73-78,99-102`.

---

## Section 3: Bottom 20 Performers (table)

### Logic

- Render: `src/app/(app)/analytics/heat-map/page.tsx:123-138`. Same `<PerformanceTable>` component, fed `heatMap.bottomPerformers`.
- Data: `heat-map.ts:286-292`: `bottomPerformers = allPerformers.slice(-20).reverse()`. Reversed so worst-of-worst is at the top of the table. Returns `[]` if `bottomPerformers.length === allPerformers.length` (i.e. ≤20 outlets total — see Issues).

### Issues

- **All bugs from Section 2 apply** (rank uses same composite score, table uses same component).
- **P1 — When `allPerformers.length ∈ [21..39]`, bottom 20 and top 20 overlap by `40 - allPerformers.length` items.** See Section 2 issue. File: `src/lib/analytics/queries/heat-map.ts:286-293`.
- **P2 — `bottomPerformers` is shown reversed (`reverse()`) so its rank column reads bottom-up (e.g. rank 200, 199, 198…). The `Rank` column is computed from the **descending** sort, so the bottom table shows ranks N..N-19 in increasing order which is visually counter-intuitive (top of table is rank N).** Cosmetic but confusing. File: `src/lib/analytics/queries/heat-map.ts:287`.
- **P2 — When fewer than 20 outlets exist, the entire bottom table is hidden (returns []), with no message.** Empty state shows "No bottom performer data available" via `ChartCard` empty path (page.tsx:127-129). Acceptable but the error is misleading — there IS data, it just overlaps with top. File: `src/lib/analytics/queries/heat-map.ts:291-293`.

---

## Section 4: All Hotels (collapsed table)

### Logic

- Render: `src/app/(app)/analytics/heat-map/page.tsx:141-157`. `defaultCollapsed`. Renders the full `allPerformers` array via the same `PerformanceTable`.
- Data: same `getHeatMapData` query. `allPerformers` = every outlet that produced sales in the window AND was not excluded by `buildHeatMapWhere`.

### Issues

- **P1 — "All Hotels" excludes anyone with no transactions in the window.**
  The query is `FROM sales_records INNER JOIN locations` with the date condition on `transaction_date` (`heat-map.ts:147-148`). Outlets with zero transactions during `[dateFrom, dateTo]` produce zero rows in the GROUP BY → are absent from `allPerformers`. So "All Hotels" is "All Hotels with sales activity in the window", not "every active outlet in the system". This is rarely flagged in the UI and may surprise users who set a tight date range. File: `src/lib/analytics/queries/heat-map.ts:135-151`.

- **P1 — `archivedAt` soft-deleted locations are NOT excluded.**
  Schema has `locations.archivedAt timestamp` (`schema.ts:214`). `buildActiveLocationCondition()` (`active-locations.ts:60-67`) only filters via the `outlet_exclusions` table — there is **NO** check on `archivedAt`. `getActiveLocationIds` (`active-locations.ts:29-46`) selects from `locations` with no archivedAt filter. So an admin who archives a location through whichever admin UI sets `archivedAt` will continue to see that location in "All Hotels" as long as it has historical sales. The rest of the analytics suite has the same problem (see audit task brief — "buildActiveLocationCondition() excludes archived locations" — **it does not**). File: `src/lib/analytics/active-locations.ts:29-46, 60-67`.

- **P2 — No virtualisation.** Renders all rows in the table. With current ~few hundred outlets this is fine; if the portfolio scales to thousands, scroll lag will hit. File: `src/app/(app)/analytics/heat-map/performance-table.tsx:96-202`.

- **P3 — Comparison with `topPerformers` ranking: `allPerformers` ranks are global and consistent with the top-20 ranks, so a power-user can cross-reference. Good.** File: `src/lib/analytics/queries/heat-map.ts:280-283`.

---

# Cross-section issues

These apply to BOTH dashboards and merit central fixes.

- **P0 — `buildActiveLocationCondition()` does NOT filter archived locations.**
  The audit brief stated "buildActiveLocationCondition() excludes archived locations"; the code (`src/lib/analytics/active-locations.ts:29-46`) only excludes via `outletExclusions`. `locations.archivedAt` is silently ignored across the entire analytics surface. Fix: add `WHERE archived_at IS NULL` to `getActiveLocationIds`. File: `src/lib/analytics/active-locations.ts:29-46`.

- **P0 — No reversal handling on COUNT(*).**
  `salesRecords` has no `is_reversal` column (refunds appear as opposite-signed `netAmount` rows). `SUM(netAmount)` correctly nets, but `COUNT(*)` and `COUNT(DISTINCT ...)` over-count. Affects: heat-map "Transactions" column, txnPerKiosk, basket value; maturity-analysis bucket location_count and ramp curve location_count (a refund-only row makes a location appear in a window even if the original sale isn't there if filtered out by another condition — unlikely for these queries but worth verifying). File: codebase-wide; no central helper to exclude reversals. Recommend a `buildNonReversalCondition()` helper alongside `buildNonFeeCondition()`.

- **P0 — Booking-fee rows double-count COUNT(*) in `metricMode='sales'`.**
  `metricMode='sales'` includes fee rows (per `buildMetricModeCondition` returning undefined → no filter). For each bookable transaction, the sales table holds the transaction + 1 (or 2) fee rows. Heat-map "Transactions" column inflates by ~2-3×; basket value is suppressed. Top Products correctly uses `buildNonFeeCondition`. The pattern needs to extend to any COUNT-based metric in heat-map and maturity-analysis. File: `src/lib/analytics/queries/heat-map.ts:144-146`; `src/lib/analytics/queries/maturity-analysis.ts:94, 151, 201` (all `COUNT(DISTINCT location_id)`, less impacted because DISTINCT collapses fee + non-fee rows for the same location to 1, but `SUM(netAmount)` includes fees in 'sales' mode while denominator is locations — silently mixing fee + sale revenue in the numerator).

- **P1 — `locations.live_date` (column on locations table) is NOT used; only `kiosk_assignments.assigned_at` is used.**
  Two sources of truth for "when did the kiosk go live" exist (`schema.ts:207` vs `schema.ts:235`). The maturity SQL uses MIN(`assigned_at`) only (`shared.ts:117`). Heat-map's `liveDate` column displayed in the table is also `kioskLiveDateSubquery::text` (heat-map.ts:141). If admins maintain `locations.live_date` manually but `kiosk_assignments` is empty for a property, every analytics view skips it. Document or unify. File: `src/lib/analytics/queries/shared.ts:117`.

- **P1 — Maturity reference date inconsistency: SQL uses `filters.dateTo`, client-side `calculateMaturityBucket` uses `new Date()` default.**
  `f374da7` fixed the SQL side. Client-side call sites (`heat-map/performance-table.tsx:114-117`, `portfolio/outlet-tiers.tsx:91`) were missed. Result: heat-map row's "Maturity" badge can disagree with the same hotel's bucket assignment in the maturity-analysis dashboard. Fix: thread `filters.dateTo` through to the components and pass to `calculateMaturityBucket(date, new Date(filters.dateTo))`. File: `src/app/(app)/analytics/heat-map/performance-table.tsx:114-117`.

- **P1 — Bucket boundary inconsistency: detailed (days) vs filter (months) vs ramp (30.44 days).**
  Three different conventions in the maturity dashboard alone, plus `INTERVAL '1 month'` in `buildMaturityCondition` (`shared.ts:131-150`). A user filtering "0-1mo" globally and looking at "0-30d" in this dashboard sees a partial overlap (1 month ≈ 30.44 days, 1 calendar month varies 28-31). Decide on one definition.

- **P1 — `locationType` filter silently excludes NULL `location_type`.**
  `buildDimensionFilters` (`shared.ts:97-107`): when `filters.locationTypes` is set, the predicate is `salesRecords.locationId IN (SELECT id FROM locations WHERE locationType IN (...))`. Locations with `locationType = NULL` are excluded silently. No UI affordance. File: `src/lib/analytics/queries/shared.ts:97-107`.

- **P1 — `buildMaturityCondition` excludes locations with NULL `kioskLiveDate` when ANY bucket is selected.**
  `shared.ts:131-150`: each case is a comparison against `kioskLiveDateSubquery`. If the subquery returns NULL (no kiosk_assignments rows), every comparison is NULL → the OR over bucket conditions is NULL → row is excluded from the WHERE. So selecting any maturity bucket silently drops all hotels without an assignments row, even if they have `locations.live_date` set. File: `src/lib/analytics/queries/shared.ts:131-156`.

- **P2 — `kiosk_count` in heat-map activeKioskCountFragment doesn't filter `unassigned_at <= now()` — it relies on `unassigned_at IS NULL`.**
  An assignment row written with `unassigned_at` set to a future timestamp would still be excluded from "active". This is a legacy guard rather than a bug, but worth verifying admin operations always write `unassigned_at = now()` on un-assignment. File: `src/lib/analytics/queries/shared.ts:207-214`.

- **P2 — Cache key construction via `wrapAnalyticsQuery` includes the entire weights object via `JSON.stringify`. Different orderings of keys in the input would produce different cache entries despite semantic equivalence.** Mitigated because callers always pass via `toScoreWeights` (deterministic key order). Worth documenting. File: `src/lib/analytics/queries/heat-map.ts:299-314` and the wrapper.

- **P3 — Heat-map's two kiosk-count denominators (active-now vs date-bounded) is documented in a code comment (`heat-map.ts:118-123`) but invisible to the user.** Fix: add column tooltips clarifying which denominator each column uses.

- **P3 — `metricMode='revenue'` in maturity-analysis reduces denominators (location_count) because some locations have only sales rows but no fee rows.** A location with only non-fee sales (no booking fees recorded) would not appear in `metricMode='revenue'` queries, dropping it from `COUNT(DISTINCT location_id)`. The "0-30d" bucket might appear empty in revenue mode but populated in sales mode for the same window. Documentation gap. File: `src/lib/analytics/queries/maturity-analysis.ts` (all three queries inherit `buildMetricModeCondition`).

- **P3 — Defensive `?? 0` on `avgBasketValue` (heat-map.ts:213) silently coerces "no transactions" outlets to ABV=0, lowering the min for normalisation across the board.** See Section 2 issues. File: `src/lib/analytics/queries/heat-map.ts:213`.

---

## Summary of P0/P1 by dashboard

| Dashboard | P0 | P1 |
| --- | --- | --- |
| Maturity – Section A (buckets) | — | day boundary mismatch with filter; negative-day kiosks bucketed as 0-30d |
| Maturity – Section B (ramp) | survivor bias in cohort-less ramp curve | 6+ aggregation; live_date fallback; 30.44 vs INTERVAL inconsistency |
| Maturity – Section C (cohorts) | "Avg Monthly" is total/locations, NOT monthly | cohorts outside install window still appear |
| Maturity – Section D (plateau) | — | 31-60d vs 90+d incomparable; div-by-negative; ±10% threshold |
| Heat-map – Score Weights | — | — |
| Heat-map – Top/Bottom 20 | min-max collapse with outliers; sales-mode COUNT inflated by fees | reversals in COUNT; maturity badge anchored to today; two kiosk-count definitions; bottom-overlap when 21≤N≤39 |
| Heat-map – All Hotels | — | excludes outlets with no sales in window; archived locations NOT excluded |
| Cross-cutting | archived locations bypass active filter; reversals in COUNT; fee rows double-count COUNT in sales mode | live_date dual sources; maturity ref date client/server inconsistency; bucket boundary three-way mismatch; locationType NULL silently excluded; maturityBuckets filter silently drops NULL liveDate locations |
