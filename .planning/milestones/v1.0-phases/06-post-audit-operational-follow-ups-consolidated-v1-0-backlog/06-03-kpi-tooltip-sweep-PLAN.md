---
plan_id: 06-03
plan_name: kpi-tooltip-sweep
phase: 6
wave: 2
depends_on: []
requirements_addressed: [SC5, SC10]
files_modified:
  - src/app/(app)/settings/data-quality/page.tsx
  - src/app/(app)/analytics/hotel-groups/group-metrics.tsx
  - src/app/(app)/analytics/regions/region-metrics.tsx
  - src/app/(app)/analytics/commission/page.tsx
  - src/app/(app)/analytics/location-groups/capacity-metrics.tsx
  - src/app/(app)/analytics/location-groups/location-metrics.tsx
  - src/app/(app)/analytics/maturity/page.tsx
  - tasks/todo.md
autonomous: true
estimated_tasks: 2
---

<must_haves>
**Phase 6 is verified for SC5 ONLY when:** every `<KpiCard ... />` JSX call site under `src/app/(app)/analytics/` AND `src/app/(app)/settings/data-quality/page.tsx` includes a `tooltip="..."` prop with text that explains the KPI's math; the text is sourced from the matching D-decision in `tasks/todo.md` (the Resolved Decisions block at lines 168–209) where one applies, otherwise from the audit-fix PR-line description that defined the KPI.

**SC10 contribution:** `tasks/todo.md` line 136 (Phase 8.5) is changed from `[~]` (partial) to `[x]` after the sweep completes.
</must_haves>

<objective>
Pure text-wiring sweep: 27 `<KpiCard>` call sites currently render with no `tooltip` prop. The mechanism (`tooltip?: string` on `KpiCardProps`) shipped in PR-29 / audit-fix 6.5 alongside the canonical Avg-Basket explainer on Location Groups capacity-metrics. This plan adds per-card text on the remaining 26 call sites.

Purpose: every KPI in the analytics surface explains its own math in-place, so operators can disambiguate "Bookings" vs "Cancellations" vs "Total Sales" vs "Avg Basket" without leaving the page. CONTEXT D-19 bundles this with 06-02 + 06-04 in the same low-risk PR.

Output: 27 `KpiCard` calls each have a `tooltip` prop. No new components, no new types, no logic changes.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-CONTEXT.md
@.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-RESEARCH.md
@src/components/analytics/kpi-card.tsx
@tasks/todo.md
@src/app/(app)/analytics/location-groups/capacity-metrics.tsx
</context>

<interfaces>
<!-- KpiCard prop definition (src/components/analytics/kpi-card.tsx:13-24) -->
```typescript
interface KpiCardProps {
  title: string;
  value: string;
  change?: { text: string; color: string; direction: "up" | "down" | "neutral" };
  loading?: boolean;
  primary?: boolean;
  icon?: React.ReactNode;
  tooltip?: string;  // <-- prop already exists; sweep adds text at every call site
}
```

<!-- Canonical reference: Avg Basket tooltip wired in capacity-metrics.tsx:44 -->
```tsx
<KpiCard
  title="Avg Basket"
  value={formatCurrency(avgBasket)}
  tooltip="Average basket value = Total Sales ÷ Transactions. Both terms exclude WKG fees and reversals."
  // ...
/>
```

<!-- Resolved D-decisions in tasks/todo.md (lines 168–209) carrying the canonical math definitions for tooltips -->
- D1 (Booking fee semantics): Transactions = COUNT(*) WHERE NOT is_fee; Total Sales = SUM(netAmount) WHERE NOT is_fee; Total Revenue = SUM(netAmount) WHERE is_fee
- D2 (Reversal handling): Bookings = COUNT(*) WHERE NOT is_fee AND NOT is_reversal; Cancellations = COUNT(DISTINCT original_record_id) WHERE is_reversal AND NOT is_partial_reversal; Partial Refunds = COUNT(DISTINCT original_record_id) WHERE is_reversal AND is_partial_reversal; Orphan Refunds = COUNT(*) WHERE is_reversal AND original_record_id IS NULL
- D7 (Heat Map composite): percentile rank per metric via PERCENT_RANK; weights 30/20/25/15/10
- D9 (Internal-account exclusion): all dashboards default to WHERE location_type != 'internal'
- D10 (is_weknow_fee): renamed from is_booking_fee; covers NetSuite codes 9991 + 9992

<!-- Inventory of 27 call sites (per RESEARCH.md lines 235-247; planner re-greps before authoring to confirm) -->
| File | Line(s) | Cards | Wired |
|------|---------|-------|-------|
| src/app/(app)/settings/data-quality/page.tsx | 52, 58, 64, 70 | 4 | 0 |
| src/app/(app)/analytics/hotel-groups/group-metrics.tsx | 31, 38, 44, 49 | 4 | 0 |
| src/app/(app)/analytics/regions/region-metrics.tsx | 31, 38, 44, 49 | 4 | 0 |
| src/app/(app)/analytics/commission/page.tsx | 151, 162, 172, 186 | 4 | 0 |
| src/app/(app)/analytics/location-groups/capacity-metrics.tsx | 19, 25, 30, 35, 44, 49 | 6 | 1 (line 44) |
| src/app/(app)/analytics/location-groups/location-metrics.tsx | 32, 39, 45, 50 | 4 | 0 |
| src/app/(app)/analytics/maturity/page.tsx | 97 | 1 | 0 |
| **Total** | | **27** | **1** |
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Re-grep call sites + author tooltips per dashboard</name>
  <files>
    src/app/(app)/settings/data-quality/page.tsx,
    src/app/(app)/analytics/hotel-groups/group-metrics.tsx,
    src/app/(app)/analytics/regions/region-metrics.tsx,
    src/app/(app)/analytics/commission/page.tsx,
    src/app/(app)/analytics/location-groups/capacity-metrics.tsx,
    src/app/(app)/analytics/location-groups/location-metrics.tsx,
    src/app/(app)/analytics/maturity/page.tsx
  </files>
  <read_first>
    - src/components/analytics/kpi-card.tsx (lines 13–24 for the prop type; lines 32–50 for the rendered tooltip behaviour)
    - src/app/(app)/analytics/location-groups/capacity-metrics.tsx (line 44 — canonical Avg-Basket tooltip example)
    - tasks/todo.md (lines 168–209 — Resolved Decisions D1–D10 carrying the canonical math definitions)
    - Each of the 7 files in `<files>` above (you must read each one fully before editing — read FIRST, then edit)
  </read_first>
  <action>
**Step 1 — Re-grep before editing.** RESEARCH.md said "27 total" in the inventory but warned the count may have drifted. Run:
```bash
grep -rn "<KpiCard" src/app/\(app\)/analytics src/app/\(app\)/settings/data-quality
```
Confirm the count. If it differs from 27, update this task's working list — but the rule stays the same: every call site gets a `tooltip` prop.

**Step 2 — Author tooltip text per call site.** Tooltips MUST be derived from a D-decision in `tasks/todo.md` lines 168–209 where applicable. Use this mapping table:

| Title (read from `title=` prop) | Source D-decision | Tooltip text to use |
|----------------------------------|-------------------|---------------------|
| "Total Sales" / "Total Revenue" / "Sales" / "Revenue" | D1, D10 | "Total Sales = SUM(netAmount) WHERE NOT is_weknow_fee AND NOT is_reversal. Excludes booking fees (NetSuite 9991), cash handling fees (9992), refund rows, and internal accounts. Per audit-fix D1+D10." |
| "Bookings" / "Transactions" | D1, D2 | "Bookings = COUNT(*) WHERE NOT is_weknow_fee AND NOT is_reversal. Counts only non-fee, non-refund customer transactions. Mode-invariant (same in Sales and Revenue mode). Per audit-fix D1+D2." |
| "Avg Basket" / "Average Basket" | D1, D2 | "Average basket value = Total Sales ÷ Transactions. Both terms exclude WKG fees and reversals." (already present at capacity-metrics.tsx:44 — leave unchanged.) |
| "Cancellations" | D2 | "Cancellations = COUNT(DISTINCT original_record_id) WHERE is_reversal AND NOT is_partial_reversal. Counts unique fully-refunded bookings (one per booking, not per ledger line). Per audit-fix D2." |
| "Partial Refunds" | D2 | "Partial Refunds = COUNT(DISTINCT original_record_id) WHERE is_reversal AND is_partial_reversal. Counts unique partially-refunded bookings; the unrefunded portion stays in revenue. Per audit-fix D2." |
| "Outlets" / "Active Outlets" / "Locations" | D9 | "Active outlets = locations.archived_at IS NULL AND location_type != 'internal'. Internal accounts (e.g. Customer Service / BK) excluded by default; toggle 'Show internal accounts' on the FilterBar to include. Per audit-fix D9." |
| "Avg Revenue per Booking" / "Avg Fee per Booking" | D1 | "Avg Revenue per Booking = Total Revenue (fees only) ÷ Bookings. Sales mode flips to Avg Basket. Per audit-fix D1." |
| "Composite Score" / "Heat Map Score" | D7 | "Composite Score uses PERCENT_RANK per metric (transactions, revenue, avg basket, etc.) with weights 30/20/25/15/10 — preserved on rank-normalised values. Filter-bar scope determines the percentile cohort. Per audit-fix D7." |
| "Top 20%" / "Bottom 20%" / "Outlet Tier" | (plan 06-05 will add the threshold) | "Tier cutoffs: Premium ≥ 80th percentile, Standard 50–79th, Developing 20–49th, Emerging < 20th. Cutoffs editable in /settings/thresholds (Phase 6.5)." |
| "Maturity" / "Months Live" / "Cohort" | D3 | "Maturity buckets (months from live_date to filters.dateTo): 0–1 / 1–3 / 3–6 / 6–9 / 9+. Reference date is always filters.dateTo, never NOW(). Per audit-fix D3." |
| "Commission" / "Total Commission" | (commission dashboard's own def) | (Author per the commission dashboard description; default: "Commission = SUM(commission_amount) WHERE …; see commission-config for tier definitions.") |
| "Data Quality" specific cards (orphan refunds, missing latlng, unmapped outlets) | D2 + audit decisions | Use the literal description that the audit-fix arc established for the data-quality dashboard. Author per-card based on what the value represents. |

**Step 3 — Apply edits.** For EACH of the 7 files: open the file, find every `<KpiCard ...` JSX block, and add a `tooltip="..."` prop using the table above. The tooltip prop should be ordered after `title` and before `value` for grep-ability. Example transformation:

```tsx
// BEFORE
<KpiCard title="Bookings" value={formatNumber(bookings)} primary />

// AFTER
<KpiCard
  title="Bookings"
  tooltip="Bookings = COUNT(*) WHERE NOT is_weknow_fee AND NOT is_reversal. Counts only non-fee, non-refund customer transactions. Mode-invariant. Per audit-fix D1+D2."
  value={formatNumber(bookings)}
  primary
/>
```

**Step 4 — Special-case judgement.** Some KPIs may not match any D-decision exactly (e.g. data-quality dashboard's "Outlets missing lat/lng" — that's a Phase 6 plan 06-06 concept, not a D-decision). For those, author the text from first-principles, anchored to the column/query the value derives from. Note in a code comment above the call site: `// tooltip authored 2026-04-NN — value derives from <SQL or component reference>`.

**Step 5 — DO NOT edit `kpi-card.tsx` itself.** Component logic is correct as shipped. Only call sites change.

**Step 6 — DO NOT edit the Heat Map cells (`performance-table.tsx`).** The audit's call-out in 8.5 says "remaining KpiCard usages" — Heat Map traffic-light cells are NOT `<KpiCard>` instances; they're `<td>` cells. Out of scope.
  </action>
  <verify>
    <automated>
files=$(grep -rl '<KpiCard' src/app/\(app\)/analytics src/app/\(app\)/settings/data-quality); [ -z "$files" ] && { echo "No KpiCard call sites found — re-grep failed"; exit 1; }; test "$(grep -L 'tooltip=' $files | wc -l)" -eq 0
    </automated>
  </verify>
  <acceptance_criteria>
    - Every file in `<files>` contains the literal string `tooltip=` at LEAST as many times as it has `<KpiCard` instances.
    - The shell test command `test "$(grep -L 'tooltip=' $(grep -rl '<KpiCard' src/app/\(app\)/analytics src/app/\(app\)/settings/data-quality) | wc -l)" -eq 0` exits 0 (every file containing `<KpiCard` ALSO contains `tooltip=`).
    - `npm run typecheck` exits 0 (no syntax errors introduced).
    - `npm run lint -- src/app/\(app\)/analytics src/app/\(app\)/settings/data-quality` exits 0.
    - The canonical Avg-Basket tooltip at `src/app/(app)/analytics/location-groups/capacity-metrics.tsx:44` is unchanged (`grep -n "Average basket value" src/app/(app)/analytics/location-groups/capacity-metrics.tsx` returns 1 line — same line as before).
    - Each tooltip text references either a `D` decision (`D1`, `D2`, `D3`, `D7`, `D9`, `D10`) OR an audit-fix PR-line, OR carries a code-comment explaining the source for first-principles authoring (no hand-wavy "this is the X" tooltips).
  </acceptance_criteria>
  <done>
    Every analytics + data-quality `KpiCard` carries explainer text grounded in the audit-fix arc's resolved decisions. Operators can mouse over any KPI and see the canonical math definition.
  </done>
</task>

<task type="auto">
  <name>Task 2: Update todo.md (8.5 [~]→[x]) + per-plan summary commit</name>
  <files>
    tasks/todo.md
  </files>
  <read_first>
    - tasks/todo.md (line 136 — the Phase 8.5 entry currently `[~]` partial)
  </read_first>
  <action>
Edit `tasks/todo.md` line 136. Current state:
```
- [~] **8.5** Document analytics metric definitions in-app (KPI tooltips). — same surface as 6.5; the `KpiCard.tooltip` prop is the documented mechanism. Avg Basket on Location Groups has the canonical explainer wired; remaining KpiCard usages (Portfolio summary, Region metrics, Hotel-group metrics, Heat Map cells, Compare cards) are a follow-up sweep that just needs each call site to add `tooltip="…"`.
```

Change to:
```
- [x] **8.5** Document analytics metric definitions in-app (KPI tooltips). — Phase 6 plan 06-03 (PR #NN) swept all 26 remaining KpiCard call sites under src/app/(app)/analytics + src/app/(app)/settings/data-quality and added per-card tooltip text grounded in the D1/D2/D3/D7/D9/D10 resolved decisions. Heat Map composite-score cells in `performance-table.tsx` deliberately left out of scope (they're `<td>` cells, not `<KpiCard>` instances).
```

Per-plan summary commit on the plan's branch (`gsd/phase-06-kpi-tooltip-sweep` — note the executor may instead bundle this into the same branch as 06-02/06-04 per CONTEXT D-19): `feat(analytics): tooltip text on every KpiCard call site (SC5)`.
  </action>
  <verify>
    <automated>
grep -c '^- \[x\] \*\*8\.5\*\*' tasks/todo.md
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c '^- \[x\] \*\*8\.5\*\*' tasks/todo.md` returns 1.
    - `grep -c '^- \[~\] \*\*8\.5\*\*' tasks/todo.md` returns 0.
    - The plan branch's most recent commit subject contains the literal string `tooltip` and references SC5 (or 8.5).
  </acceptance_criteria>
  <done>
    todo.md reflects the sweep's completion; commit ready for PR.
  </done>
</task>

</tasks>

<verification>
- `npm run typecheck` exits 0
- `npm run lint` exits 0 for the touched files
- The grep test in Task 1's `<automated>` block passes
- `tasks/todo.md` line 136 is checked
</verification>

<success_criteria>
1. SC5 — Every `<KpiCard>` instance under `src/app/(app)/analytics` and `src/app/(app)/settings/data-quality` has a `tooltip` prop with text derived from the audit-fix D-decisions or first-principles where no D-decision matches.
2. SC10 contribution — `tasks/todo.md` line 136 (Phase 8.5) ticks `[x]`.
</success_criteria>

<output>
After completion, create `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-03-SUMMARY.md` listing each call site (file + line + KPI title + tooltip first-line) for review traceability; PR # + merge SHA.
</output>
