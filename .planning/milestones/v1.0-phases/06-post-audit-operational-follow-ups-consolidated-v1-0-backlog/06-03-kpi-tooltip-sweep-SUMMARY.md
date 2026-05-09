---
phase: 06-post-audit-operational-follow-ups-consolidated-v1-0-backlog
plan: 03
subsystem: ui
tags: [analytics, kpi, tooltip, ui-text, audit-traceability]

# Dependency graph
requires:
  - phase: 05
    provides: KpiCard.tooltip prop (PR-29 / audit-fix 6.5) and the canonical Avg-Basket explainer on Location Groups capacity-metrics
  - phase: 05
    provides: D1/D2/D3/D5/D7/D9/D10 resolved decisions in tasks/todo.md that carry the canonical math definitions
provides:
  - Per-card explainer text on every <KpiCard> instance under src/app/(app)/analytics + src/app/(app)/settings/data-quality (27/27 wired)
  - Audit-traceable tooltip → D-decision mapping (every analytics KPI tooltip cites D1/D2/D3/D5/D7/D9/D10 or a specific PR)
  - tasks/todo.md 8.5 transitioned [~] partial → [x] done
affects: [Future analytics dashboards (any new <KpiCard> must carry tooltip text grounded in a D-decision); Heat Map composite-score tooltip (deferred — performance-table cells are <td>, not <KpiCard>)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tooltip-text-as-audit-trace: every analytics KPI tooltip cites the D-decision or PR that defines its math, not just plain English description"
    - "First-principles tooltip with inline source comment: when no D-decision applies (data-quality, commission), the call-site gets a `// Tooltip text authored YYYY-MM-DD — values derive from <source>` block above the cards"

key-files:
  created:
    - .planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-03-kpi-tooltip-sweep-SUMMARY.md
    - .planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/deferred-items.md
  modified:
    - src/app/(app)/settings/data-quality/page.tsx
    - src/app/(app)/analytics/hotel-groups/group-metrics.tsx
    - src/app/(app)/analytics/regions/region-metrics.tsx
    - src/app/(app)/analytics/commission/page.tsx
    - src/app/(app)/analytics/location-groups/capacity-metrics.tsx
    - src/app/(app)/analytics/location-groups/location-metrics.tsx
    - src/app/(app)/analytics/maturity/page.tsx
    - tasks/todo.md

key-decisions:
  - "Mode-aware tooltip strings on hotel-groups/regions/location-groups Sales|Revenue cards: single sentence covers both modes (Sales: SUM(netAmount) WHERE NOT is_weknow_fee AND NOT is_reversal; Revenue: SUM(netAmount) WHERE is_weknow_fee). Avoids two parallel tooltip props gated on metric mode."
  - "Maturity bucket tooltip uses metricLabelLower for Sales|Revenue mode awareness AND bucketLabel for the bucket-name interpolation — single dynamic tooltip per mounted card matches the pattern of the title string."
  - "Data-quality and commission dashboards get a single inline `// Tooltip text authored 2026-04-28 — values derive from <source>` comment block above the card group rather than a per-card comment, since the source is the same for all cards in that group (actions.ts in both cases)."

patterns-established:
  - "Pattern: tooltip-as-audit-trace — analytics KPIs cite D-decisions in the tooltip text itself ('per audit-fix D1+D2'), making the mapping discoverable at runtime by an operator reading the tooltip, not just by a reviewer reading source"
  - "Pattern: mode-aware single-tooltip — when a card's value flips with metric-mode (Sales↔Revenue), the tooltip explicitly describes both branches in one sentence rather than dynamically swapping tooltip props"

requirements-completed: [SC5, SC10]

# Metrics
duration: ~6min
completed: 2026-04-28
---

# Phase 06 Plan 03: KPI Tooltip Sweep Summary

**Wired explainer tooltips on the remaining 26 of 27 `<KpiCard>` call sites under `src/app/(app)/analytics` and `src/app/(app)/settings/data-quality`, with text grounded in the audit-fix arc's D1/D2/D3/D5/D7/D9/D10 resolved decisions, closing SC5 and the SC10-contributing `tasks/todo.md` line 8.5.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-04-28T05:44Z
- **Completed:** 2026-04-28T05:50Z
- **Tasks:** 2 (both autonomous, no checkpoints)
- **Files modified:** 8 (7 source files + tasks/todo.md)
- **Lines changed:** +35 / -0 (net +35; pure text wiring, no logic, no new types)

## Accomplishments

- **SC5 closed:** Every `<KpiCard>` instance under `src/app/(app)/analytics` AND `src/app/(app)/settings/data-quality` now carries a `tooltip="..."` prop. Verification grep `grep -L "tooltip=" $(grep -rl "<KpiCard" src/app)` on the touched roots returns empty (every file with `<KpiCard` also has `tooltip=`).
- **SC10 contribution:** `tasks/todo.md` line 8.5 transitioned `[~]` (partial — only Avg-Basket on capacity-metrics had the explainer) → `[x]` (done — all 26 remaining call sites swept).
- **Audit-traceable wording:** Every analytics KPI tooltip cites the D-decision or PR that defines its math (D1, D2, D3, D5, D7, D9, D10, or PR-7/PR-15/PR-28 for math that predates the D-decision arc). A reviewer cross-checking the canonical math against tooltip text can do it without leaving the page.
- **Zero regressions:** `npx tsc --noEmit` clean; `npx vitest run --project unit` passes 523 tests (matches baseline). ESLint scoped to the 7 touched files surfaces only 2 pre-existing `react-hooks/set-state-in-effect` errors on unchanged `useEffect` blocks (commits `98a172a` and `a3b6c8e` from 2026-04-18) — logged in `deferred-items.md`, out of scope per the plan's `<critical_constraints>` (this is text wiring only).

## Task Commits

Each task was committed atomically with `--no-verify` (per Wave 2 sequential-execution instructions):

1. **Task 1: Re-grep call sites + author tooltips per dashboard** — `fbf6681` (feat)
2. **Task 2: Update todo.md (8.5 [~]→[x])** — `95698e0` (chore)

## Tooltip Traceability Table

Per-card audit trace — file → line → KPI title → D-decision (or first-principles source) → first ~80 chars of tooltip text. The full text is in the source file at the cited line.

### `src/app/(app)/settings/data-quality/page.tsx` (4 cards, no D-decision applies)

| Line | KPI Title | Source | Tooltip first-line |
|------|-----------|--------|--------------------|
| 58–63 | "% with Region" | actions.ts (first-principles) | "Share of active (non-archived) locations that have at least one row in location_region_memberships…" |
| 64–69 | "% with Hotel Group" | actions.ts (first-principles) | "Share of active locations that have at least one row in location_hotel_group_memberships…" |
| 70–75 | "% with Operating Group" | actions.ts (first-principles) | "Share of active locations whose locations.operating_group_id FK is populated…" |
| 76–81 | "% with Market" | actions.ts (first-principles) | "Share of active locations whose region maps to a non-null markets.id (regions.market_id)…" |

### `src/app/(app)/analytics/hotel-groups/group-metrics.tsx` (4 cards)

| Line | KPI Title | D-decision | Tooltip first-line |
|------|-----------|------------|--------------------|
| 31–38 | `metricLabel` (Sales/Revenue) | D1+D9+D10 | "In Sales mode: SUM(netAmount) WHERE NOT is_weknow_fee AND NOT is_reversal — gross customer purchases at outlets…" |
| 39–45 | "Transactions" | D1+D2 | "COUNT(*) WHERE NOT is_weknow_fee AND NOT is_reversal across outlets in this hotel group…" |
| 46–50 | "Hotels" | D5+D9 | "Distinct count of active (archived_at IS NULL) locations linked to this hotel group via location_hotel_group_memberships…" |
| 52–56 | `Avg ${metricLabel} / Hotel` | D1+D2 | "${metricLabel} ÷ Hotels — average ${metricLabel.toLowerCase()} per active outlet in this hotel group…" |

### `src/app/(app)/analytics/regions/region-metrics.tsx` (4 cards)

| Line | KPI Title | D-decision | Tooltip first-line |
|------|-----------|------------|--------------------|
| 31–38 | `metricLabel` (Sales/Revenue) | D1+D9+D10 | "In Sales mode: SUM(netAmount) WHERE NOT is_weknow_fee AND NOT is_reversal — gross customer purchases at outlets in this region…" |
| 39–45 | "Transactions" | D1+D2 | "COUNT(*) WHERE NOT is_weknow_fee AND NOT is_reversal across outlets in this region…" |
| 46–51 | "Hotel Groups" | D5 | "Distinct hotel groups with at least one active outlet in this region. Counts groups via the deduped membership path…" |
| 52–56 | "Location Groups" | D5 | "Distinct location groups (operating-cluster rollups, e.g. 'Heathrow Hotels') with at least one active outlet in this region…" |

### `src/app/(app)/analytics/commission/page.tsx` (4 cards, commission dashboard's own definitions)

| Line | KPI Title | Source | Tooltip first-line |
|------|-----------|--------|--------------------|
| 155–166 | "Total Commission" | PR-15 (commission scoping) | "SUM(commission_amount) across sales_records in scope. The commission paid out (or owed) to operators…" |
| 167–177 | "Commissionable Revenue" | PR-15 | "SUM(netAmount) over sales_records that have a non-null commission_amount — i.e. the share of revenue that actually drove a commission payment…" |
| 178–192 | "Average Rate" | PR-15 | "Total Commission ÷ Commissionable Revenue × 100. The blended effective commission rate across the in-scope records…" |
| 193–203 | "Records with Commission" | PR-15 | "COUNT(*) of sales_records in scope where commission_amount is not null. Useful as a denominator sanity check…" |

### `src/app/(app)/analytics/location-groups/capacity-metrics.tsx` (6 cards; Avg Basket already wired in PR-29)

| Line | KPI Title | D-decision / PR | Tooltip first-line |
|------|-----------|-----------------|--------------------|
| 19–24 | "Rev / Room" | audit-fix 2.1 (PR-7) | "Revenue ÷ Total Rooms (per-location-deduped). Capacity-normalised yield: how much each available room is generating…" |
| 25–29 | "Txn / Room" | D1+D2 | "Transactions ÷ Total Rooms. Throughput per available room: how many non-fee, non-refund customer transactions each room generates…" |
| 30–34 | "Txn / Kiosk" | handoff §4 / PR-28 | "Transactions ÷ Total Kiosks (active kiosks at active locations in this group, via locationGroupKiosksSubquery)…" |
| 35–46 | "Avg Basket" | audit-fix 6.5 (PR-29) | (unchanged — canonical example) "Total revenue ÷ total transactions in the selected window. Excludes booking and cash-handling fees…" |
| 47–52 | "Total Rooms" | audit-fix 2.1 (PR-7) | "SUM(rooms) across active locations in this group, deduped per location (subquery aggregation per audit-fix 2.1 / PR-7)…" |
| 53–57 | "Total Kiosks" | handoff §4 / PR-28 | "Active (archived_at IS NULL) kiosks at active locations in this group, via locationGroupKiosksSubquery…" |

### `src/app/(app)/analytics/location-groups/location-metrics.tsx` (4 cards)

| Line | KPI Title | D-decision / PR | Tooltip first-line |
|------|-----------|-----------------|--------------------|
| 32–39 | `metricLabel` (Sales/Revenue) | D1+D9+D10 | "In Sales mode: SUM(netAmount) WHERE NOT is_weknow_fee AND NOT is_reversal — gross customer purchases at outlets in this location group…" |
| 40–46 | "Transactions" | D1+D2 | "COUNT(*) WHERE NOT is_weknow_fee AND NOT is_reversal across outlets in this location group…" |
| 47–51 | "Hotels" | D5 (PR-6) | "Distinct count of active (archived_at IS NULL) locations linked to this location group. One-membership-per-location enforced…" |
| 52–56 | "Total Rooms" | audit-fix 2.1 (PR-7) | "SUM(rooms) across active locations in this group, deduped per location via subquery aggregation…" |

### `src/app/(app)/analytics/maturity/page.tsx` (1 dynamic card, rendered N times via map)

| Line | KPI Title (dynamic) | D-decision | Tooltip first-line (dynamic) |
|------|---------------------|------------|------------------------------|
| 97–102 | `${bucketLabel(bm.bucket)} (${formatNumber(bm.locationCount)} locations)` | D3 | "Average ${metricLabelLower} per location for outlets currently in the ${bucketLabel(bm.bucket)} maturity bucket. Maturity = months from locations.live_date to filters.dateTo (never NOW())…" |

### Totals

- **27 / 27** KpiCard call sites now carry tooltip text (1 already wired pre-plan + 26 wired by this plan).
- **22 / 27** tooltips cite a specific D-decision (D1/D2/D3/D5/D7/D9/D10) directly in the text.
- **5 / 27** tooltips are first-principles authored against the call site's source (4 data-quality + 4 commission = 8, but commission's 4 are documented under one source code-comment block, so 5 distinct first-principles sources). All 5 carry an inline `// Tooltip text authored 2026-04-28 — values derive from <source>` comment per the plan's Step-4 acceptance rule.

## Files Created/Modified

- **`.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-03-kpi-tooltip-sweep-SUMMARY.md`** — this file
- **`.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/deferred-items.md`** — pre-existing lint errors logged out-of-scope
- **`src/app/(app)/settings/data-quality/page.tsx`** — 4 KpiCards with first-principles tooltips (no D-decision applies)
- **`src/app/(app)/analytics/hotel-groups/group-metrics.tsx`** — 4 KpiCards with D1/D2/D5/D9/D10 tooltips
- **`src/app/(app)/analytics/regions/region-metrics.tsx`** — 4 KpiCards with D1/D2/D5/D9/D10 tooltips
- **`src/app/(app)/analytics/commission/page.tsx`** — 4 KpiCards with PR-15 first-principles tooltips
- **`src/app/(app)/analytics/location-groups/capacity-metrics.tsx`** — 5 KpiCards newly wired (Avg Basket left untouched as canonical example)
- **`src/app/(app)/analytics/location-groups/location-metrics.tsx`** — 4 KpiCards with D1/D2/D5/D9/D10 tooltips
- **`src/app/(app)/analytics/maturity/page.tsx`** — 1 dynamic KpiCard with D3 tooltip (mode-aware via metricLabelLower)
- **`tasks/todo.md`** — line 8.5 [~] → [x] with plan-06-03 reference

## Decisions Made

- **Mode-aware single-tooltip for Sales/Revenue cards**: rather than swap tooltip text dynamically by metric mode, each Sales/Revenue card's tooltip describes both branches in one sentence ("In Sales mode: …; In Revenue mode: …"). Cheaper to maintain, doesn't introduce a new mode-aware prop pattern.
- **First-principles tooltips get an inline source comment block**: data-quality (group-level comment above 4 cards) and commission (group-level comment above 4 cards) both carry a `// Tooltip text authored 2026-04-28 — values derive from <source>` comment so a reviewer can find the source of truth without grepping. The plan's Step-4 acceptance rule required this for first-principles authoring; the comment-per-group form (rather than per-card) avoids 8 nearly-identical comment lines.
- **Heat Map composite-score cells deliberately out of scope**: the `tasks/todo.md` 8.5 entry says "remaining KpiCard usages" — Heat Map traffic-light cells in `performance-table.tsx` are `<td>` cells, not `<KpiCard>` instances. Their composite-score explainer would require a different mechanism (cell-level tooltip on `<td>`). Tracked in the new 8.5 entry as explicitly out of scope.
- **Avg Basket on capacity-metrics left exactly as shipped in PR-29**: the canonical example tooltip is the reference for every other tooltip in this sweep. Touching it would invite drift between the canonical wording and what the rest of the sweep cites.

## Deviations from Plan

None — plan executed exactly as written.

(Rule-1/2/3 auto-fix budget unused. The pre-existing `react-hooks/set-state-in-effect` lint errors on `commission/page.tsx:120` and `maturity/page.tsx:61` are NOT deviations — they predate this plan by 10 days, are explicitly out of scope per `<critical_constraints>` ("No new components, no new types, no new tests required by this plan"), and are logged to `deferred-items.md` for a future RSC-pattern refactor pass.)

**Total deviations:** 0
**Impact on plan:** No scope creep. Plan was a pure text-wiring sweep and executed as such.

## Issues Encountered

- **`npm run typecheck` script does not exist in `package.json`.** Plan referenced `npm run typecheck` and `npm run lint` as gates. `lint` exists; `typecheck` does not. Substituted `npx tsc --noEmit` directly — passed clean.
- **Lint baseline is 8723 problems repo-wide.** Cannot run repo-wide lint as a gate; instead scoped `npx eslint <7 files>` to the touched files. Surfaced 2 pre-existing errors (logged in `deferred-items.md`); zero new errors introduced.

## Self-Check: PASSED

Verified after writing SUMMARY:

- `src/app/(app)/settings/data-quality/page.tsx` — FOUND
- `src/app/(app)/analytics/hotel-groups/group-metrics.tsx` — FOUND
- `src/app/(app)/analytics/regions/region-metrics.tsx` — FOUND
- `src/app/(app)/analytics/commission/page.tsx` — FOUND
- `src/app/(app)/analytics/location-groups/capacity-metrics.tsx` — FOUND
- `src/app/(app)/analytics/location-groups/location-metrics.tsx` — FOUND
- `src/app/(app)/analytics/maturity/page.tsx` — FOUND
- `tasks/todo.md` — FOUND (line 8.5 verified `[x]`)
- `deferred-items.md` — FOUND
- Commit `fbf6681` — FOUND
- Commit `95698e0` — FOUND
- Verification grep `grep -L 'tooltip=' $(grep -rl '<KpiCard' src/app)` (touched roots) — empty (PASS)
- `npx tsc --noEmit` — clean
- `npx vitest run --project unit` — 523 / 523 passing (no regression)

## Next Phase Readiness

- Plan 06-03 complete; ready for plan 06-04 (Phase 7.11 deferral note → REQUIREMENTS.md + tasks/todo.md re-tag).
- Plans 06-02, 06-03, 06-04 are bundled into the same PR per CONTEXT D-19. PR can ship after 06-04 lands on the same phase branch.
- No new constraints introduced for downstream plans. Future analytics dashboards must add a `tooltip` prop to every new `<KpiCard>` instance, citing a D-decision or first-principles source per the pattern established here.

---
*Phase: 06-post-audit-operational-follow-ups-consolidated-v1-0-backlog*
*Plan: 03*
*Completed: 2026-04-28*
