---
phase: 10
plan: 13
status: paused
round: 3
reason: 4/8 PASS after Plan 10-14 ships + test-infra env vars populated. Gate ≥6/8 still missed by 2 tests. Remaining failures are ability-eval gap + spec UX-drift + Radix selectOption — all outside Plan 10-14's scope per its own assumptions.
pause_date: 2026-05-11
branch: gsd/phase-10-access-control-extended
head_at_pause: f4bb18a
resume_after: Plan 10-15 (gap-closure-round-3) ships OR operator accepts 4/8 as the verified state OR spec re-shape lands
resume_command: /gsd-execute-phase 10 --gaps-only --wave 8
previous_round_snapshot: .planning/phases/10-access-control-extended/10-13-PARTIAL-r2.md
---

# Plan 10-13 — Pause Note (Round 3)

Plan 10-13 (`Live Playwright UAT against preview alias + doc closeout`) remains **paused**, not failed or complete. The prior round-2 pause note has been preserved as `10-13-PARTIAL-r2.md`. This file captures the state after Plan 10-14 shipped and a fresh Playwright run was executed against the rebuilt preview.

**Acceptance gate (per the plan):** ≥6/8 PASS on the live preview Playwright run.
**Current state:** 4/8 PASS. Below gate by 2 tests.

## Run history

| Run | Date | PASS | FAIL | Log | Notes |
|-----|------|------|------|-----|-------|
| 1 | 2026-05-11 17:24 | 3 | 5 | `/tmp/playwright-10-13.log` | First operator run |
| 2 | 2026-05-11 17:29 | 3 | 5 | `/tmp/playwright-10-13-r2.log` | Re-run; different failure surface on Cluster A |
| 3 | 2026-05-11 19:21 | 3 | 5 | `/tmp/playwright-10-13-r3.log` | Post Plan 10-14, BEFORE fixture env vars discovered (specs hit /api/admin/* which doesn't exist → 404 nav) |
| **4** | **2026-05-11 19:28** | **4** | **4** | `/tmp/playwright-10-13-r4.log` | **Canonical** — post Plan 10-14 AND fixture env vars set |

The +1 gain run 3 → run 4 is attributable to setting `TEST_LOCATION_ID`, `TEST_OPS_IT_ROLE_ID`, `TEST_VIEWER_USER_ID` as env vars before invocation. Without them, the specs' dynamic-discovery API calls (`/api/admin/locations`, `/api/admin/roles`) return null/redirect (those endpoints do not exist in the codebase), the specs navigate to `/locations/null` / `/settings/roles/unknown`, the pages render 404 or query-error, and component-level assertions falsely fail. **This is a test-infra gap, not a source bug.**

## Run 4 result (canonical — post-fixes, post-env)

```
Running 8 tests using 1 worker
4 passed (1.7m), 4 failed

PASS:
  [1/8] can-component     viewer does NOT see Merge button on /locations/[id]
  [3/8] can-component     viewer does NOT see Configure nav-group in sidebar
  [5/8] role-editor       admin can navigate to /settings/roles and see Roles heading
  [7/8] user-role-asg.    admin can navigate to viewer user profile and see role-assignment block   ← NEW PASS

FAIL:
  [2/8] can-component     admin sees Merge button on /locations/[id]
  [4/8] edit-tier         admin modifies Ops-IT rule, sees diff modal with impacted count, saves, ops-it user sees effect
  [6/8] role-editor       admin creates a custom role and sees toast + new row
  [8/8] user-role-asg.    admin assigns Ops-IT role to viewer user with south-west scope
```

## What Plan 10-14 delivered (attribution — fixes WORKED)

| 10-14 Cluster | Spec affected | Predicted effect (from 10-14 acceptance) | Observed effect | Status |
|---|---|---|---|---|
| A (null-guard on /locations/[id] RSC) | can-component | Removes null.map crash; admin Merge button reaches `<Can>` gate | Page now renders fully (snapshot shows `LOCATION_NEEDED` heading + Details/Kiosks/Products tabs — no crash). Merge button still absent. | ✅ Source fix worked — failure mode shifted to ability-eval (assumption #10 path triggered) |
| B/Task 2 (`role="row"` + `aria-label="Remove"` on RuleRow) | edit-tier | Spec advances past line 58-59 (row + remove selectors) | Spec now fails at line 64 (`getByRole('dialog').getByText(/user\(s\) impacted/i)`) — row + remove selectors RESOLVED, save click triggered diff-modal-open, modal text didn't match | ✅ Source fix worked — failure mode advanced 9 lines further |
| B/Task 3 (Description Textarea on Create dialog) | role-editor | Spec advances past line 45 (description fill) | Spec now fails at line 49 (`getByRole('button', { name: /add rule/i })`) — description filled OK, then Add Rule button is on the editor page after create+navigate which doesn't happen | ✅ Source fix worked — failure mode advanced 4 lines further |
| B/Task 4 (aria-label="Role" picker + "Add scope" button) | user-role-assignment | Region landmark stabilises; assign-with-scope advances past Assign role click + Add scope click but stalls at Radix selectOption | **Test #7 region landmark now reliably PASSES.** Test #8 fails because Assign role button is DISABLED (Radix selectOption never set the picker value) | ✅ Source fix worked — region stabilised; assign-with-scope hits the Radix limitation predicted by assumption 5 |

**Conclusion:** Plan 10-14's source fixes shipped correctly and are demonstrably in the preview build (commits `589c979..f4bb18a` on git-branch alias `wkg-command-centre-git-gsd-p-10273a-vedant-kalbag-wkgs-projects.vercel.app`). They produced exactly the behavioural shifts Plan 10-14's `<acceptance>` section predicted. The reason we're at 4/8 not 6-7/8 is two failure modes that 10-14's `<assumptions>` block flagged as out-of-scope.

## Remaining 4 failures — root cause and disposition

### [2/8] can-component admin Merge button — ability-eval gap

**Failure surface:** Page renders cleanly (no crash, no 404, full Details/Kiosks/Products UI visible in snapshot). Merge button not in DOM.

**Per Plan 10-14 assumption #10:** *"If the resumed 10-13 still shows admin sees Merge button on /locations/[id] failing AFTER the null.map fix lands AND pageErrors is empty, the failure mode is NOT in Plan 10-14's scope — it would be an ability-evaluation bug requiring a follow-on Plan 10-15 to inspect build-ability.ts against the test admin's actual userType / role_id / role-text-mirror shape."*

This is the predicted assumption-#10 path. **Owner: Plan 10-15 — ability-eval investigation.** Look at:
- Does the test admin (`admin@weknow.co`) satisfy the `userType === "system"` short-circuit in `src/lib/casl/ability.ts:34`?
- If not, does the admin have a `role_id` row in `user_roles` that grants `(merge, Location)` via `role_permissions`?
- Does `permittedFieldsOf(ability, "Location", "merge")` evaluate to a non-empty set for this admin?

### [4/8] edit-tier diff-modal impacted count — downstream gap

**Failure surface:** Plan 10-14 Task 2 row + remove selectors RESOLVED. Spec advanced 9 lines further (from line 55 to line 64). Now fails at `getByRole('dialog').getByText(/user\(s\) impacted/i)`. The save click fired but either:
- The diff modal didn't open
- The modal opened but the "N user(s) impacted" text uses different copy (e.g. "0 users affected", "X impacted")
- The modal renders but the spec's role-based locator misses it

**Owner: Plan 10-15 OR spec re-shape.** Investigation cheap: read the diff-preview modal source, check the text it emits, align spec copy or wrap copy in `aria-label` matching `/user\(s\) impacted/i`.

### [6/8] role-editor create+Add rule — spec UX-drift

**Failure surface:** Description fill works (Plan 10-14 Task 3). Spec then expects clicking Save in the Create dialog navigates to `/settings/roles/[new-id]` where an `Add rule` button exists. Currently `handleCreate` does `setCreateOpen(false) + refresh` — no navigation. The Add rule button is on the editor page, not the dialog.

**Per Plan 10-14 assumption 5:** *"role-editor.spec.ts:32 'admin creates a custom role...' may STILL TIMEOUT post-Plan-10-14 at one of those downstream selectors... Steps 4-6 require either substantial UX redesign (a unified create-with-rules dialog) OR adding hidden native `<select>` test affordances OR re-spec — none of which fit gap-closure scope."*

**Owner: Spec re-shape OR UX redesign — NOT a Plan 10-14 regression.** Lowest-cost path: split this spec into two — (a) `admin creates a role via dialog and sees toast + new row` (stops at toast) and (b) `admin edits the new role and adds a rule` (starts by navigating to the role editor directly). Both halves pass independently with current source.

### [8/8] user-role-assignment assign-with-scope — Radix selectOption

**Failure surface:** Per error log, `getByRole('button', { name: /assign role/i })` resolves correctly (Plan 10-14 Task 4) but the button is `disabled` because picker has no role selected. Spec at line 76 used `getByLabel(/role/i).selectOption({ label: "ops-it" })` — Playwright's `selectOption` API does not work on Radix Select components.

**Per Plan 10-14 assumption 5 and Task 4 honest-scope note:** This is the documented Radix limitation. The aria-label on the SelectTrigger gives the spec a deterministic locator, but `selectOption` itself is incompatible.

**Owner: Spec re-shape (low-cost) OR Plan 10-15 to add hidden native-select affordance.** Recommended re-shape: replace `selectOption()` with `click() + getByRole('option', { name: 'ops-it' }).click()` — the canonical Radix interaction pattern.

## What is NOT a 10-14 regression

- All 4 source files edited by Plan 10-14 are exactly as the plan specified (verified by orchestrator grep gates pre-merge).
- `tsc --noEmit` exits 0 on the merged tree.
- All 4 spec files pass `--list`.
- Protected paths (migrations/, src/lib/casl/, getLocation, location-detail-form, manage-scopes-dialog, settings/roles/actions.ts) have **zero diffs** from this plan's 5 commits.
- Migration 0054 (commit `7497c12`) preserved.
- The 3 originally-passing tests (`viewer-no-Configure`, `admin-sees-Roles-heading`, `viewer-no-merge`) STILL PASS — no regressions.

## Test infrastructure note (durable fix candidate)

The access-control specs depend on three env vars to skip API discovery against non-existent `/api/admin/*` endpoints:

```bash
TEST_LOCATION_ID=<any UUID from locations table on preview DB>
TEST_OPS_IT_ROLE_ID=<roles.id WHERE name='ops-it' on preview DB>
TEST_VIEWER_USER_ID=<user.id WHERE email='viewer.test@weknowgroup.com' on preview DB>
```

Without these, the specs fall through to API calls that return 404/redirect → `getXxxId()` returns null → spec navigates to `/locations/null` etc. → 404/query-error page → assertion fails for the wrong reason. Run-4 (4/8) used these env vars; runs 1-3 (3/8) did not.

The right durable fix is a Playwright `globalSetup` that pulls these IDs from the DB before tests run — that is a Plan 10-15 scope item. Until then, the operator command to populate (after `set -a; source .env.preview; set +a`):

```bash
psql "$DATABASE_URL" -t -A -c "
SELECT 'TEST_LOCATION_ID=' || (SELECT id FROM locations LIMIT 1)
UNION ALL SELECT 'TEST_OPS_IT_ROLE_ID=' || (SELECT id FROM roles WHERE name='ops-it' LIMIT 1)
UNION ALL SELECT 'TEST_VIEWER_USER_ID=' || (SELECT id FROM \"user\" WHERE email='viewer.test@weknowgroup.com' LIMIT 1);
" > /tmp/test-fixture-ids.txt
```

Then `set -a; source /tmp/test-fixture-ids.txt; set +a` and re-run.

## Proposed paths forward (operator picks)

**Path A — Open Plan 10-15 (gap-closure-round-3):**
- Task 1: Diagnose ability-eval for admin → grant `(merge, Location)` correctly.
- Task 2: Align diff-preview modal copy or aria-label with `/user\(s\) impacted/i`.
- Task 3: Add a Playwright `globalSetup` that populates the 3 fixture env vars from the preview DB (durable fix).
- Task 4 (optional): Replace `selectOption()` on Radix Selects with click + option-click in specs 3 + 5 (or add hidden `<select>` test affordance to the SelectTrigger).
- Estimated effect: 7-8/8 PASS achievable.

**Path B — Accept 4/8 as the verified state for this phase:**
- Document the 4 failures in 10-VERIFICATION.md as `status: human_needed` with explicit "out-of-scope-for-this-phase" disposition.
- Add a follow-on ticket to v1.2 backlog covering the spec re-shape + ability-eval audit.
- Mark Phase 10 close (HEAD `f4bb18a`) as verified to the extent the test surface allows.

**Path C — Spec re-shape only (no source changes):**
- Edit specs 3, 5, 8 to use canonical Radix interaction patterns instead of `selectOption()`.
- Split spec 6 into create-only + edit-and-add-rule.
- Re-run; expected gain ≥2 tests → 6-7/8.
- Cheaper than Path A but does not address the ability-eval bug (test 2 stays FAIL).

**Recommendation:** Path A — it's the only path that addresses the ability-eval bug (a genuine product issue, not a test issue). Path C is a fallback if Plan 10-15 cannot be opened immediately.

## Preserved state

- Commit `7497c12` (migration 0054) preserved verbatim.
- Plan 10-14's 5 commits (`589c979`, `f0136df`, `99699be`, `210dc4f`, `f4bb18a`) all on `gsd/phase-10-access-control-extended` HEAD.
- No edits to: STATE.md, ROADMAP.md (orchestrator-owned; will only update once 10-13 actually closes), 10-VERIFICATION.md, 10-HUMAN-UAT.md, deferred-items.md (Task 4 of 10-13 belongs in the final SUMMARY).
- Round-2 pause note preserved at `10-13-PARTIAL-r2.md`.

## Resume condition

Resume Plan 10-13 (write `10-13-SUMMARY.md` + Task 4 doc closeout) when:
1. Plan 10-15 (or equivalent) ships AND a re-run reaches ≥6/8 PASS, OR
2. Operator accepts Path B (4/8 documented as the verified state), OR
3. Path C completes a spec re-shape that drives the gate to ≥6/8.

In all three cases, the resumed run is invoked via `/gsd-execute-phase 10 --gaps-only --wave 8`.
