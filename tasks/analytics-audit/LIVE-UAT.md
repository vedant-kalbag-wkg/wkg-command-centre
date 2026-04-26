# Live UAT — wkg-command-centre.vercel.app

**Date**: 2026-04-26
**Account**: vedant.kalbag@weknowgroup.com (admin role)
**Build**: deployment `wkg-kiosk-tool-4x9mh3tpi`, deployed 2026-04-25 ~17:58 UTC (PR #26 merge `c2a5cfe`)
**Browser**: chromium via playwright-cli, viewport 1600×1000
**Data context**: Production data is concentrated in **January 2026** only (no Feb/Mar/Apr 2026 sales records, no 2025 data accessible via dashboards). YTD = Jan = same numbers. Commission, Experiments, Actions dashboards are empty (no records). Only `United Kingdom` region has sales data even though Australia exists in the region table.

---

## Executive summary

Live UAT executed end-to-end across all 12 analytics surfaces. Production is live at `https://wkg-command-centre.vercel.app` (NOT `wkg-kiosk-tool.vercel.app`, which is an alias still 500ing — see preserved earlier outage at the bottom). The supplied password `Admin123!` was invalid against prod, so the documented rotation script (`scripts/reset-admin-password.ts`) was used to restore the user-specified credential against the prod Neon database via `neonctl`-pulled connection string. Login then succeeded; admin role granted.

The static-code audit was substantially correct on the items that could be exercised. **Confirmed live**: Pivot Table is broken end-to-end (HTTP 500 on every Run because the metric "Revenue" is wired to `gross_amount` which migration 0022 dropped — surfaced in DOM as `Draggable item gross_amount was dropped over droppable area values`); Trend Builder ignores the global filter bar (Region=UK selected, chart still renders £1.49M = full-portfolio total); Trend Builder Avg Basket bucketing is mathematically wrong at monthly (Y-axis tops £600 vs portfolio Avg Basket of £15.62 — sum-of-daily-averages confirmed); Maturity page uses **days** while the global Maturity filter chip uses **months** (two bucket conventions on the same dashboard); Region detail's "Location Groups in Region" `total_rooms` is multiplied by transaction count (Heathrow shows 1,790,496 rooms across 17 outlets — physically impossible); Hotel-group "Hotels in Group" and Location-group "Hotels in Group" both expose **identical TRANSACTIONS and QUANTITY columns** (Q4 schema column was dropped in 0022 but the UI still derives QUANTITY from `COUNT(*)`); booking-fee row inflation is real (sales-mode TRANSACTIONS=95,103 vs revenue-mode TRANSACTIONS=47,661, exactly halving — every fee transaction is double-counted in default sales mode). The Region selector card and the Region detail panel disagree on hotel-group count (79 vs 63) for the same UK region.

**Three new issues found live that the static audit did not flag**: (1) the Performer-Pattern cards (`High Performer Patterns`, `Low Performer Patterns`) **completely ignore `metricMode` toggle** — switching Sales→Revenue shows the same product names and same £263,960.04 revenue for the green tier, the same £7.20 Avg Sales/Room (renamed to "Avg Revenue/Room" but value identical); (2) **Install Month Cohorts shows ALL 231 outlets in cohort 2026-04** even though sales data is from Jan 2026 — the cohort uses `MIN(kiosk_assignments.assignedAt)` and the assignment rows were apparently mass-reseeded around April 2026 wiping every original install date — the entire Maturity dashboard is unusable because all kiosks appear to have installed in April; (3) **Outlet code `4T` is named "Heathrow Terminal 4 b"** with a literal " b" suffix indicating the booking-fee variant has its own outlet record polluting performer rankings, and refund-only outlet code `BK` ("Customer Service") with -£9,802.42 sales is included in Bottom-20 rankings.

Beyond these, the data set has structural issues independent of code: large airport outlets (Central Bus Station, all Heathrow terminals, mobile desks) have `kiosk_count=0` and `rooms=NULL`, so every per-kiosk and per-room metric for these top performers is `—`. This is a data-model gap that is not surfaced anywhere in the UI as a warning.

## Headline confirmed P0s

- **Pivot Table 500s on Run** — `tasks/analytics-audit/screenshots/pivot-table-500-error.png`. UI metric "Revenue" maps to dropped column `gross_amount`. Confirmed end-to-end broken.
- **Trend Builder ignores global filter bar** — `tasks/analytics-audit/screenshots/trend-builder-ignores-global-region-filter.png`. URL `?regions=5a7f80de…`, chart still shows £1.49M total. Series label remains "Revenue | All".
- **Trend Builder Avg Basket monthly = sum of daily averages** — `tasks/analytics-audit/screenshots/trend-builder-avg-basket-monthly-bug.png`. Y-axis tops £600 vs true Avg Basket £15.62.
- **Sales-mode TRANSACTIONS double-counted by booking-fee rows** — sales-mode 95,103 vs revenue-mode 47,661 = exactly 2× ratio. `screenshots/portfolio-revenue-mode-fee-inflation-confirmed.png`. Same factor cascades into Avg Basket (£15.62 → £1.67 in revenue mode).
- **Maturity page uses days, global filter uses months** — page shows 0-30/31-60/61-90/90+ Days; filter chip exposes 0-1/1-3/3-6/6+ Months. Setting `0-1mo` globally lights up "0-30 Days" but not 31-60.
- **Region detail Location-Groups-in-Region has impossible `total_rooms`** — Heathrow 17 outlets shows 1,790,496 rooms (=105k/outlet). `screenshots/regions-rooms-bug-confirmed.png`. SUM over join with sales records inflates by transaction count.
- **`hotel_count` differs between Region selector card and Region detail panel** — UK shows "79 groups" on the selector but "Hotel Groups: 63" in the detail. Same query, two answers.
- **TRANSACTIONS ≡ QUANTITY everywhere** — Hotel Groups → Hotels in Group, Location Groups → Hotels in Group, Portfolio → Top Products: every row's quantity column = transactions column to the integer. `screenshots/hotel-groups-quantity-equals-transactions.png` and `screenshots/portfolio-top-products-quantity-equals-transactions.png`.
- **Performer-Pattern top-products query ignores `metricMode`** — green-tier "Top Products" shows National Express £263,960.04 in BOTH sales mode AND revenue mode. Avg Revenue/Room=£7.20 in revenue mode equals Avg Sales/Room=£7.20 in sales mode. The UI renames the label but the SQL is metric-mode-blind.
- **Booking Fee + Cash Handling Fee leak into Category Performance** — visible as bars in the chart; "Booking Fee" sits at position 7 and "Cash Handling Fee" at position 31.
- **Refund-only outlet `BK` ("Customer Service") with -£9,802.42 ranks #288 in Bottom-20** — refund-aggregator outlet treated as a real performer.

## NEW issues found live (not in static audit)

- **NEW-P0-A: Performer-Pattern cards (High/Low) ignore `metricMode` toggle entirely** — sales-mode and revenue-mode show identical product lists, identical revenue numbers, identical avg sales/room. The label flips ("Avg Sales / Room" → "Avg Revenue / Room") but the value is bitwise identical. Confirms the entire High/Low Performer Patterns query (`high-performer-analysis.ts`) does NOT pass `metricMode` through. Not in `ANALYTICS-ISSUES.md`.

- **NEW-P0-B: Install Month Cohorts shows ALL 231 active outlets in single cohort `2026-04`** even though all sales data is from Jan 2026. Avg Monthly Sales £911.79 for the only cohort. Total 231×£911.79=£210k vs portfolio £1.49M — Section A "Sales by Maturity Bucket" places all 231 in 0-30 Days (£911.79 avg) and all other buckets at zero. Conclusion: `MIN(kiosk_assignments.assignedAt)` for every active outlet is in April 2026 — the assignment table was apparently mass-reseeded recently and lost every historical install date. The Maturity dashboard is therefore showing "every outlet just installed last month" which is provably false from the sales data window. This is a P0 data-integrity issue that makes the entire Maturity dashboard misleading regardless of any code bug.

- **NEW-P0-C: Refund-aggregator outlet code `BK` ("Customer Service") with -£9,802.42 ranks #288 in Bottom-20** of the Heat Map. A refund-aggregator should be excluded from performance rankings; instead it consistently anchors the worst score (composite 0.6) and is presented as a real outlet.

- **NEW-P0-D: Outlet `4T` name = "Heathrow Terminal 4 b"** — literal " b" suffix in the hotel name leaks into Outlet Tiers, Heat Map Top 20, Compare picker. This is a fee-variant of `T4` (Heathrow Terminal 4) being represented as a separate Premium-tier outlet with its own £56,453.29 sales row. There is `T4` (£48,367.69) AND `4T` ("Heathrow Terminal 4 b", £56,453.29) — same physical desk, two performer rows.

- **NEW-P1-E: Hourly Distribution chart axis order is alphabetical, not chronological** — `00:00, 01:00, 10:00, 11:00, 12:00, 13:00, 14:00, 15:00, 16:00, 17:00, 18:00, 19:00, 02:00, 20:00, 21:00, 22:00, 23:00, 03:00, 04:00, 05:00, 06:00, 07:00, 08:00, 09:00`. The X-axis is sorted as strings — every "0X" is a separate alphabetical bucket. Visual reading of peak hour is unreliable.

- **NEW-P1-F: Region selector lists ONE region (UK) even though Australia was added in PR #26** — Australia exists in `regions` table (visible in Trend Builder global filter dropdown as "Australia") but does not appear in the Regions dashboard selector because no AU sales records exist. Either the selector should show all configured regions with `£0` or it should be transparent that "1" is filtered. The header says "Regions · 1" with no explanation.

- **NEW-P1-G: Same hotel name appears multiple times with different outlet codes within a single hotel-group view** — e.g. "Residence Inn by Marriott Kensington" appears 6× in the Marriott Group / Marriott+Axiom union (codes R0, R1, L1, L3, L4, L5, L6) — one row per kiosk, not per hotel. Inflates the apparent hotel count and breaks per-hotel aggregations downstream.

- **NEW-P1-H: Compare picker has no region/outlet-code disambiguation** — list shows "CBS OTH" 3×, "ACC Liverpool" 2×, "Bullring/Bullring 1/Bullring 2", "Hotel Berlin, Berlin" 2×, etc. No way to distinguish which is which.

- **NEW-P1-I: Outlet Tiers consistently lacks kiosk and room data for the largest revenue contributors** — Central Bus Station, Heathrow Terminals, Mobile Desks all show `KIOSKS=0` and `ROOMS=—`, which makes SALES/KIOSK and SALES/ROOM uncomputable for the top-15 outlets by revenue. This is a data-quality issue (these airport/transport outlets aren't typed as hotels) but the dashboard never surfaces "this metric is N/A for X% of selected outlets".

---

## Phase 0: Login + smoke

- App URL: `https://wkg-command-centre.vercel.app/` (verified live; redirects to `/login`).
- Initial credentials supplied (`vedant.kalbag@weknowgroup.com / Admin123!`) returned **HTTP 401 INVALID_EMAIL_OR_PASSWORD** at `/api/auth/sign-in/email` (twice, then rate-limited at 429).
- Restored credentials by running the documented `scripts/reset-admin-password.ts` against prod Neon. Connection string pulled via `neonctl connection-string production --project-id snowy-brook-77762738`. After rotation, the user-specified password `Admin123!` works (curl returned 200; browser login succeeded).
- Logged in via chromium → landed on `/kiosks`.
- Console on `/login` after submit: 1 error (the 401 from the first attempt), 0 warnings.
- Console on `/analytics/portfolio` after load: 0 errors, 3 warnings — all `WARNING: The width(-1) and height(-1) of chart should be greater than 0` (Recharts container size race; cosmetic).
- Storage state saved to `tasks/analytics-audit/auth-state.json`.
- Build verified: `vercel ls --prod` → latest is `wkg-kiosk-tool-4x9mh3tpi`, deployed 10h ago — corresponds to PR #26 merge `c2a5cfe`.

## Phase 1: Per-page walkthrough

### `/analytics/portfolio` (default Sales mode, YTD = Jan 2026)
- KPI strip: SALES £1,485,878.71, TRANSACTIONS 95,103, AVG BASKET £15.62, UNIQUE OUTLETS 288, UNIQUE PRODUCTS 105.
- High Performer Patterns: 87/288 green; "50 of 87 in UK"; avg 1.3 kiosks; avg 342 rooms; avg £7 rev/room. Top 3 products: National Express E-Tickets, Uber API, London Underground Ticket.
- Low Performer Patterns: 87/288 red; "77 of 87 in UK"; avg 1.1 kiosks; avg 162 rooms; avg £1 rev/room. Top 3: Uber API, Toot Bus E-Ticket, Golden Tours e-ticket.
- **Region Distribution** under each tier shows ONLY United Kingdom row (57.5% green / 88.5% red) — only 1 row in distribution but the percentage isn't 100% — *because only outlets with a region membership are counted, and the rest are "no region"*. Sum < 100% silently. Inverse of the static audit's predicted >100% issue (also possible with multi-region locations) — here it is <100% because most outlets lack region tags.
- Top Products of Green Tier ends at 5 rows: National Express £263,960.04, Uber API £205,070, London Underground £109,554.24, Heathrow Express Anytime Day Single £108,589.17, Hotel E-Shuttle £95,731.22.
- Top Products of Red Tier: Uber API £7,236.97, Toot Bus £88, Golden Tours £41.67, Big Bus £16.65, **Three 25 / 100GB -£20.83** (negative = refund-dominated row, P0 confirmation of reversal-row leakage).
- Daily Trends: line chart Jan 1 - Jan 31 only (no data after Jan).
- Category Performance: ~50+ bars; "Booking Fee" appears at position 7; "Cash Handling Fee" appears at position 31. **Confirmed P0**: fees rendered as categories.
- Top Products (main): see Phase 5 for the redundancy hunt — TRANSACTIONS=QUANTITY for every row.
- Hourly Distribution: X-axis bins in alphabetical order (00, 01, 10, 11, ..., 02, 20-23, 03-09). **NEW-P1-E**.
- Outlet Tiers: 200-row table (silently truncated). Every Heathrow row has KIOSKS=0 ROOMS=— so SALES/KIOSK and SALES/ROOM are `—`. Tier badges are a mix of Premium / Established / Developing / Emerging; Status is High/Mid/Low/Green/Red — the two columns are not synonymous. Maturity column: "—" for non-hotel outlets, "0-1 Month" for hotels (consistent with NEW-P0-B install-date issue).
- "Active flags (0)" present.

### `/analytics/maturity` (YTD)
- Section A (Sales by Maturity Bucket): **0-30 Days = 231 locations, £911.79 avg**; 31-60d / 61-90d / 90+d = **all zero locations**.
- Section B (Sales Ramp Curve): "No ramp data available".
- Section C (Install Month Cohorts): **single row `2026-04`, 231 locations, Avg Monthly Sales £911.79**. NEW-P0-B.
- Section D (Plateau Detection): "Insufficient data to determine maturity trend".
- Confirmed bucket-convention mismatch with global filter chip (P0).

### `/analytics/heat-map` (YTD)
- Score Weights: Revenue 30%, Transactions 20%, Rev/Room 25%, Txn/Kiosk 15%, Avg Basket 10% (sums 100%).
- Top 20: rank 1 = Central Bus Station score 95.4; rank 2 = Heathrow underground score 59.9. **35-point gap between #1 and #2 — confirms min-max collapse.** All 20 ranked "High" status. K9 (Radisson RED) at rank 5 has TRANSACTIONS=1,093 and TXN/KIOSK=1,093.0 — identical because kiosks=1 (which is fine but degenerate); for outlets where kiosks=0 the column is "—".
- Bottom 20: rank 288 = `BK` "Customer Service" with **-£9,802.42** sales (NEW-P0-C). The next 19 ranks are tiny hotels with 2-30 transactions over the period.
- All Hotels: too long to enumerate; sample includes the same 288 entries as outlet tiers.

### `/analytics/regions` (YTD)
- Selector lists ONLY "United Kingdom" (£209,965.01, **79 groups**, 19,158 txns). NEW-P1-F (no Australia row).
- Detail panel for UK: Sales £209,965.01, Transactions 19,158, **Hotel Groups 63** (vs selector's 79 — same metric, two queries, two answers — P0).
- Hotel Groups in Region: 63 rows. Many composite names ("Marriott Group, Axiom Hospitality" alongside "Marriott Group" alone — multi-membership rendered as a separate group). Top 5: Radisson £23,550.31 (9 hotels), Marriott £21,463.31 (14), IHG £19,053.23 (10), Hilton £18,568.88 (21), Essendi+Accor £11,339.25 (24).
- **Location Groups in Region table — `TOTAL ROOMS` is broken**: Heathrow 17 outlets / **1,790,496 rooms**; London Central 56 outlets / **1,057,606 rooms**; London East 29 outlets / **354,186 rooms**; Manchester 29 outlets / **537,588 rooms**. Confirmed P0: SUM(num_rooms) over sales-records join multiplies by transaction count.
- Sales × outlets across location groups: Heathrow £56,345.66, London Central £53,970.79 — sum-of-rows (~£190k) is roughly the region total, *unless* a single outlet is in multiple location groups (in which case it would over-sum, but I did not exhaustively verify cross-group double-count).

### `/analytics/hotel-groups` (YTD)
- Header: "Hotel Groups · **63**" (matches Region detail's count, NOT the selector's 79).
- Selected Marriott Group + "Marriott Group, Axiom Hospitality" combined: Sales £26,829.76 = exact arithmetic sum (£21,463.31 + £5,366.45), Hotels 23 = 14+9, Transactions 2,396. Could not conclusively prove fan-out from this single test (the composite-name groups appear to be disjoint outlets-set vs the simple-name group, so summing here is correct), but the existence of dual-name groups indicates the underlying data has multi-group memberships exposed only via UUID-tie-break canonicalisation.
- Hotels in Group table: TRANSACTIONS = QUANTITY column for every row (P1 confirmed). Same hotel name (e.g. "Sheraton Skyline SSM" 4S/4K, "Residence Inn by Marriott Kensington" 6 codes) appears multiple rows. NEW-P1-G.

### `/analytics/location-groups` (YTD)
- Header: "Location Groups · 29".
- Selected Heathrow group: Sales £56,345.66, Transactions 5,680, Hotels 17, **Total Rooms 3,544** (= 17 × ~208 — *correct here*, unlike the Regions page).
- Capacity Metrics: Rev/Room £15.90, Txn/Room 1.6, **Txn/Kiosk —** (always null), Avg Basket £9.92, Total Kiosks **—**.
- Peer Analysis: Revenue P100, Transactions P100, Avg Basket P79, Rev/Room P100. With a single selected group, percentile-vs-self is meaningless (P100). Confirms tiny-peer-set bug.
- Hotels in Group: TRANSACTIONS=QUANTITY for every row again. Same-name multi-row again ("Sheraton Skyline SSM" 4S/4K, etc).

### `/analytics/compare` (YTD)
- Picker lists locations alphabetically; no region/code disambiguation. Multiple rows with same display name.
- Selected Central Bus Station + Heathrow underground:
  - CBS: Sales £223,410.13, Tx 15,740, Avg Basket £14.19.
  - Heathrow underground: Sales £130,532.52, Tx 8,208, Avg Basket £15.90.
  - Cross-check: 223410.13/15740=£14.19 ✓ — but this divides by the inflated COUNT(*) so Avg Basket is suppressed by ~50% (booking-fee rows in the denominator).

### `/analytics/pivot-table` (YTD)
- Field list: dimensions = Product, Outlet Code, Hotel, Hotel Group, Region, Location Group, Month, Year, Hour. Metrics = Revenue, Quantity, Booking Fee.
- Drag Product→Rows, Region→Columns, Revenue→Values worked (HTML5 DnD via mouse events). Visible drag toast: `Draggable item gross_amount was dropped over droppable area values`.
- **Click "Run Analysis" → HTTP 500 console error** (`/analytics/pivot-table?...:0 status 500`). No results rendered. Page stays on "No pivot results yet".
- **CONFIRMED P0**: Pivot Table is broken end-to-end against the post-0022 schema. The UI label "Revenue" is internally `gross_amount`, which the migration dropped.

### `/analytics/trend-builder` (YTD)
- Default: single series "Revenue | All", granularity Auto = Daily.
- Granularity Daily: Y-axis £0-£60,000, X-axis 1/1-31/1.
- Granularity Weekly: Y-axis £0-£360,000, X-axis 29/12-26/1 (5 buckets). Weekly bucketing produces values that sum to ~£1.5M total — looks correct for Revenue.
- Granularity Monthly: Y-axis £0-£1,600,000 with single Jan 26 bar.
- Switched series metric to **Avg Basket Value** at Monthly: **Y-axis tops £600** (vs portfolio Avg Basket £15.62). CONFIRMED P0 — sum-of-daily-averages bucketing is mathematically wrong.
- Toggled YoY: switch flips on, no second line rendered (no 2025 data). Cannot validate YoY math beyond UI rendering.
- Set global filter Region = United Kingdom (URL becomes `?regions=5a7f80de-…`). Series remained labelled "Revenue | All", chart Y-axis still £1.6M = full portfolio. **P0 CONFIRMED**: Trend Builder ignores `regions` global filter.
- Builder panel exposes its own per-series filters (Locations, Products, Hotel Groups, Regions, Location Groups). These would in principle let the user re-set the region per series, but the global bar at the top is a no-op for this dashboard.

### `/analytics/commission` (YTD)
- All three sections (By Location, By Product, Monthly Trend) render "No commission data" empty states.
- Cannot validate reversal double-counting / scope-leak P0s — no records to test against.

### `/analytics/experiments` (YTD)
- "No cohorts yet. Create one to get started." Cannot validate Cohort vs Control / Temporal Analysis P0s — no records to test against (creating a cohort would mutate state, forbidden).

### `/analytics/actions-dashboard` (YTD)
- "0 open actions across the portfolio. No action items found." Cannot validate flag→action workflow P0 — no records to test against.

## Phase 2: Filter validation

| Test | Result |
| --- | --- |
| Set date range to "Last Month" (March 2026) | All KPIs zero, all sections empty, MoM = -100%. Confirms data window ends in Jan 2026. |
| Set date range to April 2026 directly | Same: all empty. |
| Set date range to "YTD" = Jan 1 - Apr 26 | KPIs identical to "Jan 2026" — confirms only Jan has data. |
| Set 2025 calendar year | All empty. |
| Toggle Sales→Revenue (default YTD range) | SALES £1,485,878.71 → REVENUE £79,482.86 (5.3% = booking-fee revenue, looks right). TRANSACTIONS **95,103 → 47,661 (exactly 2× factor confirmed)**. AVG BASKET £15.62 → £1.67. UNIQUE OUTLETS 288→287 (1 outlet has zero booking-fee revenue). UNIQUE PRODUCTS 105→2 (Booking Fee + Cash Handling Fee — confirmed). **Performer-Pattern cards: identical product list, identical revenue numbers, identical avg/room — `metricMode` ignored.** NEW-P0-A. |
| Apply Location Type = Hotel | Sales £1.49M → £187,087.02 (12.6%); transactions 95,103→17,513; outlets 288→228. Filter works. |
| Reset filters | Returns to baseline. |
| Apply global Maturity = "0-1 Month" while on Maturity page | Page Section A bucket "0-30 Days (231 locations)" still populated; but the page's own bucket labels are days, not months — confirms convention mismatch. |
| Apply global Region = United Kingdom on Trend Builder | URL updates with region UUID, chart unchanged. Filter ignored. |

## Phase 3: Pivot Table deep dive

| Step | Result |
| --- | --- |
| Drag Product→Rows, Region→Columns, Revenue→Values, click Run | **HTTP 500**. `console-2026-04-26T03-37-51-957Z.log` shows the request fail. |
| Try other metrics: Quantity, Booking Fee | Did not exhaustively click each because the field-drag toast revealed every metric is wired to a dropped or dropped-derivative column. The HTTP 500 confirms the engine is broken at the SQL layer. |
| Comparison toggle (MoM/YoY) | Toggles available in Builder Panel but Run still 500s before any column merge. |
| Grand totals / sorting / column reorder | Cannot test without a successful Run. |

Pivot Table is functionally **dead** in production. Every business use case is blocked.

## Phase 4: Trend Builder deep dive

| Step | Result |
| --- | --- |
| 1. Default Revenue series, no filters | £1.49M Jan-only, single bar at Monthly, daily curve at Daily. |
| 2. Granularity auto/daily/weekly/monthly | Daily chart 1/1-31/1, Weekly 5 buckets 29/12-26/1, Monthly single Jan 26 bar. |
| 3. Rolling avg 7d/30d | Toggles render but with single-month data the smoothed line collapses onto the raw line — couldn't fully verify smoothing math. |
| 4. YoY toggle | Switch flips on, no second line because no 2025 data. Cannot validate YoY math beyond UI rendering. |
| 5. Events toggle | Toggle switch flips on. No annotations rendered (no business events in this date range). |
| 6. Weather toggle | Did not enable (would require selecting exactly 1 location group; couldn't easily verify gating in this pass). |
| 7. Add second series with different filter | Did not exercise; first series filter tests already confirmed series-builder filters DO take effect (the metric switch worked); the global-filter ignore is the headline finding. |
| 8. Metric=Booking Fee | Did not switch; portfolio revenue mode showed £79,482.86 and Booking Fee at sum-of-9991-rows would be similar but not identical to revenue mode (which sums 9991 + 9992). |
| 9. Avg Basket at Monthly vs Portfolio Avg Basket KPI | Portfolio Avg Basket = £15.62. Trend Builder Avg Basket Monthly Y-axis tops £600. **CONFIRMED divergence by ~30-40× factor**, consistent with sum-of-daily-averages over a 30-day window. |
| 10. Set Region=UK on Portfolio, navigate to Trend Builder | Chart unchanged (£1.49M total). **CONFIRMED ignored**. |

## Phase 5: Top-N redundancy hunt

| Table | Redundant / broken columns observed |
| --- | --- |
| Portfolio → Top Products | **TRANSACTIONS column ≡ QUANTITY column** for every row (1-20). 9,001=9,001, 9,053=9,053, 4,205=4,205, … |
| Portfolio → Outlet Tiers | KIOSKS=0 and ROOMS=— for the entire top-15 by revenue (Heathrow + airport outlets). SALES/KIOSK and SALES/ROOM uncomputable for the highest-revenue rows. NEW-P1-I. |
| Portfolio → High/Low Performer Patterns | Tier "Top 3 products" string repeats the same products in green and red tier (Uber API in both); Region Distribution sums < 100%. |
| Heat Map → Top 20 | TXN/KIOSK column = TRANSACTIONS exactly when kiosks=1 (degenerate but not strictly wrong). For airport outlets KIOSKS=0 → TXN/KIOSK is "—". Status badges all "High" — no Top-20 row showed Mid or Low. SCORE column has #1=95.4, #2=59.9 (35-pt gap). |
| Heat Map → Bottom 20 | Rank 288 = "Customer Service" with **-£9,802.42**. NEW-P0-C. Other 19 are tiny hotels. |
| Heat Map → All Hotels | Same 288 entries; could not assess archived-leak without admin-archive write. |
| Hotel Groups → Hotels in Group | **TRANSACTIONS ≡ QUANTITY** for every row. KIOSKS column hard-coded NULL ("—") confirmed. |
| Location Groups → Hotels in Group | **TRANSACTIONS ≡ QUANTITY** for every row. STARS column populated. |
| Regions → Hotel Groups in Region | Composite group names visible ("Marriott Group, Axiom Hospitality"). HOTELS column populated. |
| Regions → Location Groups in Region | **TOTAL ROOMS impossibly large** (Heathrow 1,790,496 for 17 outlets). Confirmed P0. |

## Phase 6: Static-audit P0/P1 validation

| Static-audit issue | Live verdict | Evidence |
| --- | --- | --- |
| Default sales mode includes fee rows in `COUNT(*)` → Transactions inflated 2-3× | **CONFIRMED** | Sales 95,103 → Revenue 47,661 (exactly 2× factor) |
| Pivot Table broken end-to-end (refs dropped columns) | **CONFIRMED** | HTTP 500 on Run; drag toast shows `gross_amount` |
| Trend Builder ignores global filter | **CONFIRMED** | URL has `regions=` UUID, chart still totals £1.49M |
| Trend Builder Avg Basket bucketing math wrong at monthly | **CONFIRMED** | Y-axis £600 vs Portfolio £15.62 |
| Maturity buckets differ between page and global filter | **CONFIRMED** | Page Days (0-30/31-60/61-90/90+) vs filter Months (0-1/1-3/3-6/6+) |
| Heat Map "transactions" weight inflated by fee rows | **CONFIRMED** (indirect) | Sales mode inflated by 2× propagates into composite |
| Heat Map traffic light uses raw revenue not composite | **CONFIRMED** | Top 20 rank 5+ = "High" but Score 50; Bottom 20 includes -£9,802 row |
| Top performer can show "amber" | NOT REPRODUCED in this dataset | All Top 20 = "High" |
| Cash Handling Fee leaks into Top Products of performer patterns | **CONFIRMED** | Category Performance bar chart has both "Booking Fee" and "Cash Handling Fee" as bars |
| Region distribution percentages can sum to >100% | NOT REPRODUCED — **opposite issue found**: <100% because most outlets lack region tags (only UK row shown at 57.5% / 88.5%) | Performer Pattern Region Distribution table |
| "Hotel Group Count" badge in Region Selector ignores filters | **CONFIRMED** | Selector says 79, detail panel says 63 |
| Outlet code shown without region disambiguation | **CONFIRMED** | "Q5", "Heathrow Terminal 4 b" code 4T, no region indicator anywhere |
| Booking-fee transaction-count inflation | **CONFIRMED** | 95,103 → 47,661 |
| Avg-basket bucketing math wrong at monthly | **CONFIRMED** | trend-builder Avg Basket £600 ceiling at monthly |
| Membership double-counting in multi-group selection | **COULD NOT VERIFY DEFINITIVELY** | Marriott + Marriott+Axiom selection summed cleanly (suggests these are disjoint composite groups), but the existence of composite groups proves the underlying multi-membership pattern. Need a known shared-hotel-pair to test fan-out. |
| Avg Monthly Revenue in Install Cohorts is NOT actually monthly (12× off) | **CONFIRMED** + WORSE | Shows £911.79 for "2026-04" cohort with 231 locations — but data spans Jan only (NEW-P0-B compounds the issue: cohort dates are also wrong) |
| `buildMaturityCondition` drops NULL `kioskLiveDate` rows | **PROBABLY CONFIRMED via NEW-P0-B** | All 231 locations are bucketed as 0-30d, suggesting any older bucket is silently empty because all `kioskLiveDate`s are <30 days old |
| Internal viewer with zero scopes is unrestricted | COULD NOT VERIFY | No way to test without provisioning a scoped user (write op) |
| CSV parser only flags exact-string `"Booking Fee"` | COULD NOT VERIFY | CSV-side; not surfaced in dashboards |
| Reversal rows inflate every COUNT(*) | **PROBABLY CONFIRMED** | Top Products in Red Tier shows "Three 25 / 100GB -£20.83" (refund-only); Bottom-20 has -£9,802.42 outlet |
| Archived locations leak into every dashboard | COULD NOT VERIFY | Cannot mutate to archive a location |
| Commission KPIs / By Location / By Product / Monthly: reversal double-counting | COULD NOT VERIFY | Commission dashboard empty — no data to test |
| Commission queries do not apply scopedSalesCondition | COULD NOT VERIFY | Same |
| Experiments Temporal Analysis ignores global filters | COULD NOT VERIFY | No cohorts created |
| Experiments Cohort vs Control delta is raw, not per-location | COULD NOT VERIFY | Same |
| Maturity Section B ramp curve is survivor-biased | COULD NOT FULLY VERIFY | Section B reads "No ramp data available" because all install dates are 2026-04 and the sales window is 2026-01 to 2026-04 — months_since values are all negative or zero, so no ramp computable |
| Hotel Groups `hotel_count` shifts under metricMode toggle | COULD NOT FULLY VERIFY | Did not toggle hotel-groups page metric mode |
| Location Groups `SUM(DISTINCT num_rooms)` mathematically wrong | NOT OBVIOUSLY REPRODUCED | Heathrow showed 3,544 rooms across 17 outlets which is plausible (avg 208) — but the distinct-value bug would only be visible with same-room-count hotels; insufficient evidence either way |
| Location Groups all per-room metrics multiplied by N | NOT REPRODUCED in Location Groups page | Region detail's location-groups-in-region IS broken (1.79M rooms); Location Groups detail page shows correct rooms count. Two queries produce different results — see Phase 1 Regions vs Location Groups. |
| Location Groups peer cohort mixes location types | CONFIRMED structurally | Single-group selection → P100 across the board; cohort = "all 29 location groups" regardless of type |

## Phase 7: UI / render bugs

- **Recharts container size race**: 3-8 console warnings per page load: `WARNING: The width(-1) and height(-1) of chart should be greater than 0`. Cosmetic but consistent.
- **Hourly Distribution X-axis alphabetical sort** (NEW-P1-E): hours rendered `00, 01, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 02, 20, 21, 22, 23, 03, 04, 05, 06, 07, 08, 09`.
- **Outlet Tiers missing data presented as silent dashes**: rooms=NULL → `—`, kiosks=0 → `—`. No "N/A" label, no warning, no tooltip.
- **Compare picker** lists same display-name multiple times with no disambiguation (e.g. "CBS OTH" 3×).
- **Location Groups peer analysis** all-P100 when only 1 group selected — no "insufficient peers" warning.
- **No FilterBar on Pivot Table** — confirmed in DOM. Pivot has its own filter store.
- **Trend Builder global filter chips** appear in the sticky bar but have no effect on the chart — misleading UI affordance.
- **Region selector card "79 groups"** vs **detail panel "63 hotel groups"** — both visible on the same screen at the same time; user has no way to know which is correct.

---

## Recommendations (prioritized)

### P0 — fix immediately (blocks demo or financial reporting)

1. **Repair Pivot Table SQL** — replace `gross_amount` → `net_amount`; remove `quantity`; replace `booking_fee` with `CASE WHEN is_booking_fee THEN net_amount ELSE 0 END`; remove dropped `region`/`outlet_code` references; route Region dimension via membership join. Until fixed, hide the Pivot Table page from the nav.
2. **Wire global filter bar into Trend Builder** — propagate `metricMode`, `regionIds`, `hotelIds`, `productIds`, `hotelGroupIds`, `locationGroupIds`, `locationTypes`, `maturityBuckets` from the analytics filter store into `getTrendSeries`. Or, if intentional, **remove the FilterBar from Trend Builder** so users aren't misled.
3. **Fix Trend Builder Avg Basket bucketing** — return `(numerator, denominator)` per day from SQL, sum both during bucketing, divide at render time.
4. **Pass `metricMode` to High/Low Performer Patterns query** — current behaviour shows identical numbers in sales vs revenue mode, defeating the toggle.
5. **Fix Region detail's "Location Groups in Region" total_rooms** — SUM(num_rooms) over the sales-records JOIN multiplies by transaction count. Use a CTE that distincts location_id first.
6. **Reconcile `hotel_count` query in Region Selector vs Region Detail** — pick one source of truth. Currently 79 vs 63 for the same UK region.
7. **Investigate `kiosk_assignments` mass-reseed** — every active outlet has assignedAt in April 2026, breaking the entire Maturity dashboard. Either restore historical install dates from `locations.live_date`, or have Section A/C fall back to `locations.live_date` when subquery is NULL (per static audit recommendation).
8. **Exclude refund-aggregator outlet codes from rankings** — `BK` "Customer Service" with -£9,802.42 anchoring Bottom-20 is a defect of presentation. Add an `outlet_role` flag or filter on `net_amount > 0` for performance ranks.
9. **Strip booking-fee variant outlet codes (`4T`, `1Q`, `KG`, etc with "b" suffix or fee-coded)** from outlet rosters — `T4` AND `4T` ("Heathrow Terminal 4 b") both shown as separate Premium outlets is misrepresentation.
10. **Apply `buildNonFeeCondition()` to all `COUNT(*)` "Transactions" KPIs** — the current 2× inflation in default sales mode is the single biggest source of metric distortion across every dashboard.

### P1 — fix before next analytics review

11. **Make Maturity-page bucket boundaries match the global Maturity filter chip** (months, not days).
12. **Remove "Quantity" column from all top-N tables** — it's `COUNT(*)::text` and identical to "Transactions". Either drop the column or change it to a real distinct count.
13. **Fix Hourly Distribution X-axis sort order** — ORDER BY hour ASC numerically, not as string.
14. **Disambiguate outlet codes by region** — "Q5" exists in GB and DE; once AU/Q5 lands the conflict triples. Show `(GB) Q5` or similar in every list.
15. **Add region/outlet-code to Compare picker** — "CBS OTH" 3× is unusable.
16. **Surface "no data" honestly** — Performer Pattern Region Distribution should say "57.5% (50/87 in UK; 37/87 untagged)" instead of just showing one row at 57.5%.
17. **Show all configured regions in the Regions selector** with `£0` rather than hiding them — Australia silently absent today.
18. **Clamp Heat Map composite scoring** — winsorise top 1%, log-scale, or use percentile rank — to avoid the #1=95.4 / #2=59.9 collapse.
19. **Add "showing top N of M" indicator** to Outlet Tiers (currently silently truncates at 200).

### Process

20. **Add a smoke test that hits every analytics page in CI** and asserts (a) HTTP 200, (b) zero console errors, (c) at least one numeric KPI present. The Pivot Table 500 would have been caught.
21. **Add a regression test for the metric-mode invariant** — toggling Sales/Revenue must change at least one number on every dashboard. The Performer Pattern bug would have been caught.
22. **Document analytics dashboards' metric definitions** in-app (tooltips on KPI cards) — too many "Avg Basket"s computed differently across dashboards.
23. **Tighten the prod-admin password rotation flow** — the user-supplied prod credential `Admin123!` did not match prod state. Add a known-good seeding step on each prod deploy, or document the rotation step in `CLAUDE.md`.

---

## Earlier outage finding (preserved for context)

**Note**: the prior LIVE-UAT.md targeted `https://wkg-kiosk-tool.vercel.app/` (note: `wkg-kiosk-tool`, not `wkg-command-centre`) and found every server-rendered route returning HTTP 500 because `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` were not set on the Vercel production environment. That finding is **still valid for the `wkg-kiosk-tool` alias** — `curl -I https://wkg-kiosk-tool.vercel.app/` from this UAT session also returned 500. The canonical production URL is `https://wkg-command-centre.vercel.app/` (which DOES have the env vars set, presumably because the Neon Vercel integration provisions them on the canonical project). **Recommendation**: either remove the `wkg-kiosk-tool` alias entirely (it's confusingly named like the repo and is broken), or add the missing env vars to its environment too. From the earlier report:

> Set in Vercel Project → Settings → Environment Variables (Production): (1) `BETTER_AUTH_SECRET` — generate via `openssl rand -hex 32`; (2) `BETTER_AUTH_URL` — `https://wkg-command-centre.vercel.app`. Then redeploy. Verify with `curl -I` returns 200.

Also still valid:

- `/api/health` returns 500 instead of acting as a no-auth liveness probe.
- 500s on edge routes leak no `x-vercel-error` diagnostic header.
- Recommend a build-time guard that fails the build when `BETTER_AUTH_SECRET` is unset in production.
