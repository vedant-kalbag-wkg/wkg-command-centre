# Commission, Experiments, and Actions Dashboards — Logic & Audit

Scope: `src/app/(app)/analytics/commission/`, `src/app/(app)/analytics/experiments/`, `src/app/(app)/analytics/actions-dashboard/`.

Reviewed against:
- `src/lib/commission/processor.ts`, `src/lib/commission/engine.ts`
- `src/lib/analytics/queries/experiments.ts`
- `src/lib/analytics/queries/shared.ts`
- `src/lib/analytics/active-locations.ts`
- `src/lib/analytics/metrics.ts`
- `src/db/schema.ts` (commissionLedger, experimentCohorts, locationFlags, actionItems)
- `src/app/(app)/analytics/flags/actions.ts`, `src/components/analytics/flag-dialog.tsx`, `src/components/analytics/create-action-dialog.tsx`

---

# Commission Dashboard — Logic & Audit

Source: `src/app/(app)/analytics/commission/page.tsx`, `actions.ts`. The dashboard reads exclusively from the `commission_ledger` table joined to `sales_records` and `locations`, applying global analytics filters via `buildCommissionWhere`.

## Section: KPI Cards (Total Commission / Commissionable Revenue / Avg Rate / Records with Commission)

### Logic

- **Total Commission** — `SUM(commission_ledger.commission_amount)` over rows where `is_reversal = false`. (page.tsx:151-161, actions.ts:95-104)
- **Commissionable Revenue** — `SUM(commission_ledger.commissionable_amount)` over rows where `is_reversal = false`.
  - **What "commissionable" actually means:** `commissionable_amount = grossAmount` passed to `calculateCommission` (engine.ts:100). In `processor.ts:235`, the value passed as `grossAmount` is the booking-fee row's `netAmount` (i.e. WKG's fee revenue, NOT hotel sales). So "Commissionable Revenue" is NOT the underlying transaction revenue — it is the WKG-collected fee that drove the commission calc. The label "Commissionable Revenue" is misleading: it does not represent hotel sales/turnover.
- **Average Rate** — `(totalCommission / totalCommissionable) * 100`, with a `> 0` guard returning 0 (actions.ts:109-111). Returned to UI which formats as `"X.XX%"`.
- **Records with Commission** — `COUNT(*)` over `commission_ledger` rows where `is_reversal = false`.
- **Deltas** — same query is run for previous period (computed by `getPreviousPeriodDates` — same-length window immediately before `dateFrom`); deltas are pct change for commission/commissionable/recordCount and a raw percentage-point delta for `avgRate`.
- WHERE clause is: `dateCondition` (sales_records.transaction_date), outletExclusions (`buildExclusionCondition`, joined via `salesRecords.locationId = locations.id`), and dimension filters from `buildDimensionFilters` (productIds, hotelIds, hotelGroupIds, regionIds, locationGroupIds, locationTypes).

### Issues

**P0 — Reversal nets out commission but NOT commissionable amount or record count, double-counting both after any recalculation**
- File: `src/app/(app)/analytics/commission/actions.ts:97-104` and `src/lib/commission/processor.ts:339-356`
- Repro: As soon as an admin runs `triggerRecalculation` (commission/actions.ts:264) for any (locationProduct, month), the processor inserts a `is_reversal=true` row whose `commissionAmount = -original` but whose `commissionableAmount = +original` (processor.ts:343-344 copies `commissionableAmount` unchanged), then inserts a fresh `is_reversal=false` row from the recalc. The dashboard filter `eq(commissionLedger.isReversal, false)` (actions.ts:104, 127, 174, 213, 249) **excludes the negative reversal entirely**.
  - Net effect on KPI:
    - `totalCommission` → counts ORIGINAL + RECALCULATED (overstates, since the original should have been netted out).
    - `totalCommissionable` → counts ORIGINAL + RECALCULATED (overstates by ~2x for that month).
    - `recordCount` → counts BOTH non-reversal rows (overstates by 2x, every recalc doubles the visible "records").
    - `avgRate` → ratio is approximately preserved if both halves scale together, but tier breakpoints at the recalc may move it.
  - This is a financial misrepresentation. Anyone running a triggerRecalculation will inflate commissionable revenue and record counts without realising it. A "reversal" by design should null out the original entry; instead the dashboard's filter contract treats `is_reversal` as a row tag rather than a sign-flag.
- Fix options: (a) Delete the original ledger row when recalculating instead of marking `is_reversal=true`, (b) Make the dashboard NET reversals — i.e. SUM(commissionAmount) WHERE TRUE without filtering reversals (but reversal rows have positive `commissionableAmount`, so still need a sign-aware sum), (c) Insert reversal with negative `commissionableAmount` AND negative `recordCount`-implication.
- Verification: `SELECT sales_record_id, COUNT(*) FROM commission_ledger WHERE is_reversal=false GROUP BY 1 HAVING COUNT(*) > 1` will surface every duplicated sales record after a recalc.

**P0 — Commission queries do NOT apply user scoping (`scopedSalesCondition`)**
- File: `src/app/(app)/analytics/commission/actions.ts:70-82` (`buildCommissionWhere`) and all four fetch functions (88, 156, 196, 233)
- Repro: A non-admin user (regional manager scoped to e.g. UK) opens the Commission dashboard. There is no call to `scopedSalesCondition` (compare to `experiments.ts:38-42` and `portfolio.ts`). The user sees commission across the entire portfolio.
- This is a data-leak-grade bug: commission numbers are commercially sensitive (they leak WKG's revenue from competitors' hotel groups). Compare with experiments where scoping IS applied (queries/experiments.ts:38).

**P1 — Commission queries ignore `metricMode` filter**
- File: `actions.ts:70-82`. `buildCommissionWhere` does not call `buildMetricModeCondition`.
- Repro: User toggles "Revenue mode" in the analytics filter store. Portfolio/Heatmap pages start filtering to fee rows only; commission dashboard ignores the toggle. Because the commission ledger is already keyed off booking-fee rows in the processor, this is partly defensible — commissionable rows are by construction fee rows. But nothing prevents a user from setting `metricMode='sales'` and expecting consistent semantics across dashboards. Document it or ignore the filter explicitly.

**P1 — Commission queries do NOT apply the maturity-bucket filter**
- File: `actions.ts:70-82`. `buildMaturityCondition` is not used; only date + exclusion + dimension filters are applied.
- Repro: Set maturity bucket to `0-1mo`. Portfolio shows new-kiosk numbers; Commission shows everything. The two dashboards become incomparable.

**P1 — `buildDateCondition` filters on `salesRecords.transactionDate` but the ledger has its own `calculatedAt` semantics**
- File: `shared.ts:32-34`. `buildDateCondition` filters by `sales_records.transaction_date`. That is correct — commission belongs to the date of the sale. But the joined `commissionLedger.calculatedAt` is independent and can drift (especially after recalcs that happen weeks later). The dashboard exposes the user to a confusing scenario: a recalc that happens today changes the totals for a month-old date range. This is unintuitive but probably correct; documentation in the UI that says "as-of latest calculation" would help. Not a logic bug, but worth surfacing.

**P2 — Division-by-zero edge cases**
- File: `actions.ts:109-111`, `132-134`, `186`, `224`. All `commissionable > 0` checks return `0` (not `null`/`N/A`) when there is no commissionable revenue, so the UI displays `"0.00%"`. For Avg Rate that's fine. For per-location and per-product effective rates, "0.00%" is misleading when a location/product simply has no fee rows in window — UI should show `—` or `N/A`. (page.tsx:225, 259 always render `.toFixed(2)%`.)

**P2 — Hardcoded GBP / `formatCurrency` ignores AU region**
- File: `page.tsx` uses `formatCurrency` from `@/lib/analytics/formatters`. With AU region introduced (commit c2a5cfe), commission values for AU-scoped users will display GBP symbol if the formatter is locale-fixed. Verify against shared formatter — out of scope for this audit but flag it.

**P3 — `Records with Commission` label is ambiguous**
- File: `page.tsx:187`. Label means "ledger rows that produced commission > 0", but actually it counts all non-reversal rows whether commission is zero or not (no `commissionAmount > 0` filter). Combined with the P0 above, this metric is borderline meaningless after any recalculation.

---

## Section: By Location (table)

### Logic

- File: `page.tsx:200-232`, `actions.ts:156-190`
- `SELECT locationId, locationName, SUM(commissionable), SUM(commission), COUNT(*) FROM commission_ledger JOIN sales_records JOIN locations WHERE buildCommissionWhere AND is_reversal=false GROUP BY location ORDER BY SUM(commission) DESC`
- `effectiveRate = commissionable > 0 ? (commission / commissionable) * 100 : 0`.
- No LIMIT — the table renders every location with any commission entry.

### Issues

**P0 — Same reversal-counting bug as KPI cards**
- File: `actions.ts:174`. After a recalc, a location's commissionable, commission, and recordCount all double. `effectiveRate` is approximately preserved, but `recordCount` and absolute totals are wrong.

**P1 — No row limit; can render thousands of rows**
- File: `page.tsx:208-231`, `actions.ts:163-176`. The query has no `LIMIT`. With ~2k locations across an unconstrained portfolio, this serializes the full set to the client (and renders all DOM rows). At the very least add pagination/virtualization.

**P2 — Sort key vulnerable to nulls; orders by raw SUM not delta**
- `ORDER BY sum(commission_amount) DESC` — fine. But after a reversal-only month for a location, the sum could be 0 yet the row still surfaces because `recordCount > 0`.

**P2 — `effectiveRate=0` rendered as `"0.00%"` instead of `"—"`**
- See KPI section P2.

---

## Section: By Product (table)

### Logic

- File: `page.tsx:235-265`, `actions.ts:196-227`
- Group by `products.id, products.name`. SUM of commissionable + commission. effectiveRate same formula.
- WHERE includes the same `is_reversal=false` filter.

### Issues

**P0 — Same reversal double-count bug** (actions.ts:213).

**P1 — `productName` uniqueness depends on products.name, not id**
- File: `actions.ts:205, 214`. Group key uses `products.id, products.name` but the React row key is `row.productName` (page.tsx:255). If two products share a name, they'd be merged on the client (React `key` collision). Use `productId` as key.

**P2 — Product table has no fee-row filter**
- All other product reports (Top Products) explicitly call `buildNonFeeCondition` because "Booking Fee" and "Cash Handling Fee" are not products. Commission ledger only contains booking-fee-derived entries, so the WHERE-side semantic is inverted: every row IS a fee row. But the JOIN to `products` will resolve to the actual product whose fee was charged, so this is probably OK. Worth a comment in the code.

---

## Section: Monthly Trend (bar chart)

### Logic

- File: `page.tsx:267-294`, `actions.ts:233-258`
- `SELECT to_char(transactionDate, 'YYYY-MM') AS month, SUM(commissionAmount), SUM(commissionableAmount) GROUP BY month ORDER BY month`
- All filtered with `is_reversal = false`.

### Issues

**P0 — Same reversal double-count.**

**P1 — Partial first/last month rendered as full month → spurious dips**
- File: `actions.ts:240-251`. The query buckets by `to_char(transactionDate, 'YYYY-MM')` with no partial-month flagging. If `dateFrom = '2026-04-15'` and `dateTo = '2026-04-25'`, the chart shows a single bar for "2026-04" containing only ~10 days — visually compared to a full month elsewhere it looks like a collapse. UI shows no warning, no dotted bar, no truncation indicator.
- Fix: either (a) snap the date range to month boundaries for this chart, (b) split partial buckets into a separate visual indicator, or (c) annotate the first/last bar in the tooltip.

**P2 — Sort key `to_char(...)` works for YYYY-MM but lexicographic only because of zero-padding**
- This is fine since `to_char` zero-pads, but worth flagging as a footgun if anyone changes the format.

**P2 — Bar chart loses the commissionable series**
- File: `page.tsx:291`. Only `commission` is rendered as a bar. `commissionable` is fetched but unused. Either render a second series or drop the column from the SELECT.

---

# Experiments Dashboard — Logic & Audit

Source: `src/app/(app)/analytics/experiments/page.tsx`, `actions.ts`, `cohort-form.tsx`. Backend in `src/lib/analytics/queries/experiments.ts`. Storage table: `experiment_cohorts`.

## Section: Cohort List (left panel) and Create Cohort form

### Logic

- File: `page.tsx:280-332`, `actions.ts:57-155`, `cohort-form.tsx`
- `listCohorts()` returns all cohorts for admins, only `createdBy = me` for non-admins (actions.ts:60-70).
- `listLocationsForPicker()` returns ALL locations sorted by name, no scope filter, no exclusion filter (actions.ts:78-87).
- `createCohort` writes to `experiment_cohorts` and audit-logs (actions.ts:96-129).
- `deleteCohort` hard-deletes (actions.ts:134-155).
- Form modes: `rest_of_portfolio`, `named_control`, `similar_hotels` (similar_hotels collapses to `named_control` with auto-populated IDs).
- "Find Similar Hotels" calls `findSimilarLocations` (queries/experiments.ts:137): cohort avg numRooms ±max(30%, 20 rooms), avg revenue/location ±40%, returns up to 10 IDs. Excludes cohort locations.

### Issues

**P1 — `listLocationsForPicker` ignores user scope and exclusions**
- File: `actions.ts:78-87`. Returns every location in the DB. A regional user can pick locations outside their region (and create cohorts containing them). The cohort then renders for them via `getCohortMetrics` which DOES apply `scopedSalesCondition` — meaning the cohort shows zeros for locations the user can't see, silently. UX-wise the user thinks they have a 5-location cohort but only sees 2 locations of data. Should either filter the picker to scoped locations, or warn at submit time.

**P1 — Excluded outlets (test/staff) appear in the picker**
- File: same. The picker doesn't apply `outletExclusions`. A user can build a cohort containing "TEST_HOTEL" and never know it's a no-op.

**P1 — No deduplication when a location belongs to multiple cohorts**
- A location can appear in cohort A and cohort B. There is no warning, and revenue is attributed independently to each (which is fine for analysis but means experiments are not orthogonal). Surface this in the UI ("3 locations in this cohort are also in: Cohort X, Cohort Y").

**P2 — Archived locations stay in cohort**
- File: `actions.ts:96-129`. Cohort `locationIds` is a JSONB blob; if a location is later archived (added to `outletExclusions` or kiosks unassigned), the cohort still references it. `getCohortMetrics` filters via `buildActiveLocationCondition` (queries/experiments.ts:41) so the archived location's data is silently dropped. Cohort displays as "5 locations" but only 3 contribute. UI should flag this.

**P2 — No validation that `controlLocationIds` is non-empty for `named_control`**
- File: `actions.ts:96-117`. If user submits `controlType='named_control'` with no `controlLocationIds`, `getCohortMetrics([])` returns `{revenue: 0, transactions: 0, avgRevenue: 0}` (queries/experiments.ts:32-34). The dashboard then shows control = 0 and delta = cohort - 0 = cohort, misleading the user into thinking the cohort dramatically outperformed. Form should require ≥1 control location.

**P2 — Race in `setSelectedId` after delete**
- File: `page.tsx:256-263`. `cohorts.find((c) => c.id !== id)` is computed against the pre-filter array, so on delete of the currently-selected cohort the next selection is the FIRST id in the original array (could be the just-deleted one's preceding cohort or the cohort itself if `find` matches first). Minor.

**P3 — `findSimilarHotels` button ignores already-selected control locations**
- File: `cohort-form.tsx:75-85`. Switching to `similar_hotels` overwrites any manual selection, then switching back to `named_control` keeps those auto-populated IDs (controlMode flips but controlLocationIds is unchanged). Confusing.

**P3 — Cohort name uniqueness not enforced**
- Two cohorts with the same name show identically in the list with no disambiguation.

---

## Section: Temporal Analysis (4-card grid: Pre / During / YoY Pre / YoY During)

### Logic

- File: `page.tsx:368-389`, `actions.ts:241-262`, `queries/experiments.ts:225-294`
- Pre period: 30 days BEFORE `interventionDate` (`interventionDate - 30 days` to `interventionDate - 1 day`). Hardcoded.
- During period: `interventionDate` to `interventionDate + 30 days`. Hardcoded.
- YoY Pre / YoY During: same windows shifted -1 year via `getComparisonDates(..., "yoy")` which calls `setFullYear(getFullYear() - 1)` (metrics.ts:35-44).
- Each window is fetched via `getCohortMetrics(locationIds, {dateFrom, dateTo}, userCtx)` — no metricMode, no maturity, no dimension filters.
- UI renders `revChange` (% change During vs Pre, YoY During vs YoY Pre). No statistical-significance test.

### Issues

**P0 — Temporal Analysis ignores the global filter store entirely except `dateFrom`/`dateTo` from a fixed window**
- File: `queries/experiments.ts:262-265`. `getCohortMetrics` is called with `{ dateFrom: preFromStr, dateTo: preToStr }` — a NEW filters object containing ONLY date strings. `metricMode`, `maturityBuckets`, `productIds`, `hotelGroupIds`, `regionIds`, `locationGroupIds`, `locationTypes` from the global filter store are **all dropped**.
- Repro:
  1. User has Revenue mode (fees only) selected globally.
  2. User selects a cohort with `interventionDate=2026-03-01`.
  3. The "Cohort vs Control" cards (below) correctly use Revenue mode.
  4. The "Temporal Analysis" cards use ALL transactions including hotel sales — different denominator, looks ~10x larger.
- Same effect with productIds: filtering to "Coffee" globally still shows total cohort revenue across all products in the temporal grid.
- This is silent and undocumented. Either propagate the full filter state into temporal calls, or surface in the UI which filters are NOT applied.

**P1 — Pre/During hardcoded at 30 days; not user-configurable, not stated**
- File: `queries/experiments.ts:232-246`. Fixed 30-day windows. The UI label says "Pre (30d before)" and "During (30d after)" (queries/experiments.ts:271, 277), so it's at least disclosed in the card title, but the user has no way to change it. Compare to interventions like a marketing campaign that might run for 60 days.
- Recommend: add a "Window length" input to the cohort or to the page filter.

**P1 — Date arithmetic uses `new Date(interventionDate)` which parses ISO date strings as UTC and emits with local TZ slip**
- File: `queries/experiments.ts:230, 233, 235, 239, 240`. `new Date('2026-03-01')` is 00:00 UTC. Calling `setDate(...-30)` then `toISOString().split('T')[0]` returns the UTC day, not the local day. For users east of UTC this can shift the boundary by 1 day. Pre/During become 29-or-31 days depending on DST and user TZ.
- Repro: server in UTC+10, intervention `2026-03-01`. `new Date('2026-03-01')` = 2026-03-01 00:00 UTC = 2026-03-01 10:00 local. `setDate(date - 30)` then `toISOString().split('T')[0]` = same date as if computed UTC-side. Probably fine on a UTC-running server; but `setDate` mutates in place and shifts month boundaries differently. Use a date-only library or build the strings directly with month/day arithmetic.

**P1 — `setFullYear(currentYear - 1)` on Feb 29 silently drops to Feb 28 / Mar 1**
- File: `metrics.ts:38-39`. `new Date('2024-02-29').setFullYear(2023)` produces March 1, 2023 in some implementations, Feb 28 in others. Predictable on V8 (clamps to Feb 28) but undocumented. For a cohort with interventionDate Feb 29, YoY periods are silently off-by-one-day on each side. Same edge case will hit any 2026 cohort with intervention dates in early March that compare to 2025 leap-day Feb 29.

**P1 — During period extends 30 days into the FUTURE relative to interventionDate**
- File: `queries/experiments.ts:239-241`. `duringTo = intervention + 30 days`. If `interventionDate = today`, then `duringTo` is in the future. The query returns whatever transactions exist (likely zero), and the user sees "During" as 0 with -100% change vs Pre, panicking that the intervention killed revenue.
- Fix: clamp `duringTo` to `MIN(interventionDate + 30, today)`, and surface the partial-window status in the card title.

**P1 — During period vs Pre period assumed equal length, but during can be partial**
- Same as above. The `revChange` % at page.tsx:111 compares During.revenue to Pre.revenue raw. If During is only 5 days into a 30-day window, the comparison is meaningless.

**P2 — No active-location / scope check on YoY periods that fall outside the user's data window**
- If the cohort was created in 2025 and the YoY period is 2024 (before the user's data exists), `getCohortMetrics` returns 0 silently. UI should show "No data for this period."

**P2 — `revChange` uses Pre as baseline; no consideration of seasonality**
- File: `page.tsx:99-101, 111`. Comparing During (e.g. May) to Pre (e.g. April) is naive — May might be seasonally bigger. The YoY pair attempts to control for this but the UI doesn't compute the "diff-in-diff" (During%change - YoYDuring%change). Users have to eyeball it.

**P2 — `transactions` shown alongside revenue but no commentary on refund interaction**
- The cohort revenue includes refund rows (sales_records doesn't filter reversals; salesRecords.netAmount can be negative for refunds). If the intervention reduces refunds, the transaction count drops while revenue rises — which a user might misinterpret as "fewer customers but higher spend."

---

## Section: Cohort vs Control (3-card grid: Revenue / Transactions / Avg Rev/Txn)

### Logic

- File: `page.tsx:391-425`, `actions.ts:164-206`, `queries/experiments.ts:27-131`
- Cohort: `getCohortMetrics(cohort.locationIds, filters, ctx)`. `filters` here IS the full global filter (passed through from `fetchCohortComparison(cohortId, filters)`).
- Control:
  - `named_control`: `getCohortMetrics(cohort.controlLocationIds, filters, ctx)`.
  - `rest_of_portfolio`: `getRestOfPortfolioMetrics(cohort.locationIds, filters, ctx)` — adds `salesRecords.locationId NOT IN (...)` to the where clause.
- Both functions apply: scope, active-locations, date, maturity, metricMode, dimension filters.
- delta = `cohortMetrics - controlMetrics` (raw absolute, NOT normalized per-location).

### Issues

**P0 — Delta is RAW (not per-location); `rest_of_portfolio` makes the comparison meaningless**
- File: `actions.ts:198-203`. `delta.revenue = cohort.revenue - control.revenue`. With `rest_of_portfolio`, control is potentially 1000+ locations and cohort is 5. The "delta" will always be a massive negative number (cohort tiny, control huge). The UI shows it as a red "-£X" without any normalization.
- The `avgRevenue` card is similarly flawed: cohort.avgRev = totalRev / totalTxns, control.avgRev = same. These are at least comparable (both are per-transaction averages), so this card is OK. But the Revenue and Transactions cards are NOT comparable as raw deltas.
- Fix: divide both by `numLocations` to get revenue-per-location, or by `numKiosks` for revenue-per-kiosk. At minimum, add a tooltip explaining what the delta represents.

**P1 — `named_control` with empty `controlLocationIds` returns zero-everything**
- File: `queries/experiments.ts:32-34`. `if (locationIds.length === 0) return { revenue: 0, transactions: 0, avgRevenue: 0 }`. Cohort form doesn't enforce ≥1 control (see Cohort List P2). Result: delta = cohort - 0 = cohort revenue, displayed as a giant green number. User thinks intervention worked; in reality there is no control.
- Fix: throw / show error if named_control has empty ids.

**P1 — Cohort/control overlap silently allowed**
- File: `actions.ts:186-196`. If `named_control` and the cohort share a location, that location's revenue is in BOTH numerator and denominator. No dedup check. Form should reject overlap; query should at minimum strip cohort IDs from controlIds.

**P1 — `rest_of_portfolio` doesn't honour the user's scope shape correctly when the user has scope ⊂ portfolio**
- File: `queries/experiments.ts:80-131`. `getRestOfPortfolioMetrics` excludes the cohort's locationIds from the rest-of-portfolio set. But it doesn't exclude locations the user can't see (it relies on `scopedSalesCondition` to filter those out). For an admin (no scoping) this is fine. For a regional user whose scope is `EMEA only`, "rest of portfolio" means "EMEA minus cohort" — which may or may not be what the user expects (probably they expected the full portfolio comparison, not just their region). The control set silently shrinks. Document this or expose a "Use full portfolio" toggle.

**P2 — `findSimilarLocations` revenue/room thresholds are hardcoded magic numbers**
- File: `queries/experiments.ts:179-186`: `roomMargin = max(30%, 20)`, revenue = `±40%`. No explanation in code, no UI control. Different industries/portfolios may need different bounds.

**P2 — `findSimilarLocations` ignores cohorts that share `numRooms IS NULL`**
- File: `queries/experiments.ts:207`. Filters `numRooms IS NOT NULL`. Locations with unknown room counts (probably "shop" or "venue" location types) are silently excluded from candidate set, but the COHORT's average is computed over `COALESCE(AVG(numRooms), 0)` — if all cohort locations have numRooms=NULL, avgRooms=0 and the bound becomes `[0, 20]`, producing a candidate set of micro-locations only.

**P2 — `findSimilarLocations` returns 10 max but no jitter / no diversity**
- Locations are returned in implicit DB order. Two runs return the same set. If you'd like comparable cohorts to be "uncorrelated" you'd want randomization. Out of scope for current product but flag.

---

# Actions Dashboard — Logic & Audit

Source: `src/app/(app)/analytics/actions-dashboard/page.tsx`, `actions.ts`. Storage: `action_items` table. Linked entity: `location_flags` (separate table; see flags/actions.ts).

## Section: Filter Tabs (status + type)

### Logic

- File: `page.tsx:31-46, 132-163`
- Status tabs: All / Open / In Progress / Resolved / Cancelled (page.tsx:31-37). Single-select.
- Type select: All / Investigation / Relocation / Training / Equipment Change (page.tsx:39-45).
- Both feed `listActionItems(filters)` which builds `eq()` conditions on status + actionType + ownerId (actions.ts:43-53).

### Issues

**P2 — No "Mine only" filter**
- The schema has `ownerId` and the query supports it (actions.ts:51), but the UI exposes no toggle for "show items assigned to me." On a portfolio with 200 actions, the operator is forced to scan all of them.

**P2 — No location filter on the Actions page**
- File: page.tsx has no location filter widget despite the table showing a Location column. If a regional user wants to see only their region's actions, they can't filter to one location. Note: the global analytics filter store IS accessible here but is not used by `listActionItems` (actions.ts:43-53).

**P2 — Filter changes trigger a full reload**
- File: `page.tsx:89-92`. Changing status or type re-runs `listActionItems` which re-runs the user join. No client-side filtering on already-fetched data. Minor perf nit.

**P3 — Status states are flat; no state-machine enforcement**
- File: schema.ts:920. `status` is an enum text column. Nothing prevents `resolved → open` regression. The audit log is preserved (actions.ts:201-210 logs each transition), but there's no constraint at the DB level. If business expects "resolved is terminal", enforce it in `updateActionItemStatus`.
- Also note: `updateActionItemStatus` always sets `resolvedAt = new Date()` when status flips to `resolved`, even if it was previously resolved and is being resolved again. So the resolvedAt timestamp leaks "last resolved" not "first resolved." Probably acceptable.

---

## Section: Actions Table

### Logic

- File: `page.tsx:165-316`, `actions.ts:34-101`
- Columns: Title (+description), Location, Type, Status (badge), Due Date, Created (date), Actions (status select + outcome notes).
- LEFT JOIN locations (so actionItems with `locationId IS NULL` still render). LEFT JOIN owner (user.name).
- Order by `createdAt` ASC (actions.ts:82) — oldest first.
- Inline resolve flow: status → "resolved" opens an inline outcome-notes textarea below the table; submit calls `updateActionItemStatus(id, "resolved", outcomeNotes)`.
- Open count in header (page.tsx:114) = items where status is `open` or `in_progress`.

### Issues

**P1 — `listActionItems` is called twice in `createActionItem` and `updateActionItemStatus` to "rejoin" the row**
- File: `actions.ts:148-149` and `212-213`. The full table query (joining locations + user) is run AFTER every mutation, just to find the single newly-mutated row (then `.find(i => i.id === row.id)`). On a large table this scans every row. Fix: query just the one row by id.

**P1 — Overdue items are not surfaced as overdue**
- File: `page.tsx:226-228`. `Due Date` cell renders the date string verbatim (or `—`). No comparison to today, no red badge for overdue. The header's `openCount` doesn't separate "open and overdue" from "open and on time." Major UX miss; table is supposed to drive triage but doesn't visually indicate urgency.

**P1 — Items with `locationId IS NULL` ("global" actions) are always visible regardless of location filter**
- File: `actions.ts:43-53`. There is no location filter on the dashboard at all (see Filter Tabs P2), so this is moot at the dashboard level. BUT — when this is added (and it should be), make sure NULL-locationId items are either always shown (correct global) or filtered out (incorrect — user expecting "show me UK actions only" will not see global ones, which may be relevant). Document the intended semantic.

**P1 — Order is `createdAt ASC` (oldest first)**
- File: `actions.ts:82`. Counterintuitive — operators expect newest-first. Older items linger at the top. If the design intent is "oldest open at top" to nudge resolution, document it; otherwise flip to DESC.

**P1 — `resolveAt` is stored on `actionItems` but never displayed**
- File: schema.ts:922 stores `resolvedAt`, page returns it (actions.ts:99), but UI doesn't show it. For resolved items, "resolved on YYYY-MM-DD" would be useful context.

**P2 — `flag → action_item` linkage is OPT-IN only; no auto-creation**
- File: `src/components/analytics/flag-dialog.tsx:117-127`. The flag dialog footer offers a "Create Action Instead" button alongside "Create Flag." This is an XOR — the user EITHER creates a flag OR creates an action. There is no path from "create flag → automatically open action_item with sourceType='flag', sourceId=<flagId>". A flag exists with no follow-up workflow.
- Also: when "Create Action Instead" is clicked, `sourceType="flag"` is passed but `sourceId` is NOT set (because the flag was never created). So the action item has `sourceType='flag'` with `sourceId=NULL` — broken referential semantics. (`createActionItem` accepts `sourceId` in actions.ts:118 but the call from flag-dialog.tsx:118-127 doesn't pass it.)
- Two fixes: (a) auto-create both flag and action when user opts in, with `sourceId = flagId`; (b) add a separate "Create Action from Flag" path on the Flags Dashboard.

**P2 — Flagged outlets are NOT auto-creating action items**
- See above. Confirmed by `flags/actions.ts:85-117` — `createFlag` only inserts into `location_flags`, never touches `action_items`. The Portfolio Outlet-Tiers and Heatmap dashboards expose `FlagDialog` (portfolio/outlet-tiers.tsx:161, heat-map/performance-table.tsx:193). Operations users can rack up dozens of flags with no triage queue to action them — defeats the "insight to action" workflow that schema.ts:905 documents.

**P2 — `locationName` shows `—` for null but description is line-clamped to 1**
- File: `page.tsx:206-209`. `description` rendered with `line-clamp-1` — for descriptions longer than ~50 chars the user sees only the first half and has no expand affordance. Add a hover-to-expand or a click-to-open detail view.

**P2 — `outcomeNotes` shown only for resolved items, in a single line, in the Actions cell**
- File: `page.tsx:257-261`. Cramming outcome into the "Actions" cell (where the status select otherwise lives) is awkward. A dedicated "Outcome" column or a "view detail" modal would be better.

**P2 — Inline resolve form takes over the table**
- File: `page.tsx:266-307`. When `resolvingId` is set, an extra `<TableRow colSpan={7}>` appears at the END of the body — not inline next to the row being resolved. User clicks "Resolve" on row 5, the form appears at row N (bottom). Disorienting. Either inline next to the actual row or use a Dialog.

**P3 — `updateActionItemStatus` uses `eq(actionItems.id, id)` without RLS / scope check**
- File: `actions.ts:193-197`. Any authenticated user can flip the status of any action item, regardless of scope or ownership. If non-admins are expected to manage only their own actions, enforce `actorId = ownerId OR createdBy` (or check role). Audit log records the actor (good), but there's no prevention.

**P3 — `createActionItem` doesn't validate `locationId` against scope**
- File: `actions.ts:110-167`. A regional user can create an action against a location they can't see. They never see it again (because the filter on the next page load may scope it out), but the row exists in the DB.

---

# Cross-section issues

**P0 — Reversal handling is fundamentally broken in the commission dashboard**
- The `is_reversal=false` filter is the wrong shape for the data model. Either the data model needs to soft-delete the original on recalc (cleanest), or the dashboard needs to net both halves (sign-aware sum). Until one of those happens, EVERY commission KPI on the dashboard is wrong by an unknown factor for any (locationProduct, month) that has been recalculated. Files: `commission/actions.ts:104, 127, 174, 213, 249`; `commission/processor.ts:339-356`.

**P0 — Commission queries are unscoped**
- Non-admin users see commission across the full portfolio. File: `commission/actions.ts:70-82`.

**P1 — Inconsistent application of global filters across dashboards**
- Commission ignores `metricMode` and `maturityBuckets`. Experiments Temporal Analysis ignores `metricMode`, `maturityBuckets`, AND all dimension filters. Experiments Cohort vs Control honours all filters. Three dashboards on the same screen, three different filter contracts. Users will see numbers that don't tie out and won't know why.
- Fix: define a single `applyAnalyticsFilters` policy (which filters are mandatory vs which are excluded) and document the rationale on each query.

**P1 — Date arithmetic in queries/experiments.ts uses JS Date which is UTC-based and TZ-fragile**
- All four temporal periods (pre/during/yoyPre/yoyDuring) build their date strings via `new Date(isoDate).setDate(...).toISOString().split('T')[0]`. This is fine on a UTC server but flaky on local-TZ deploys (and during DST). Use a date-only utility (already exists: `src/lib/analytics/formatters.ts:toLocalISODate` per metrics.ts:1).

**P1 — Cohort form picker exposes locations the user cannot see (or that are excluded)**
- File: `experiments/actions.ts:78-87`. Causes silent zeroes in `getCohortMetrics`.

**P1 — `flag → action` workflow is broken**
- `createFlag` does not create an `action_item`; the only path that does ("Create Action Instead" in the flag dialog) doesn't even create the flag. Net: flagged outlets pile up in `location_flags` with no triage queue, and the Actions Dashboard never sees them. This negates the entire "insight-to-action" pipeline that the schema (schema.ts:905-908) was designed to enable.

**P2 — No "Mine only" / location filter on Actions Dashboard despite supporting columns**
- Combined with the no-overdue-flag issue, the dashboard barely functions as a triage tool.

**P2 — `formatCurrency` in commission and experiments hardcodes GBP**
- File: `experiments/page.tsx:28-35`. `Intl.NumberFormat("en-GB", { currency: "GBP" })`. With AU region introduced in commit c2a5cfe, AU users see GBP symbols on numbers that are AUD. Cross-cuts the entire analytics surface — verify shared formatter handles region.

**P3 — `ChartCard` collapsible state is per-page; no session persistence**
- Minor UX nit. User collapses "Monthly Trend" each visit.

**P3 — Performance: every cohort-comparison fetch re-runs the full users join in `listActionItems`**
- `listActionItems` is called from inside `createActionItem` and `updateActionItemStatus` purely to denormalize one row. Outside the audit's primary scope but flagged.

---

## Summary of P0 / P1 counts

- **P0 (financial / data-leak / hard-broken)**: 4
  - Commission reversal double-counting (KPI + by-location + by-product + monthly)
  - Commission queries unscoped (data leak across regional managers)
  - Temporal Analysis ignores all global filters except date
  - Cohort vs Control raw-delta is meaningless for `rest_of_portfolio`
- **P1 (logic-broken or substantially misleading)**: ~16
- **P2 / P3**: many — see body.

The Commission dashboard is the highest-risk surface: it influences month-end reporting and any error has a direct $ implication. Recommend: (1) immediate fix of reversal handling, (2) immediate add of `scopedSalesCondition` to all four commission queries, (3) document the recalculation-induced double-counting until a fix ships.
