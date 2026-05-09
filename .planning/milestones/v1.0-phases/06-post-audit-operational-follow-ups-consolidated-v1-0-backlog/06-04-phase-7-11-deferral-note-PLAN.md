---
plan_id: 06-04
plan_name: phase-7-11-deferral-note
phase: 6
wave: 2
depends_on: []
requirements_addressed: [SC9, SC10]
files_modified:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - tasks/todo.md
autonomous: true
estimated_tasks: 1
---

<must_haves>
**Phase 6 is verified for SC9 ONLY when:** `.planning/REQUIREMENTS.md` contains an explicit `## Deferred to v2` section (or the existing v2 section gains an entry) with a `REPORT-V2-NN: freeTrialEndDate analytics treatment — deferred from v1.0; pickup tied to maintenance-fee recurring-revenue work` line; AND `tasks/todo.md` line 128 (Phase 7.11) is reworded to carry an explicit `[DEFERRED to v2 maintenance-fee work]` tag instead of being silently unchecked; AND a single grep `grep "REPORT-V2-NN\|freeTrialEndDate" .planning/REQUIREMENTS.md tasks/todo.md` returns ≥ 3 hits.

**SC10 contribution:** `tasks/todo.md` line 128 (Phase 7.11) is no longer "silently unchecked" — it carries an explicit deferral tag.
</must_haves>

<objective>
Pure documentation plan: Phase 7.11 (`freeTrialEndDate` analytics treatment) was resolved as "deferred until maintenance-fee recurring-revenue work lands" per D11 in `tasks/todo.md`. The line is currently unchecked in todo.md but has no record in `.planning/REQUIREMENTS.md`. SC9 wants this explicitly noted so the deferral isn't silently dropped at v1.0 close.

Purpose: forward-traceability. Anyone reading REQUIREMENTS.md after v1.0 ships should see "what was deferred and why". Anyone reading todo.md should see "this isn't pending — it's deliberately deferred".

Output: 3 file edits (REQUIREMENTS.md gains a v2 deferral entry; ROADMAP.md gets a backlink note; todo.md line 128 reworded with [DEFERRED] tag).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-CONTEXT.md
@tasks/todo.md
</context>

<interfaces>
<!-- REQUIREMENTS.md current shape (read tasks lines 1-200 of REQUIREMENTS.md; the file uses checkbox lists per requirement category) -->
<!-- Existing v2 section starts at line 104: "## v2 Requirements" with REPORT-V2-01 (scheduled reports) and REPORT-V2-02 (custom report templates) under "### Reporting (Extended)" -->

<!-- Existing tasks/todo.md line 128 -->
- [ ] **7.11** Analytics treatment of `freeTrialEndDate` deferred — pick up alongside the maintenance-fee recurring-revenue work when that lands (P3, blocked on a future maintenance-fee design decision).

<!-- D11 from tasks/todo.md:21 (Resolved Decisions) -->
- [x] **D11 — `freeTrialEndDate` treatment**: RESOLVED — analytics handling parked until the broader maintenance-fee story exists; sales recorded during trial periods continue to flow into KPIs unflagged for now. Kiosk-management UI gets a "Trial ending soon" surface (see new task 7.10).

<!-- ROADMAP.md Phase 6 success criteria (lines 167-176) lists SC9 -->
9. Phase 7.11 (`freeTrialEndDate` analytics) explicitly noted as deferred (not silently dropped)
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Add deferral entry to REQUIREMENTS.md + retag todo.md + ROADMAP backlink</name>
  <files>
    .planning/REQUIREMENTS.md,
    .planning/ROADMAP.md,
    tasks/todo.md
  </files>
  <read_first>
    - .planning/REQUIREMENTS.md (read fully, all 207 lines — locate the existing `## v2 Requirements` section starting around line 104; locate the Traceability table at line 138 to add the V2 entry)
    - .planning/ROADMAP.md (lines 158–199 — Phase 6 entry where SC9 is listed)
    - tasks/todo.md (line 21 — D11 Resolved Decision; line 128 — the "deferred" line itself)
  </read_first>
  <action>
**Three edits:**

(A) `.planning/REQUIREMENTS.md` — under the `### Reporting (Extended)` heading at line ~110 (in the `## v2 Requirements` section), add a new entry:

```markdown
- **REPORT-V2-03**: Analytics treatment of `freeTrialEndDate` (kiosks during free-trial period flagged in revenue rollups; trial-vs-paid revenue separation) — explicitly deferred from v1.0 per audit-fix D11. Pickup tied to the broader maintenance-fee recurring-revenue work when that lands. See `tasks/todo.md` §7.11 for the original context.
```

Choose `REPORT-V2-03` because REPORT-V2-01 and REPORT-V2-02 already exist (lines 113-114). Confirm by re-reading REQUIREMENTS.md before editing — if a different ID is free, use the next sequential one.

In the Traceability table at line 138, add a new row:
```markdown
| REPORT-V2-03 | Phase 7.11 (deferred) | Deferred — see note at REPORT-V2-03 |
```

Update the Coverage block at the bottom of REQUIREMENTS.md:
```markdown
**Coverage:**
- v1 requirements: 53 total
- ...
- **Deferred to v2:** 1 — REPORT-V2-03 (`freeTrialEndDate` analytics; tied to future maintenance-fee work)
```

Update the file's `*Last updated*` line at the very bottom.

(B) `.planning/ROADMAP.md` — under the Phase 6 success-criteria list (line ~175 area), the SC9 line is currently:
```markdown
  9. Phase 7.11 (`freeTrialEndDate` analytics) explicitly noted as deferred (not silently dropped)
```
Append a backlink:
```markdown
  9. Phase 7.11 (`freeTrialEndDate` analytics) explicitly noted as deferred (not silently dropped) — see REQUIREMENTS.md REPORT-V2-03
```

(C) `tasks/todo.md` line 128 — replace:
```
- [ ] **7.11** Analytics treatment of `freeTrialEndDate` deferred — pick up alongside the maintenance-fee recurring-revenue work when that lands (P3, blocked on a future maintenance-fee design decision).
```
with:
```
- [ ] [DEFERRED to v2: maintenance-fee work] **7.11** Analytics treatment of `freeTrialEndDate` — pickup tied to the broader maintenance-fee recurring-revenue work when that lands. Tracked as REPORT-V2-03 in `.planning/REQUIREMENTS.md`. Per audit-fix Phase 6 plan 06-04 (PR #NN, YYYY-MM-DD).
```

The `[DEFERRED to v2: ...]` tag matches the convention SC10 names ("each remaining one explicitly tagged 'deferred to vNext' with a stated reason").

After Task 1 completes, also commit per CONTEXT D-19 with message: `docs: explicit deferral note for Phase 7.11 / freeTrialEndDate analytics (SC9)`.
  </action>
  <verify>
    <automated>
test "$(grep -c 'REPORT-V2-03\|freeTrialEndDate' .planning/REQUIREMENTS.md tasks/todo.md .planning/ROADMAP.md | awk -F: '{s+=$2} END {print s}')" -ge 5
    </automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "REPORT-V2-03" .planning/REQUIREMENTS.md` returns ≥ 2 (one in the v2 section, one in Traceability table).
    - `grep -c "freeTrialEndDate" .planning/REQUIREMENTS.md` returns ≥ 1 (in the REPORT-V2-03 description).
    - `grep -c "REPORT-V2-03" tasks/todo.md` returns ≥ 1 (in the reworded line 128).
    - `grep -c "\[DEFERRED to v2:" tasks/todo.md` returns ≥ 1.
    - `grep -c "REPORT-V2-03" .planning/ROADMAP.md` returns ≥ 1 (the SC9 backlink).
    - `grep -c "Deferred to v2:.*1" .planning/REQUIREMENTS.md` returns ≥ 1 (Coverage block updated).
    - All three files saved without git conflict markers.
  </acceptance_criteria>
  <done>
    Phase 7.11 is now explicitly traceable from three places: REQUIREMENTS.md (canonical v2 entry), ROADMAP.md (Phase 6 SC9 backlink), tasks/todo.md (deferral tag instead of silent unchecked). The grep test guarantees future grepping for `freeTrialEndDate` finds the deferral context.
  </done>
</task>

</tasks>

<verification>
- The grep aggregate test in Task 1's `<automated>` block passes
- `tasks/todo.md` line 128 carries the `[DEFERRED to v2: ...]` tag
- `.planning/REQUIREMENTS.md` has REPORT-V2-03 in the body, the Traceability table, and the Coverage summary
- `.planning/ROADMAP.md` SC9 line links to REQUIREMENTS.md
</verification>

<success_criteria>
1. SC9 — Phase 7.11 deferral is explicitly noted in REQUIREMENTS.md (REPORT-V2-03), ROADMAP.md (SC9 backlink), and tasks/todo.md (deferral tag).
2. SC10 contribution — `tasks/todo.md` line 128 no longer counts as a "silently unchecked" item; it carries the explicit deferral tag per the SC10 phrasing.
</success_criteria>

<output>
After completion, create `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-04-SUMMARY.md` (short — this is a docs-only plan): file diffs, REPORT-V2-NN ID chosen, PR # + merge SHA.
</output>
