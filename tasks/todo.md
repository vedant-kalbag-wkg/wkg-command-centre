# Analytics Audit — Fix Plan

Source artefacts: `tasks/analytics-audit/ANALYTICS-ISSUES.md`, `LIVE-UAT.md`, `KIOSK-MANAGEMENT-AUDIT.md`.

Plan is grouped by **root cause**, not by dashboard. One root fix usually cascades through many symptom rows. Phases 1–3 unblock the analytics correctness story; phases 4–5 are dashboard-specific; 6–8 are UX/process hardening.

## Open design decisions (need user input before detailed PRs)

These are the gray-area calls. Decisions here change the shape of the work in phases 1–5.

- [x] **D1 — Booking fee semantics in COUNT(*)**: RESOLVED — see Resolved Decisions below. Counts (Transactions / Bookings) are mode-invariant and use non-fee rows only; the value/SUM swaps between non-fee amounts (sales mode) and fee amounts (revenue mode).
- [x] **D2 — Reversal handling**: RESOLVED — see Resolved Decisions below. Adds `is_reversal`, `original_record_id`, `processed_at_location_id` columns; cancellation = unique reversed bookings (per `original_record_id`); partial refunds are a separate KPI; bookings KPI is gross; orphan refunds attributed at portfolio level only.
- [x] **D3 — Maturity bucket convention**: RESOLVED — 5-bucket scheme in months: `0-1 / 1-3 / 3-6 / 6-9 / 9+`. Applied identically to maturity dashboard buckets, global filter chip, ramp-curve SQL, and any client-side `calculateMaturityBucket()`. Reference date is always `filters.dateTo`, never `NOW()`.
- [x] **D4 — Maturity dashboard data restoration (NEW-P0-B)**: RESOLVED — see Resolved Decisions below. Source of truth = `locations.liveDate` (Monday "Live Estate"). Per-kiosk granularity is impossible historically (kiosks + kiosk_assignments tables both reseeded 2026-04-18, no per-kiosk install data anywhere). Backfill applies location's liveDate to all its kiosks. Fallback for 57 locations: `MIN(transaction_date)` lower-bound. The 23 active outlets with no liveDate AND no sales remain NULL (treated as "not yet installed"). One-time multi-kiosk caveat CSV written to `tasks/analytics-audit/multi-kiosk-locations.csv`. Going forward, per-kiosk granularity is natural via `now()` on new assignments + safeguard 5.3.
- [x] **D5 — Membership double-counting + data-quality + management UI**: RESOLVED — see Resolved Decisions below. Three different treatments per dimension: (regions) 1-per-location with UNIQUE constraint + cleanup of bogus UK memberships + import-fix to source region from Monday instead of defaulting to UK; (location groups) same 1-per-location treatment; (hotel groups) keep N:N for legitimate JV cases, but split the 34 comma-encoded JV groups into proper multi-memberships against existing standalone groups, then archive the JV rows. Per-location dedup at query layer needed for hotel groups only. **Management UI** (location detail form) gets: single-select region picker, single-select location-group picker, **multi-select hotel-group picker** that writes to `location_hotel_group_memberships` directly. Schema-cleanup of the redundant denormalized columns (`locations.hotelGroup` text, `locations.operatingGroupId` FK — 0 rows populated) deferred to its own pass.
- [x] **D6 — Hourly Distribution timezone**: RESOLVED — see Resolved Decisions below. Bucket by location's local time via new column `locations.iana_timezone TEXT NOT NULL DEFAULT 'UTC'`. Region-default backfill mapping (UK→Europe/London, Spain→Europe/Madrid, Germany→Europe/Berlin, Czech→Europe/Prague, Ireland→Europe/Dublin, Australia→Australia/Sydney, US→America/New_York [Miami]). Editable on the location detail form (manual override). Future: GMaps geocoding from `locations.address` populates lat/lng, then geo-tz refines per location. Admin settings flag `analytics_display_timezone: local | utc` (default `local`) controlling all hour-of-day displays site-wide. Query change: `EXTRACT(HOUR FROM ((transaction_date + transaction_time) AT TIME ZONE 'UTC') AT TIME ZONE l.iana_timezone)` with JOIN to locations. NetSuite source-feed timezone (assumed UTC) to be confirmed in implementation phase.
- [x] **D7 — Heat Map composite normalization**: RESOLVED — see Resolved Decisions below. Percentile rank per metric via Postgres `PERCENT_RANK()` (optimistic tie handling — ties share the better rank). Component weights (30/20/25/15/10) preserved on the rank-normalised values. Composite is computed over whatever population the global filter bar yields, so applying `locationTypes=hotel` to the filter bar excludes airports from both the percentile cohort AND the displayed leaderboard. Tooltip on the composite cell shows the per-metric percentile breakdown.
- [x] **D8 — Multi-POS sites + duplicate location records**: RESOLVED — see Resolved Decisions below. The conceptual model is: `locations` = hotels/sites, `kiosks` = POS units within a site, `kiosk_assignments` already handles "which kiosk at which site". The data violates this — 18+ sites are split across multiple location rows ("Heathrow Terminal 4" + "Heathrow Terminal 4 b"; 8 separate rows for Residence Inn Kensington; etc.). Fix: programmatically identify multi-POS clusters by address, propose a canonical record per cluster, generate a review CSV for human confirmation, then merge — rewriting `sales_records.location_id`, `kiosk_assignments.location_id`, and `location_*_memberships.location_id` from defunct rows to the canonical row, archiving the defunct rows with audit-log trail. Display: drop the " b" suffix; just show the canonical name. Per-site default for analytics rollup, with per-kiosk drill-down preserved via `kiosk_id`. Address-data-quality issue (Madrid hotel names on Heathrow addresses) is the same upstream root cause as D5's UK default — covered by the D5 import fix.
- [x] **D9 — Internal-account exclusion**: RESOLVED — see Resolved Decisions below. Add `'internal'` to the `locations.locationType` enum (currently: hotel / retail_desk / online / airport / hex_kiosk). Tag `BK` (Customer Service) as `internal` — probe confirmed it's the only actual `locations` row matching the internal-account pattern (Office/Warehouse/etc. names from the import script are import-time region aliases, not location records). All analytics dashboards default to `WHERE location_type != 'internal'`. Global filter bar gets a "Show internal accounts" toggle (off by default) for audit use. Orphan refunds (D2.4) still appear in the portfolio-level health badge so the money is visible.
- [x] **D10 — Fee column rename**: RESOLVED — see Resolved Decisions below. Rename `salesRecords.isBookingFee` → `is_weknow_fee`. CSV parser sets TRUE for both NetSuite code 9991 (Booking Fee) AND 9992 (Cash Handling Fee). `buildIsFeeCondition()` simplifies to a single column check. All ~20 existing call sites renamed mechanically. Eliminates the bug class where call sites forget to OR in the netsuite_code 9992 check (the live-flagged Performer Pattern bug at `high-performer-analysis.ts:194`).
- [x] **D11 — `freeTrialEndDate` treatment**: RESOLVED — analytics handling parked until the broader maintenance-fee story exists; sales recorded during trial periods continue to flow into KPIs unflagged for now. Kiosk-management UI gets a "Trial ending soon" surface (see new task 7.10).
- [x] **D12 — Vercel alias cleanup**: RESOLVED — remove `wkg-kiosk-tool.vercel.app` alias via `vercel alias rm`. The canonical URL is `https://wkg-command-centre.vercel.app/`. Confusing-name cleanup, prevents future onboarders / agents from landing on the broken alias. Tracked as Phase 8.4.
- [x] **D13 — Kiosk config group UI surfacing**: RESOLVED — see Resolved Decisions below. Add a config-group picker to the location detail form (editable by **all editor-level users**, not admin-only). Drop the `kiosks.kioskConfigGroupId` column (deprecated — config is per-location). Existing `/settings/kiosk-config-groups` admin page gains a member-management view so admins can bulk-assign locations to a group from the group's page. Source of truth for the mapping is Monday column `1466686598`; verify the existing import wiring is correct and re-running it overwrites stale local edits with Monday state (or document the override semantics if not).

---

## Phase 1 — Systemic root causes (fixes cascade across many dashboards)

- [x] **1.1** Fix `getActiveLocationIds` to filter `archivedAt IS NOT NULL` (`src/lib/analytics/active-locations.ts:29-46`). Touches every dashboard. (P0) — PR-2 (`81659f7`)
- [x] **1.2** Implement reversal handling per **D2**. Add helper `buildNonReversalCondition()`; default-include in every COUNT(*); SUM(amount) keeps current behavior (nets correctly). (P0) — PR-3 (`a58320e`/`a839cb9`/`bf70915`/`a175515`); migration 0027 + backfill applied to neon-dev only.
- [x] **1.3** Standardise fee handling per **D1** + **D10**: rename column if D10=rename; introduce `buildSalesTxnCondition()` (non-fee, non-reversal) used by every "Transactions" KPI; audit every `COUNT(*)` call site. (P0, biggest single cascade) — PR-4 (`38754d1`/`156bdb4`/`59992d1`/`c0647da`); migration 0028 applied to neon-dev only.
- [x] **1.4** Standardise maturity buckets per **D3**: pick convention; replace all client-side `calculateMaturityBucket(date)` with `calculateMaturityBucket(date, filters.dateTo)`; collapse the two parallel bucket constants. (P0) — PR-5 (`34ac5de`)
- [x] **1.5** Fix membership double-counting per **D5**: rewrite `regions.ts`, `hotel-groups.ts`, `location-groups.ts`, `comparison.ts` to dedupe per location before aggregating up. (P0) — PR-6 Parts A–E (`d2d0aa9`/`1387e31`/`7623642`/`ef58378`/`1f31a3f`); migrations 0029/0030/0031 applied to neon-dev only.
- [x] **1.6** Schema drift sweep: grep for `gross_amount`, `quantity`, `booking_fee` (column form), `sale_commission`, `discount_amount`, `locations.region` across `src/lib/analytics/`, `src/app/(app)/analytics/`, `src/lib/stores/pivot-store.ts`, `EDITABLE_LOCATION_FIELDS`. Replace or remove. (P0 — Pivot is fully broken until done) — PR-1 (`d37a929`/`fb99936`)
- [x] **1.7** Internal-user-with-zero-scopes safety: change `scoped-query.ts:92` to throw (mirror external-user behavior). (P0 — silent over-permission) — PR-1 (`a6ac782`/`eaca7d1`)
- [x] **1.8** Validate URL filter params with Zod (`searchParamsToFilters`). (P1) — PR-5 (`a7c90c0`)
- [x] **1.9** Add `outlet_exclusions.region_id` (now that AU exists) and update `buildExclusionCondition` to scope by region. (P1) — PR-6 Part F (`93a98d0`); migration 0032 applied to neon-dev only.

## Phase 2 — Math correctness fixes (specific calculation bugs)

- [x] **2.1** Replace `SUM(DISTINCT locations.num_rooms)` with subquery aggregation (`location-groups.ts:95, 146`). (P0) — PR-7 (`84f76c8`)
- [x] **2.2** Replace `SUM(locations.num_rooms)` over sales_records JOIN with subquery aggregation (`regions.ts:218`) — Heathrow currently shows 1.79M rooms. (P0) — PR-7 (`84f76c8`)
- [x] **2.3** "Avg Monthly Revenue" in Install Cohorts → divide by months in window (`maturity-analysis.ts:202`). (P0 — currently 12× off for 12-month window) — `a02e2cb`
- [x] **2.4** Pivot Table grand totals AVG: recompute from raw (`pivot-engine.ts:387-388`) — Simpson's paradox fix. (P1) — PR-10 (`3daa002`)
- [x] **2.5** Pivot Table grand totals row "—" when column-pivoting on: align cell-key composition (`pivot-engine.ts:380-397` ↔ `pivot-result-table.tsx:110-121`). (P1) — PR-10 (`3daa002`)
- [x] **2.6** Pivot Table comparison columns: switch from positional fallback to key-matching (`pivot.ts:218-220, 273-274`). (P1) — PR-10 (`3daa002`)
- [x] **2.7** Trend Builder Avg Basket bucketing → weighted average `SUM(amount)/SUM(count)` per bucket (`trend-chart.tsx:55-61`). (P0 — currently shows £600 vs true £15.62) — PR-9 (`12ab1c8`)
- [x] **2.8** Heat Map composite scoring per **D7** (`heat-map.ts:96-102`). (P1) — PR-11 (`2170e98`)
- [x] **2.9** Heat Map traffic light → use composite score not raw revenue (`performance-table.tsx:165-187`). (P1) — PR-11 (`2170e98`)
- [x] **2.10** Plateau detection: compare same-cohort over time; guard against zero/negative `avg3160`; expose threshold in settings (`page.tsx:28-75`). (P1) — PR-13 (`aaa0735`)
- [x] **2.11** `getComparisonDates` YoY: handle Feb 29 with explicit fallback to Feb 28 (`metrics.ts:30`). (P2) — PR-12 (`3ca289b`)
- [x] **2.12** Hourly Distribution per **D6** (timezone). (P1) — PR-14 (`cf5fd17`); migration 0033 applied to neon-dev only.
- [x] **2.13** Region distribution percentages capped at 100% (Performer Patterns); surface "untagged" rows explicitly. (P1) — PR-12 (`3ca289b`)

## Phase 3 — Filter wiring + scoping

- [x] **3.1** Trend Builder consumes the global analytics-filter store (currently reads only `dateRange` + `locationGroupFilter`). Mount `FilterBar`. (`trend-builder/page.tsx:39-46`, `trend-series.ts:96-138`). (P0) — PR-18c (`1933e6a`)
- [x] **3.2** Pivot Table consumes global filter bar (currently has its own store). Mount `FilterBar`. (P1) — PR-18b (`6aa0979`)
- [x] **3.3** Compare consumes global filter bar consistently. Switch `comparison.ts:70` from `sql.raw` hand-quoting to parameterised. (P1) — PR-18a (`1138b75`)
- [x] **3.4** Commission dashboard: add `scopedSalesCondition` to `buildCommissionWhere` (`commission/actions.ts:70-82`). (P0 — data leak across regions) — PR-15 (`bb37bb7` + `158086e`)
- [x] **3.5** Experiments Temporal Analysis: pass full `AnalyticsFilters` (currently drops everything but date) (`queries/experiments.ts:262-265`). (P0) — PR-17 (`2b4e41f`)
- [x] **3.6** Cohort picker `listLocationsForPicker`: apply user scope and outlet exclusions. (P1) — PR-19 (`69e0c12`)
- [x] **3.7** Cohort vs Control delta: add per-location normalisation when `controlType='rest_of_portfolio'`. (P1) — PR-19 (`69e0c12`)
- [x] **3.8** Region Selector counts (`regions.ts:107-118`): wire filters into Query 2 so the badge matches the detail-panel KPI. — PR-20 (`9b2511c`)
- [x] **3.9** `listRegionOptions`: add region scoping (currently any internal user can assign a location to any region). (P1) — PR-20 (`9b2511c`)
- [x] **3.10** Performer Pattern queries: pass `metricMode` through (NEW-P0-A) — currently flag-blind. (P0) — PR-16 (`0167f74`)

## Phase 4 — Per-dashboard surface bugs

- [x] **4.1** "Category Performance" → group by `products.categoryName`, exclude fees via `buildNonFeeCondition()`. — PR-23 (`afbe8d1` + `7f416d6` test tightening)
- [x] **4.2** Cash Handling Fee leak in Performer Top Products: `high-performer-analysis.ts:195` uses `buildNonFeeCondition()`. — covered by Task 1.3 Part B (`156bdb4`); verified PR-22
- [ ] **4.3** Outlet Tiers cells: `LIMIT 200` → return total + show "showing 200 of N" indicator. (P2 — **deferred Phase 4 close**, UI noise not correctness)
- [x] **4.4** Outlet Tiers maturity column: pass `filters.dateTo` (`outlet-tiers.tsx:95-98` already wires `referenceDate={filters.dateTo}` from `portfolio/page.tsx:380`). — covered by PR-5 (`34ac5de`); verified PR-21
- [x] **4.5** Heat Map `performance-table.tsx:124-127` maturity badge: passes `filters.dateTo` from `heat-map/page.tsx:120,138,158`. — covered by PR-5 (`34ac5de`); verified PR-21
- [x] **4.6** Refund-only outlet `BK` per **D9**: added `locationType='internal'` (TS + CHECK rebuild via migration 0034); `buildDimensionFilters` now appends a NOT-IN exclusion unless `includeInternalAccounts=true`; FilterBar gains a "Show internal accounts" Switch + `internal=1` URL param. — PR-25 (`19d8697`). Migration 0034 applied to neon-dev only.
- [x] **4.7** Outlet `4T` "Heathrow Terminal 4 b" + `2M` "T2 Mobile desk B" — display-only suffix strip via `formatHotelDisplayName` helper applied at 4 hotel-name render sites (Outlet Tiers, Heat Map perf table, hotel-list, hotel-breakdown). Underlying data preserved for Phase 5.6 multi-POS bulk merge. — PR-26 (`7f97f5d`)
- [x] **4.8** Hotels-in-Group breakdown tables: dropped redundant `quantity` (=`transactions`); replaced `NULL::text AS kiosks` with `activeKioskCountFragment()` per-row count. UI columns now `[Hotel] [Metric] [Transactions] [Rooms] [Kiosks] [Stars] [Metric/Room]`. — PR-24 (`7aa37d7`). Summary-level `total_kiosks` NULL in `getLocationGroupsList`/`getLocationGroupDetail` capacity intentionally left for follow-up (separate audit items at ANALYTICS-ISSUES.md:178, 467).
- [ ] **4.9** Bottom 20 / Top 20 overlap when 21 ≤ N ≤ 39: warn or merge. (`heat-map.ts:286-293`). (P2 — **deferred Phase 4 close**, rare edge case)
- [ ] **4.10** Cohort name uniqueness in Experiments. (P3 — **deferred Phase 4 close**, UNIQUE constraint + form validation; not blocking)
- [x] **4.11** Actions Dashboard: overdue badge in due-date cell, "Mine only" Switch, location multi-select (filtered to locations with ≥1 action), default sort `due_date ASC NULLS LAST`, resolvedAt date in resolved view. — PR-30 (`7b68395`)
- [x] **4.12** Flag → Action workflow: dedicated Flag Review page (`/analytics/flags`) with active/resolved tabs, type + location filters, inline-expand to linked actions, Create Action + Resolve actions per row. FlagDialog reshaped from XOR to single-submit + "Also create a linked action item" checkbox via tested `flag-dialog-submit.ts` helper. Linked-action count rendered server-side (correlated subquery) to avoid N+1. — PR-30 (`7b68395` + `31e8581` + `c3c3836`)
- [x] **4.13** Trend Builder `metric=booking_fee`: `trend-series.ts:107-109` uses `buildIsFeeCondition()` (covers 9991 + 9992 via `is_weknow_fee=true` post-D10). — covered by Task 1.3 Part B (`156bdb4`); verified PR-22
- [x] **4.14** Compare hotel-group dedup invariant: structurally pinned by regression test (EXISTS gate via `location_hotel_group_memberships`, no top-level membership JOIN). PR-6 Part E covers the production fix; this PR adds the test gate. — PR-28 (`7647f38`)
- [x] **4.15** Trend Builder rolling-avg toggle: disabled with tooltip when resolved granularity ≠ daily; auto-clears stale state on flip. — PR-29 (`9661a60`)
- [x] **4.16** Trend Builder auto-granularity: thresholds 31→60 / 90→200 (less jarring transitions, still readable buckets). — PR-29 (`9661a60`)
- [x] **4.17** Event annotations: server-side hierarchical scope filter via new `buildEffectiveLocationsPredicate` + per-request CTE in `getBusinessEvents`. Cache key bumped v1→v2; portfolio caller plumbed too. — PR-29 (`9661a60` + `98f62d9`)
- [x] **4.18** Weather lat/lng deterministic `.orderBy(locations.id)` before `.limit(1)`. — PR-29 (`9661a60`)
- [x] **4.19** Region selector vs detail count divergence (UK 79 vs 63): selector Query 2 rewritten to drive off `sales_records` (matching `getRegionDetail.hotelGroupBreakdown`); structural-unification test pins both queries to the same membership-scoping shape. — PR-27 (`393466f`)

## Phase 5 — NEW-P0-B: Maturity data restoration

- [ ] **5.1** Investigate why all 231 outlets have `kiosk_assignments.assignedAt` in 2026-04. Check `audit_logs` for mass-update event; check git history for the assignment migration. (P0)
- [ ] **5.2** Backfill historical install dates from chosen source per **D4**. (P0)
- [ ] **5.3** Add safeguard: a unique constraint or audit hook that flags/blocks mass-mutation of `kiosk_assignments.assignedAt` going forward. (P1)
- [ ] **5.4** Re-validate Maturity dashboard: install cohorts span multiple months; ramp curve shows real growth shape. (P0 — verification gate)
- [ ] **5.5** D8 — Multi-POS site merge: write a probe script that clusters `locations` by address (and by name+region as fallback), propose a canonical record per cluster, write the proposal as `tasks/analytics-audit/multi-pos-merge-proposal.csv` for human review. (P1)
- [ ] **5.6** D8 — After review, apply the merge: rewrite `sales_records.location_id`, `kiosk_assignments.location_id`, every `location_*_memberships.location_id` from defunct rows to the canonical row; archive defunct rows; write audit-log entries. (P1)
- [ ] **5.7** D8 + D5 — Address-data-quality fix: identify outlets whose `name` clearly mismatches their `address` (e.g. Madrid hotel name on Heathrow address). Manual review CSV → corrections via Monday re-pull or hand-edit. Same root cause as the UK-default import bug fixed in 1.1c (D5). (P1)

## Phase 6 — UX / cosmetic

- [ ] **6.1** Outlet code region disambiguation across all tables (e.g. `UK / Q5`). (P2)
- [ ] **6.2** Threshold magic numbers (±10% plateau, 70/40 heat-map, 80/50/20 outlet tiers) → settings table. (P2)
- [ ] **6.3** Currency symbol consistency. (P3)
- [ ] **6.4** Date format consistency. (P3)
- [ ] **6.5** Tooltips on KPI cards explaining math (Avg Basket especially — multiple definitions across dashboards). (P2)
- [ ] **6.6** Threshold editor: persist to URL params + write audit log on change. (P2)
- [ ] **6.7** Lat/lng population: geocode `locations.address` via Google Maps (or OpenStreetMap Nominatim) for the 392 active locations missing coordinates. Unblocks geo-tz refinement (D6) and any future map view. Manual override editable on location detail form. (P2)
- [ ] **6.8** Admin setting `analytics_display_timezone: local | utc` (D6): default `local`. Stored on a `system_settings` table or user_preferences depending on whether it's site-wide vs per-user. Affects every hour-of-day display (Hourly Distribution chart, anything with intra-day time). Default of `local` matches D6 backfill; switching to `utc` falls back to UTC display ignoring `locations.iana_timezone`. (P1)

## Phase 7 — Kiosk management gaps (lower urgency, separate from analytics correctness)

- [ ] **7.1** Add `locationType` editable field to location detail form (currently only on `/settings/outlet-types`). (P0 — analytics filter integrity)
- [ ] **7.2** Add `primaryRegionId`, `outletCode` to location detail form. (P0)
- [ ] **7.2a** Add `iana_timezone` editable picker on location detail form (D6 — admin override for the region-default backfill). (P1)
- [ ] **7.2b** Add multi-select hotel-group picker writing directly to `location_hotel_group_memberships` (D5 — JV support). (P1)
- [ ] **7.3** Remove `"region"` from `EDITABLE_LOCATION_FIELDS` (column dropped in 0022 — currently 500s if hit). (P0)
- [ ] **7.4** Add `status`, `internalPocId`, `customerCode`, `maintenanceFee`, `locationGroup` to location detail form (currently list-only — inconsistent). (P1)
- [ ] **7.5** Add `deploymentPhaseTags`, `freeTrialEndDate`, `notes` columns to kiosk list (currently detail-only). (P2)
- [ ] **7.6a** Add config-group picker to location detail form — editable by editor-level access, not just admin (D13). (P2)
- [ ] **7.6b** Add member-management view to `/settings/kiosk-config-groups/[id]` — list locations assigned to this group + bulk-assign / unassign (D13). (P2)
- [ ] **7.6c** Drop `kiosks.kioskConfigGroupId` column — schema migration + delete the 11 code references; the 7.6a/7.6b UI binds only the location-side column (D13). (P2)
- [ ] **7.6d** Verify `enrich-locations-from-monday.ts` actually populates `locations.kioskConfigGroupId` from Monday column `1466686598`; document override semantics for when an editor-level user changes the assignment locally (does the next Monday sync overwrite, or preserve local override?) (D13). (P2)
- [ ] **7.7** Kiosk archive: cascade-close active `kioskAssignments` rows. (P1)
- [ ] **7.8** "Show archived" toggle in location list. (P2)
- [ ] **7.9** Banking edits: write field-level audit log entries (currently coarse). (P2)
- [ ] **7.10** Trial-ending-soon notification (per D11) — surface on the kiosk dashboard (or admin home) any locations/kiosks where `freeTrialEndDate` falls within the next 30 days, so ops can decide to extend, convert, or terminate. Email or in-app alert TBD. (P1)
- [ ] **7.11** Analytics treatment of `freeTrialEndDate` deferred — pick up alongside the maintenance-fee recurring-revenue work when that lands (P3, blocked on a future maintenance-fee design decision).

## Phase 8 — Process / regression hardening

- [ ] **8.1** CI smoke test: hit every analytics page, assert HTTP 200 + zero browser-console errors + ≥1 numeric KPI present. Would have caught the Pivot Table 500. (P0)
- [ ] **8.2** Metric-mode invariant test: toggling Sales↔Revenue must change ≥1 number on every dashboard. Would have caught the Performer Pattern bug (NEW-P0-A). (P1)
- [ ] **8.3** Build-time guard: fail Vercel build if `BETTER_AUTH_SECRET` unset on Production env. (P0 — prevents recurrence of the alias outage)
- [ ] **8.4** Per **D12**: remove or fix `wkg-kiosk-tool.vercel.app` alias. (P1)
- [ ] **8.5** Document analytics metric definitions in-app (KPI tooltips). Reduces future "is this Avg Basket the same Avg Basket?" confusion. (P2)
- [ ] **8.6** Document the prod-admin password rotation flow in `CLAUDE.md` (UAT agent had to rotate to use the user-supplied credential). (P3)

---

## Sequencing notes

- Phase 1 should land in one coordinated PR (or a tight series) because the helpers are interdependent and partial fixes risk new misrepresentation.
- Phase 5 (Maturity data restoration) is independent of code work — can run in parallel.
- Phase 7 (kiosk management) is independent — can land alongside any of the others.
- Phase 8.1 (CI smoke) should land EARLY so subsequent fix PRs are validated automatically.

## Verification gates per phase

Each phase is "done" only when:
1. The static-audit issues it resolves are line-item ticked off in `tasks/analytics-audit/ANALYTICS-ISSUES.md`.
2. The corresponding live-UAT reproducers (where applicable) no longer reproduce on a preview deploy.
3. CI smoke test (8.1) passes on the preview.

---

## Resolved Decisions

### D1 — Booking fee semantics in COUNT(*) — RESOLVED 2026-04-26

**Counts (mode-invariant):**
- "Transactions" / "Bookings" KPI = `COUNT(*) WHERE NOT is_fee` (non-fee rows only). Same value in both Sales and Revenue mode.

**Amounts (mode-dependent):**
- Sales mode: "Total Sales" = `SUM(netAmount) WHERE NOT is_fee`. The gross value of customer purchases.
- Revenue mode: "Total Revenue" = `SUM(netAmount) WHERE is_fee`. WKG's fee take only.

**Derived metrics:**
- Avg Basket (Sales mode) = Total Sales / Transactions = average customer basket size.
- Avg Revenue per Booking (Revenue mode) = Total Revenue / Transactions = average fee earned per booking.

**Labelling:**
- Count label stays "Transactions" or "Bookings" in both modes (TBD which exact word — defer to UI polish phase).
- Value label flips: "Total Sales" ↔ "Total Revenue".

**Cascade fixes**: every dashboard's "Transactions" KPI; Avg Basket calculations everywhere; Heat Map composite scoring (transactions component); tier rankings; per-kiosk / per-room derived metrics; Pivot Table "Transactions" metric; Trend Builder transactions series.

### D2 — Reversal handling — RESOLVED 2026-04-26

**Schema additions** (populated at CSV ingest time):
- `sales_records.is_reversal BOOLEAN NOT NULL DEFAULT false` — true for refund rows. Detected from refNo suffix patterns (`-b`, `-h`, etc.).
- `sales_records.original_record_id UUID NULL` — FK back to the original record. NULL only for orphan refunds where the original predates the data window or can't be matched.
- `sales_records.processed_at_location_id UUID NULL` — preserves the historical outlet that handled the refund (e.g. Customer Service "BK"), for audit only.

**Outlet attribution rule**: at ingest, when a refund row is detected and successfully matched to an original, its `location_id` is **rewritten** to the original's `location_id`. The processing outlet stays in `processed_at_location_id`. This ensures cancellations attribute to the booking outlet, not the customer-service outlet that processed the refund.

**KPI definitions:**
- **Bookings** (gross) = `COUNT(*) WHERE NOT is_fee AND NOT is_reversal` — every booking ever made, regardless of subsequent fate.
- **Cancellations** = `COUNT(DISTINCT original_record_id) WHERE is_reversal AND NOT is_partial_reversal AND original_record_id IS NOT NULL` — count of unique bookings that were fully reversed (one per booking, not per ledger line).
- **Partial Refunds** = `COUNT(DISTINCT original_record_id) WHERE is_reversal AND is_partial_reversal AND original_record_id IS NOT NULL` — separate KPI tile. Partial refund detection: `abs(refund.netAmount) < abs(original.netAmount)` for the matched original.
- **Orphan Refunds** = `COUNT(*) WHERE is_reversal AND original_record_id IS NULL` — surfaced in a portfolio-level health badge, NOT attributed to any outlet, but their amounts still net into portfolio-level revenue SUM.

**Net behaviour preserved**: `SUM(netAmount)` continues to net reversals correctly (positive original + negative refund). Partial refunds naturally retain the unrefunded portion in revenue.

**KPI strip layout** (sales mode example): `[Bookings] [Cancellations] [Partial Refunds] [Total Sales] [Avg Basket]`. Net Bookings = Bookings − Cancellations is derivable by the operator without dedicated tile.

**Cascade fixes**: rewrites the CSV ingest path (`src/lib/sales-csv.ts`); adds a backfill migration for existing rows; replaces every dashboard's reversal-handling logic; adds `Cancellations` and `Partial Refunds` KPIs across Portfolio, Hotel Groups, Location Groups, Regions, Compare; updates Outlet Tiers and Heat Map to dedupe reversals from COUNT.
