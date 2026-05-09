---
phase: 09-poc-underperformance-alerts
plan: 07
type: execute
wave: 5
depends_on: [03, 05, 06]
files_modified:
  - .planning/PROJECT.md
  - .planning/REQUIREMENTS.md
  - .planning/STATE.md
autonomous: true
requirements: [POC-ALERT-01]
must_haves:
  truths:
    - ".planning/PROJECT.md § C reflects the rescope: single POC-ALERT-01 line replaces the original NOTIF/REPORT bullets"
    - ".planning/REQUIREMENTS.md POC-ALERT-01 checkbox is ticked once verification passes"
    - ".planning/STATE.md v1.1 progress incremented (Phase 9 closed)"
  artifacts:
    - path: ".planning/STATE.md"
      provides: "Updated current-position + progress percent + Phase 9 SUMMARY pointer"
    - path: ".planning/REQUIREMENTS.md"
      provides: "POC-ALERT-01 ticked"
    - path: ".planning/PROJECT.md"
      provides: "§ C aligned with rescope"
  key_links:
    - from: ".planning/REQUIREMENTS.md POC-ALERT-01 line"
      to: ".planning/phases/09-poc-underperformance-alerts/09-*-SUMMARY.md files"
      via: "implicit traceability — the SUMMARY files document what was shipped to satisfy the REQ"
---

<objective>
Close out the phase by aligning the planning artifacts with the
shipped state. Three small edits, single commit. CONTEXT.md
§ canonical_refs explicitly calls these out as MUST-edit ("must be
edited by this phase to remove NOTIF-01/02 + REPORT-05/06 and add
POC-ALERT-01" — already done at scoping; this plan ticks the
checkbox + bumps the STATE counters).

Purpose: keep `.planning/` consistent with the codebase; the next
phase planner reads STATE.md to understand current progress and
which REQs are still open. Without this close-out, the v1.1
milestone tracker reports phase 9 as still-executing.

Output:
- 3 file edits (no new files)
- 1 phase-completion commit (per CLAUDE.md GSD preferences — "distinct
  commit summarising the full phase deliverable")
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/STATE.md
@.planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md
</context>

<threat_model>
## Trust Boundaries

(None — pure documentation edits.)

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-07-01 | Repudiation | which dev marked the REQ done | accept | Git commit author + timestamp on the close-out commit. |
| T-09-07-02 | Tampering | accidental drift between PROJECT.md and REQUIREMENTS.md | mitigate | Both are edited in the same commit to keep them in sync. |

ASVS controls: N/A (no runtime surface).
</threat_model>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Tick POC-ALERT-01 in REQUIREMENTS.md</name>
  <files>.planning/REQUIREMENTS.md</files>
  <read_first>
    - .planning/REQUIREMENTS.md (full file — find the POC-ALERT-01 line in § C).
  </read_first>
  <behavior>
    - The POC-ALERT-01 line changes from `- [ ] **POC-ALERT-01** — ...` to `- [x] **POC-ALERT-01** — ...`.
    - No other REQ-IDs are modified.
  </behavior>
  <action>
    1. Open .planning/REQUIREMENTS.md.
    2. Locate the line starting `- [ ] **POC-ALERT-01**` in § C.
    3. Change `[ ]` → `[x]`.
    4. Save.
  </action>
  <verify>
    <automated>grep -q "\\[x\\] \\*\\*POC-ALERT-01\\*\\*" .planning/REQUIREMENTS.md &amp;&amp; echo OK</automated>
  </verify>
  <done>
    - Checkbox ticked.
    - No other lines changed.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Align .planning/PROJECT.md § C with the rescope</name>
  <files>.planning/PROJECT.md</files>
  <read_first>
    - .planning/PROJECT.md (full file — locate § C, originally titled "C. Notifications & scheduled reports" per CONTEXT.md § canonical_refs).
    - .planning/REQUIREMENTS.md § C (the canonical text now in REQUIREMENTS — copy the rescope summary into PROJECT.md).
  </read_first>
  <behavior>
    - § C heading retitled to "C. POC underperformance alerts" (or similar — match the REQUIREMENTS.md heading exactly).
    - The bullet list under § C is replaced with a single line summarising POC-ALERT-01.
    - Surrounding sections (A, B, D, E, F) are unchanged.
  </behavior>
  <action>
    1. Open .planning/PROJECT.md.
    2. Locate § C (likely "## C. Notifications & scheduled reports" or similar).
    3. Retitle to "## C. POC underperformance alerts" (match the heading style + capitalisation used elsewhere in the file).
    4. Replace the bullet list with a single line of plain prose:
       ```
       Single weekly Inngest cron emails kiosk POCs when their `Live` kiosks
       fall into the bottom outlet-tier classification. Admin-only per-kiosk
       silencing; admin read-only `/admin/performance-alerts` page with manual
       "Run now" trigger. Replaces the original v1.1 broader notifications +
       reports scope (rescoped 2026-05-09 — NOTIF-01/02 + REPORT-05/06
       dropped, no v2 carry).
       ```
    5. Save.
  </action>
  <verify>
    <automated>grep -q "POC underperformance" .planning/PROJECT.md &amp;&amp; ! grep -q "NOTIF-01" .planning/PROJECT.md &amp;&amp; echo OK || echo "still references NOTIF-01"</automated>
  </verify>
  <done>
    - Heading updated.
    - NOTIF-01/02, REPORT-05/06 references removed (they remain only in the historical-record sections of REQUIREMENTS.md and CONTEXT.md, which is correct).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Update .planning/STATE.md — Phase 9 closed</name>
  <files>.planning/STATE.md</files>
  <read_first>
    - .planning/STATE.md (full file — particularly the frontmatter `progress` block, `## Current Position` section, `## v1.1 Phase Index`, and `## Session Continuity` section).
  </read_first>
  <behavior>
    - Frontmatter `progress.completed_phases` increments by 1 (1 → 2).
    - Frontmatter `progress.completed_plans` increments by the number of plans shipped in phase 9 (e.g. 1 → 1 + 7 = 8 if all phase 9 plans landed; verify against the actual plan count).
    - Frontmatter `progress.percent` recalculated.
    - Frontmatter `progress.notes` updated to reflect Phase 9 close-out.
    - `## Current Position` updated: phase moves to 10 (Access Control Extended), status="ready to plan", last_activity dated today.
    - `## v1.1 Phase Index` updates the Phase 9 line — change the bullet to a checkmark + add a "MERGED" or "code-complete" tag matching the convention used for Phase 7/8.
    - `## Session Continuity` updated with current session: phase 9 close-out date + next-step pointer to phase 10 / phase 11 (whichever the operator chooses).
    - `## Accumulated Context > Decisions` may add a one-line entry for any new load-bearing decision from phase 9 (e.g. "First-run quiet behaviour locked option (a) per Pitfall 8" if it's load-bearing for future work).
  </behavior>
  <action>
    1. Open .planning/STATE.md.
    2. Edit the frontmatter:
       - `progress.completed_phases`: 1 → 2 (assuming Phase 8 UAT closed; if not, leave at 1 and note Phase 9 separately under "code-complete pending UAT").
       - `progress.completed_plans`: bump by plan count of phase 9 (count the PLAN.md files in `.planning/phases/09-poc-underperformance-alerts/` — likely 7).
       - `progress.percent`: recalculate (completed_phases / total_phases × 100, rounded).
       - `progress.notes`: replace with current state (e.g. "Phase 9 code-complete YYYY-MM-DD; <N> commits ahead of origin/main; verifier returned green; Playwright admin specs green against preview alias.").
       - `last_updated`: today's ISO timestamp.
       - `last_activity`: short summary of phase 9 deliverable.
       - `stopped_at`: brief description of where the session paused.
    3. Edit `## Current Position`:
       - Update phase to next planned (Phase 10 or Phase 11).
       - Status: "ready to plan" or "executing" depending on operator's choice.
       - Last activity: dated today, summary of phase 9 close.
    4. Edit `## v1.1 Phase Index`:
       - Change the Phase 9 line from `- Phase 9: ...` to `- ✓ Phase 9: POC Underperformance Alerts — POC-ALERT-01 — **MERGED YYYY-MM-DD** (PR #<N>)` once the PR merges. If the merge has not happened yet, use the "code-complete; awaiting UAT/merge" form (matching Phase 8's style at the time of writing this plan).
    5. Edit `## Session Continuity`:
       - Current session: today's date + "Phase 9 close-out".
       - Next action: pointer to `/gsd-plan-phase 10` (or 11, depending on the user's choice).
    6. Save.

    Note: This task is the LAST task in the phase. It runs after the phase-completion commit is created — so the commit message + git log can also be cited. Sequencing:
    - Run all earlier plan tasks → tested + verified.
    - Create the phase-completion commit (operator triggers via `/gsd-execute-phase` close hook or manually).
    - Run THIS task (doc updates) → final commit message: `docs(planning): close phase 9 — POC underperformance alerts shipped (POC-ALERT-01)`.
  </action>
  <verify>
    <automated>grep -q "Phase 9" .planning/STATE.md &amp;&amp; ! grep -q "Phase 9: POC Underperformance Alerts.*branch.*ready 2026-05-09" .planning/STATE.md &amp;&amp; echo OK</automated>
  </verify>
  <done>
    - Progress counters updated.
    - Phase index reflects Phase 9 closed.
    - Session continuity points at the next phase.
    - last_updated stamp current.
  </done>
</task>

</tasks>

<verification>
- `grep -q "\[x\] \*\*POC-ALERT-01\*\*" .planning/REQUIREMENTS.md`
- `grep -qi "POC underperformance" .planning/PROJECT.md`
- `grep -q "Phase 9" .planning/STATE.md` (the line should reflect closed/merged state)
- No pre-rescope NOTIF/REPORT bullets in PROJECT.md § C
- Single commit covers all three edits (per CLAUDE.md "phase completion commit" preference)
</verification>

<success_criteria>
1. POC-ALERT-01 ticked in REQUIREMENTS.md.
2. PROJECT.md § C aligned with the rescope.
3. STATE.md progress incremented + phase index updated.
4. Single phase-close-out commit messaged "docs(planning): close phase 9 — POC underperformance alerts shipped (POC-ALERT-01)" or similar (verbose; describes the deliverable per CLAUDE.md GSD preferences).
</success_criteria>

<output>
After completion, create `.planning/phases/09-poc-underperformance-alerts/09-07-SUMMARY.md` with:
- Final progress counters (completed_phases / completed_plans / percent)
- Confirmation that all 3 doc edits landed in a single commit
- Pointer to the phase-completion commit hash
- Pointer to the merged PR (if applicable)
- Suggested next phase (10 or 11)
</output>
