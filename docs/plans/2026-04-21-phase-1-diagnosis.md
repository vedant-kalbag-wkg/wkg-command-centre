# Phase 1 — Diagnosis

Date: 2026-04-21
Parent initiative: `docs/plans/2026-04-21-db-performance-design.md`
Predecessor: Phase 0 (merged to `optimisation` as PR #18)
Design: `docs/plans/2026-04-21-phase-1-measurement-design.md`
Plan: `docs/plans/2026-04-21-phase-1-measurement-plan.md`

## Summary

Synthetic load against a Vercel preview pointing at the Neon dev branch with `pg_stat_statements` enabled captured 50 authenticated Playwright navigations (5 iterations × 10 routes). The entire analytics layer (all `/analytics/*` pages) is `"use client"`; server-component render issues zero analytics queries. Real work happens after client hydration via server actions fanned out with `Promise.all`. The measurement driver used `page.goto()` + `waitForLoadState('networkidle')` to force hydration and capture the full query surface.

Headline findings:

- 6 of 10 top-impact queries live in `src/lib/analytics/queries/portfolio.ts`. `/analytics/portfolio` is by far the worst route.
- A single compound covering index on `sales_records(transaction_date, location_id) INCLUDE (gross_amount, quantity, product_id)` would materially improve 5 of the top 10 (queries #1–#4 and #7).
- A second index `kiosk_assignments(location_id, assigned_at)` removes a correlated-subquery N+1 shared by #5 and #6 (200 loops × 9 buffer hits each today).
- Query #8 (`getHotelGroupsList`) is the only top-10 query that spills to disk — 9 MB external merge sort driven by `COUNT(DISTINCT location_id)` over an exploded membership JOIN. Needs a rewrite, not an index.
- Cross-cutting: every top-10 query JOINs `locations` solely to apply the `outlet_exclusions` filter (currently one row: `outlet_code = 'TEST'`). The locations-pk lookup costs ~700–2,000 buffer hits per query via a Memoize cache. A per-request "active locations" lookup or a pre-filter subquery saves those hits across the entire analytics surface.
- `fetchPortfolioData` already runs all 7 sub-queries in `Promise.all`, and the page-level server actions also run in `Promise.all`. Wall-clock latency is bounded by the slowest single query (~280 ms in #2), not the sum. This changes Phase 2 prioritisation — see "Waterfall findings" below.

## Measurement method

Preview: `https://wkg-command-centre-cmhqxczdz-vedant-kalbag-wkgs-projects.vercel.app` (Neon dev branch). `pg_stat_statements` was reset immediately before a driver script authenticated as the test admin, then ran 5 iterations × 10 routes (50 `page.goto()` navigations, each awaited on `networkidle`). A snapshot was then taken: top 25 rows ordered by `mean_exec_time × calls`, platform / pg_catalog / neon.timeline_* rows filtered out. EXPLAIN (ANALYZE, BUFFERS) was run manually against the dev branch for each of the top 10 after mapping them to source via distinctive aliases. Raw outputs: `test-results/phase-1-1776760658/raw-findings.md`, `pgss-snapshot.json`, `explain-manual-{1..10}.txt`, `call-site-summary.md`.

## Top 10 queries (ranked by mean_ms × calls)

| # | queryid | Source (file:line) | Function | Calls | Mean ms | Impact (ms) | Proposed fix |
|---|---|---|---|---:|---:|---:|---|
| 1 | 2876412854933992484 | `src/lib/analytics/queries/portfolio.ts:87` | `getPortfolioSummary` | 10 | 191 | 1914 | INDEX — covering `sales_records(transaction_date, location_id) INCLUDE (gross_amount, quantity, product_id)` |
| 2 | -7832206712676690579 | `src/lib/analytics/queries/portfolio.ts:162` | `getTopProducts` | 5 | 278 | 1390 | Same compound index (also covers `product_id`) |
| 3 | 883656055125514950 | `src/lib/analytics/queries/portfolio.ts:127` | `getCategoryPerformance` | 5 | 267 | 1334 | Same compound index as #2 (structurally identical bar one AVG) |
| 4 | -296059890286988519 | `src/lib/analytics/queries/portfolio.ts:197` | `getDailyTrends` | 5 | 217 | 1084 | Same compound index (`(transaction_date)` prefix matches) |
| 5 | 2494768760741788218 | `src/lib/analytics/queries/portfolio.ts:262` | `getOutletTiers` | 5 | 214 | 1071 | INDEX — `kiosk_assignments(location_id, assigned_at)` to kill correlated subplan seq-scan + sales_records compound index |
| 6 | -3265543506531508125 | `src/lib/analytics/queries/heat-map.ts:114` | `getHeatMapData` | 5 | 147 | 735 | Same `kiosk_assignments` index (same subquery) + sales_records compound index |
| 7 | -6188082297284223554 | `src/lib/analytics/queries/high-performer-analysis.ts:113` | `computePerformerPatterns` (locationRevenues) | 10 | 59 | 585 | DE-N+1 — strict subset of #1/#5/#6. Share a per-request aggregate-by-location result across analytics endpoints. Fallback: sales_records compound index |
| 8 | -6634863189833404805 | `src/lib/analytics/queries/hotel-groups.ts:80` | `getHotelGroupsList` | 5 | 116 | 578 | REWRITE — pre-aggregate by location before joining memberships, OR separate cheap `COUNT(DISTINCT)` per group. Index won't help: 9 MB external merge sort on the exploded join |
| 9 | -2023545176529618983 | `src/lib/analytics/queries/high-performer-analysis.ts:220` | `computePerformerPatterns` (topProductRows) | 10 | 43 | 429 | REWRITE — replace inline `sql.join(tierIds)` with `= ANY($1::uuid[])` (one param instead of N). Already healthy via `sales_loc_date_idx`. Caveat below |
| 10 | 7722848944034765718 | `src/lib/analytics/queries/portfolio.ts:229` | `getHourlyDistribution` | 5 | 63 | 315 | INDEX — partial `CREATE INDEX … ON sales_records (transaction_date) WHERE transaction_time IS NOT NULL`. 0 rows in dev (transaction_time all-NULL); validate on prod before shipping |

Per-query EXPLAIN evidence:

1. **#1 getPortfolioSummary** — Nested Loop over `sales_prod_date_idx` (124,595 rows, 29,002 buffer hits), then Memoize→`locations_pkey` (243 misses, 729 hits). A covering index keyed on `(transaction_date, location_id)` including the SUM/COUNT columns would allow an Index-Only Scan and skip both the heap fetch and the Memoize dance.
2. **#2 getTopProducts** — Parallel Seq Scan on `sales_records`, Hash Join with `products` and `locations`. The `(transaction_date, product_id)` prefix of the proposed compound index turns this into an index range scan, and `INCLUDE (gross_amount, quantity)` keeps it index-only.
3. **#3 getCategoryPerformance** — Identical plan shape to #2. Same index fixes both.
4. **#4 getDailyTrends** — Parallel Seq Scan + GroupAggregate by `transaction_date`. The proposed index is pre-ordered on `transaction_date` so the GroupAggregate becomes a streaming aggregate with no sort.
5. **#5 getOutletTiers** — Two problems. Main: Parallel Seq Scan on `sales_records`. Subplan: correlated `(SELECT MIN(assigned_at) FROM kiosk_assignments WHERE location_id = locations.id)` runs 200 times as a seq scan (1,800 buffer hits). Index on `kiosk_assignments(location_id, assigned_at)` turns each loop into an index lookup of ~1–3 pages.
6. **#6 getHeatMapData** — Same correlated subquery pattern as #5 (same `kioskLiveDateSubquery` helper), grouped by location instead of hotel. Same index fixes it. See `src/lib/analytics/queries/shared.ts:80`.
7. **#7 locationRevenues** (high-performer) — Small aggregate over the same `sales_records`/`locations` join as #1/#5/#6. Called 10× per load (twice per `computePerformerPatterns` call, which runs for high + low performers). Currently recomputes what `getPortfolioSummary`/`getOutletTiers` already aggregated one Promise slot away; de-N+1 via a shared request-scoped cache.
8. **#8 getHotelGroupsList** — `Sort Method: external merge  Disk: 9032kB` (1,129 temp reads, 1,132 temp writes). Cause: the `sales_records ⋈ location_hotel_group_memberships` join explodes 124k rows to 148k (membership fan-out), and `COUNT(DISTINCT sales_records.location_id)` inside `GROUP BY hotel_groups.id` forces a disk sort. No index fixes this — the sort is on the join output.
9. **#9 topProductRows** (high-performer) — Plan itself is healthy (uses `sales_loc_date_idx`); what makes it land in top 10 is the `calls = 10` column plus a 77-parameter bind list. The fix is application-side: swap `WHERE location_id IN (${sql.join(tierIds, …)})` to `WHERE location_id = ANY($1::uuid[])` so the prepared-statement plan is stable across different tier sizes. Caveat: tier cardinality varies with `greenCutoff`/`redCutoff`; `= ANY(array)` stabilises the bind count (always 1), but plan-time row estimates still depend on array size. Acceptable — this is a smaller plan-cache surface than the current N-param approach.
10. **#10 getHourlyDistribution** — 0 rows returned on dev because `sales_records.transaction_time` is entirely NULL on the dev branch (124,595 rows removed by `IS NOT NULL`). The plan is a Parallel Seq Scan. If prod has real `transaction_time` data, behaviour will match #4. Partial index keyed on `(transaction_date) WHERE transaction_time IS NOT NULL` is cheap and correct.

## Worst route waterfall: /analytics/portfolio

Traced from source: `src/app/(app)/analytics/portfolio/page.tsx` + `actions.ts` + `src/lib/analytics/queries/portfolio.ts`.

```
Initial render (server component):
  (no DB queries — page is "use client"; server returns shell only)

Client hydration — PortfolioPage.loadData (page.tsx:103) Promise.all of 6 actions:
  ├─ fetchPortfolioData(filters, comparisonMode)                       → actions.ts:23
  │    → getPortfolioData  (portfolio.ts:319)  Promise.all of 7 sub-queries:
  │        ├─ getPortfolioSummary(filters)          → query #1 (191 ms × 10 calls)
  │        ├─ getPortfolioSummary(previousFilters)  → query #1 shape (previous period)
  │        ├─ getCategoryPerformance               → query #3 (267 ms)
  │        ├─ getTopProducts                       → query #2 (278 ms)   [slowest in batch]
  │        ├─ getDailyTrends                       → query #4 (217 ms)
  │        ├─ getHourlyDistribution                → query #10 (63 ms)
  │        └─ getOutletTiers                       → query #5 (214 ms)   [N+1 via kiosk_assignments subplan]
  ├─ fetchThresholdConfig()                         → small KV read
  ├─ fetchPortfolioEvents(dateFrom, dateTo)         → business_events range scan (not top 10)
  ├─ fetchHighPerformerPatterns(filters, greenCutoff)
  │    → computePerformerPatterns (high-performer-analysis.ts:~80)
  │        1. locationRevenues                     → query #7 (59 ms, awaited serially — blocks the next step)
  │        2. Promise.all of 4 tier queries:
  │           ├─ hotelGroupDistribution
  │           ├─ regionDistribution
  │           ├─ avgKiosks
  │           └─ topProductRows                    → query #9 (43 ms)
  ├─ fetchLowPerformerPatterns(filters, redCutoff)  → same shape as high-performer (second independent run of #7 + fan-out)
  └─ fetchActiveFlags()                             → location_flags list (not top 10)

Parallelisation:
  - Page-level: Promise.all (6 server actions in parallel).
  - fetchPortfolioData: Promise.all (7 queries in parallel).
  - computePerformerPatterns: locationRevenues is serial (must compute tier IDs first),
    then 4 tier-aggregates are Promise.all'd.
  - Wall-clock for the portfolio batch is bounded by the slowest single query
    (~280 ms on #2) + RTT + Next action overhead, NOT the sum (1.9 + 1.4 + 1.3 + ...).
  - Total user-visible latency ≈ max(
       max(getPortfolioData sub-queries) ≈ 280 ms,
       locationRevenues (#7) + max(4 tier queries) ≈ 59 + ~45 ≈ 100 ms — ×2 (high + low),
       other small actions
    ) plus Vercel cold-start / Neon connection overhead.

Refetch cadence:
  - Any filter change (dateFrom/To, hotels, products, regions, etc.) re-runs
    all 6 actions (page.tsx:98 — filtersJson in useCallback deps).
  - Comparison toggle (MoM/YoY) also re-runs the whole set.
  - Threshold slider (greenCutoff/redCutoff) triggers refetch of both
    high/low performer actions. The other 4 actions also re-run because
    loadData is one function (suboptimal — granular split would save bandwidth).
```

Implication for Phase 2: because the queries parallelise, the **p95 of the slowest single query** is the target, not the sum. Fixing #1 alone won't move wall-clock much if #2 is still 278 ms. The compound index that fixes #1–#4 is still the right lever — it shrinks the entire batch's p95 together.

## Proposed Phase 2 order

Prioritised by impact × risk × effort. Impact here means "user-visible latency reduction on `/analytics/portfolio`" given the Promise.all structure above.

1. **Compound covering index on `sales_records`** — `CREATE INDEX CONCURRENTLY … ON sales_records (transaction_date, location_id) INCLUDE (gross_amount, quantity, product_id)`. Fixes #1–#4 together (the entire portfolio Promise.all batch), likely cuts the slowest-query ceiling from 280 ms to <100 ms. ETA: 15 min DDL + validation. Risk: low (new index, no data change). Confirm whether an additional `(transaction_date, product_id) INCLUDE (…)` variant is needed — `product_id` sits in the INCLUDE list but queries #2/#3 GROUP BY `products.name`, so keyed-on-product-id may or may not be necessary on prod data volumes (re-EXPLAIN on prod-seeded branch before shipping).
2. **Index on `kiosk_assignments(location_id, assigned_at)`** — kills the correlated-subplan seq-scan in the `kioskLiveDateSubquery` helper (`src/lib/analytics/queries/shared.ts:80`), used by #5 and #6. ETA: 5 min. Risk: low. Expected: 30–50% reduction on those two queries; also speeds up any maturity-bucket filter across every analytics query.
3. **Rewrite `getHotelGroupsList`** (`src/lib/analytics/queries/hotel-groups.ts:80`) — avoid the `COUNT(DISTINCT location_id)` over the exploded membership JOIN. Pre-aggregate `sales_records` by `location_id` in a CTE, then join membership/groups. ETA: 1–2 hours (query + semantics verification). Risk: medium (must match current row counts exactly). Expected: eliminates 9 MB disk spill, drops mean from 116 ms to <20 ms. Largest single-query win.
4. **Application rewrite in `high-performer-analysis.ts`** (lines ~170–235) — replace the four inlined `IN (${sql.join(tierIds, …)})` with `= ANY($1::uuid[])`. ETA: 30 min. Risk: low (mechanical). Expected: minor runtime win; primary benefit is shrinking bind count and stabilising plan cache under varying tier sizes. Tier cardinality varies per call via `greenCutoff`, so plan-time row estimates still shift — but the prepared-statement surface is smaller and more cacheable.
5. **De-N+1 `locationRevenues`** (`src/lib/analytics/queries/high-performer-analysis.ts:113`) — this is a strict subset of the `getPortfolioSummary`/`getOutletTiers` aggregate. Share a request-scoped `aggregateByLocation` result between `fetchPortfolioData` and `fetchHigh/LowPerformerPatterns` (`React.cache` or a request-level memo passed via a context param). ETA: 1–2 hours. Risk: low-medium (refactor surface across 3 call sites). Expected: removes query #7's 585 ms impact entirely and collapses 10 calls to 1 per request.
6. **Cross-cutting: active_locations helper** — every top-10 query applies `outlet_exclusions` via a JOIN onto `locations` for the sole purpose of filtering `outlet_code`. Options: (a) a small pre-computed CTE wrapped into `buildPortfolioWhere`/`buildHeatMapWhere`/etc., materialised once per request via `React.cache`; (b) a generated column or materialised view of "active location IDs" that the analytics queries subquery into (`WHERE sales_records.location_id IN (SELECT id FROM active_locations)`). ETA: 1 hour for (a), half-day for (b) with invalidation. Risk: low for (a), medium for (b). Expected: 5–15% buffer-hit reduction across every analytics query, most pronounced as locations table grows.
7. **Partial index on `sales_records.transaction_time`** — deferred until validated on prod. If prod data has real `transaction_time` values, `CREATE INDEX … ON sales_records (transaction_date) WHERE transaction_time IS NOT NULL`. ETA: 10 min. Risk: low.
8. **Caching layer** — `unstable_cache` on `getPortfolioSummary` keyed on `(filters, userScope)` if filters are stable across users; `React.cache` for per-request dedupe (helps #5/#6/#7 share a locations/kiosk-assignments lookup). ETA: 2 hours. Risk: medium (invalidation on ETL runs). Expected: 20–50% on repeat-filter scenarios; little on first-hit.

## Caveats on the numbers

- **Synthetic, uniform load.** 5 iterations on each of 10 routes. Real traffic will be skewed toward portfolio + heat-map, so the portfolio index delivers more real user wins than the impact-ms column suggests.
- **Neon dev branch, not prod.** Dev has 346 locations / 124,595 sales_records / 2025 date range. Prod row counts are not confirmed in this PR; plans may differ under prod data volumes. Queries that are Seq Scan on dev might legitimately choose an index on prod — or vice versa. Before shipping any Phase 2 fix, re-EXPLAIN the candidate query on a prod-seeded branch.
- **pg_stat_statements was reset immediately before load**, so all captured data is from the 50-navigation window. Platform noise (`pg_catalog.*`, `neon.timeline_*`) was filtered out of the ranking; functional app queries only.
- **Query #10 returned 0 rows** because `sales_records.transaction_time IS NOT NULL` is false for every dev row. Fix recommendation is conditional on prod having real timestamp data; defer the partial index until confirmed.
- **Parallelism bounds the win.** Because `getPortfolioData` uses `Promise.all`, the user-visible latency savings from fixing any one of #1–#5 individually is small. The compound index only pays off because it hits four of them at once and shrinks the batch ceiling. Phase 2 ordering above reflects that.
- **Task 7 notes.** Cross-cutting "locations ⋈ outlet_code != 'TEST'" is applied via `buildExclusionCondition` (`src/lib/analytics/queries/shared.ts:14`) which emits `NOT (locations.outlet_code = 'TEST')` plus the explicit `INNER JOIN locations` in `baseFrom()` (`src/lib/analytics/queries/portfolio.ts:62`). That's why the fix is "cached active-locations helper / subquery", not a Drizzle relation refactor.
- **Query #9's tier cardinality varies.** `pickTierIds` returns different numbers of UUIDs depending on `greenCutoff`/`redCutoff` and filtered totalCount. `= ANY($1::uuid[])` stabilises the bind count at 1 but does not fully eliminate plan-cache variance — the planner still re-estimates rows based on array size. This is still a net win vs. today's N-param IN list, but not a silver bullet.

## Cross-reference: queries × routes

| Query | Primary route | Secondary routes |
|---|---|---|
| #1 getPortfolioSummary | `/analytics/portfolio` | — |
| #2 getTopProducts | `/analytics/portfolio` | — |
| #3 getCategoryPerformance | `/analytics/portfolio` | — |
| #4 getDailyTrends | `/analytics/portfolio` | — |
| #5 getOutletTiers | `/analytics/portfolio` | — |
| #6 getHeatMapData | `/analytics/heat-map` | — |
| #7 locationRevenues | `/analytics/portfolio` (via high + low performer cards) | any page calling `computePerformerPatterns` |
| #8 getHotelGroupsList | `/analytics/hotel-groups` | — |
| #9 topProductRows | `/analytics/portfolio` (via performer cards) | same as #7 |
| #10 getHourlyDistribution | `/analytics/portfolio` | — |

`/analytics/portfolio` is the primary consumer of 8 of 10 top queries. Sequence Phase 2 fixes so portfolio drops first: compound sales_records index (rec. 1) and kiosk_assignments index (rec. 2) both land on portfolio before anything else is touched.

## Out of scope for Phase 1

- No code or DDL changes. All optimisation work lands in Phase 2 onward.
- No prod DB changes. Only the Neon dev branch was touched (`pg_stat_statements` install + reset).
- Query-shape refactors beyond the top 10 are deferred — Phase 2 can surface more after the headline fixes land and the ranking re-stabilises.
