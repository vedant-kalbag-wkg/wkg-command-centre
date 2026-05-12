---
phase: 10
plan: 13
status: paused
reason: 4 Playwright failures persist post-Plan-10-15; below ≥6/8 PASS acceptance gate. Hand off to follow-on Plan 10-16 (gap-closure-round-4).
pause_date: 2026-05-11
branch: gsd/phase-10-access-control-extended
head_at_pause: 5576f07
resume_after: Plan 10-16 ships and Vercel preview rebuilds
resume_command: /gsd-execute-phase 10 --gaps-only --wave 8
prior_pauses: [10-13-PARTIAL.md, 10-13-PARTIAL-r2.md]
---

# Plan 10-13 — Pause Note (Round 4)

Plan 10-13 (`Live Playwright UAT against preview alias + doc closeout`) remains **paused**, not failed or complete. This is the third PARTIAL marker in the gap-closure sequence (r1 → 10-14 → r2 → 10-15 → **r3 (this file)** → 10-16 → resume).

This file is the formal pause marker for round 4. **No `10-13-SUMMARY.md` has been committed** — that file is still reserved for the run that reaches the ≥6/8 PASS acceptance gate.

10-VERIFICATION.md, deferred-items.md, 10-HUMAN-UAT.md, STATE.md, ROADMAP.md, and REQUIREMENTS.md remain **untouched** by this pause. Those updates belong in the final 10-13 SUMMARY commit after the resumed run satisfies the gate.

## Status

- **Tasks 1-2: COMPLETE** (verified across r1/r2/r3; preview DB state is correct; canonical seeder runs cleanly; admin user_roles backfill from Plan 10-15 Branch A confirmed present on preview DB — see "Diagnostic confirmation" below)
- **Task 3: PARTIAL** (round 4 Playwright run executed; 4/8 PASS — below the ≥6/8 acceptance gate)
- **Task 4: NOT STARTED** (doc updates deferred until the resumed run completes)

## Round 4 tally

```
[globalSetup] TEST_LOCATION_ID=23376a11-601f-4206-b218-66b1c9436175
[globalSetup] TEST_OPS_IT_ROLE_ID=794aa7db-578f-4968-b270-733a23195b8b
[globalSetup] TEST_VIEWER_USER_ID=6l-vzsppStvTPWWpfkhpK

  ✓  1 can-component.spec.ts:39 viewer does NOT see Merge button on /locations/[id]   (9.8s)
  ✘  2 can-component.spec.ts:60 admin sees Merge button on /locations/[id]            (10.5s)
  ✓  3 can-component.spec.ts:78 viewer does NOT see Configure nav-group in sidebar    (6.1s)
  ✘  4 edit-tier.spec.ts:39    admin modifies Ops-IT rule, sees diff modal …          (11.6s)
  ✓  5 role-editor.spec.ts:15  admin sees Roles heading                                (5.9s)
  ✘  6 role-editor.spec.ts:32  admin creates a custom role and sees toast + new row   (30.1s)
  ✓  7 user-role-assignment.spec.ts:41 admin sees role-assignment block               (6.3s)
  ✘  8 user-role-assignment.spec.ts:61 admin assigns Ops-IT to viewer with sw scope   (30.0s)

  4 passed, 4 failed (1.9m total)
  Playwright exit code: non-zero
```

Run artifact: `.planning/phases/10-access-control-extended/artifacts/playwright-10-13-r4.log` (152 lines, full failure logs).
Run alias: `https://wkg-command-centre-git-gsd-p-10273a-vedant-kalbag-wkgs-projects.vercel.app` (HEAD `5576f07`).
Run timestamp: 2026-05-11.

## Same PASS count, but the failure surface MOVED on 2 of 4 — what 10-15 actually did

Round 3 (post-10-14, commit `d13c07e`) was 4/8 PASS. Round 4 (post-10-15, this file) is also 4/8 PASS. **The number is identical; the failure shape is not.** Capturing the delta so Plan 10-16's author sees which 10-15 fixes landed and which still need work.

| Spec | Round 3 failure (post-10-14) | Round 4 failure (post-10-15) | Verdict on 10-15 fix |
|------|------------------------------|------------------------------|----------------------|
| `can-component.spec.ts:60` admin Merge | `getByRole('button', /merge/i)` not visible | **same** — `getByRole('button', /merge/i)` not visible | 10-15 commit `85d5820` (admin user_roles backfill) **did NOT** close it. **Diagnostic below confirms backfill landed; failure is downstream of `user_roles`.** |
| `edit-tier.spec.ts:39` diff-modal | Failed early on `/user(s) impacted/i` text not visible in the diff-modal DialogDescription | **Moved past** the diff-modal text assertion; now fails on `getByRole('status').filter({hasText:/saved/i})` (toast assertion at line 75) | 10-15 commit `e4c3da6` (DialogDescription `/user(s) impacted/i`) **DID land**. New blocker: post-save toast role/text mismatch. |
| `role-editor.spec.ts:32` add-rule | Timeout in create-role-dialog flow | **same shape** — timeout waiting for `getByRole('button', /add rule/i)` (line 68) before any Radix selectOption work executes | 10-15 commit `b1c7061` (Radix click+option-click at lines 70+) targeted a step the spec never reaches. The add-rule button itself never becomes clickable. |
| `user-role-assignment.spec.ts:61` scope assign | Timeout in scope-picker flow | **Spec now resolves the `Assign role` button**, but it's **disabled** (locator log: `<button disabled tabindex="0" type="button" data-disabled="" … aria-label="Assign role">`) | 10-15 commit `2637781` (globalSetup populating fixture env vars) **landed** — visible in run stdout `[globalSetup] TEST_VIEWER_USER_ID=6l-vzsppStvTPWWpfkhpK`. New blocker: form-state / button-enablement, not selector-resolution. |

## Diagnostic confirmation (admin user_roles backfill landed)

Performed before pause to disambiguate "fix didn't apply" vs "fix didn't solve":

```
$ psql "$PREVIEW_DATABASE_URL" -t -A -c \
    "SELECT u.email, r.name FROM \"user\" u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.email='vedant.kalbag@weknowgroup.com';"
vedant.kalbag@weknowgroup.com|admin
```

The Plan 10-15 Branch A `user_roles` row for the prod admin **is present** on the Neon preview DB. The admin-Merge failure is therefore **not** a missing-roles bug; it is a CASL ability-eval, ability-builder, or component-conditional issue downstream of `user_roles`. Plan 10-16 should NOT re-run the backfill — it must investigate the CASL ability surface itself.

## Per-failure hand-off recommendations for Plan 10-16

Listed in increasing investigation cost.

### 1. `user-role-assignment.spec.ts:61` — Assign-role button disabled (single highest-confidence fix)

**Concrete evidence in r4 log (lines 95-120):**

```
- waiting for getByRole('button', { name: /assign role/i })
  - locator resolved to <button disabled tabindex="0" type="button"
      data-disabled="" data-slot="button" aria-label="Assign role"
      class="…disabled:pointer-events-none disabled:opacity-50…">Assign role</button>
- attempting click action
  - 49 × waiting for element to be visible, enabled and stable
    - element is not enabled
```

The spec navigates to the viewer user's profile (Plan 10-11 rendered the `region[aria-label="Role assignment"]` correctly — test 7 PASSes), then clicks `Assign role` directly. The button is rendered but `disabled` — the form state requires a role to be selected first before the button enables.

**Plan 10-16 fix candidates (one of):**
- Have the spec populate the role Select dropdown before clicking Assign role (test-side change).
- Have the Assign role button enable on first render with a sensible default role (source-side change). Source-side is preferred IFF the UI also enables the button by default; otherwise the spec is wrong.

Investigation files: `tests/access-control/user-role-assignment.spec.ts:61-90`, and the role-assignment block component (look up its path via Plan 10-11 SUMMARY — likely `src/app/(app)/settings/users/[id]/role-assignment-block.tsx` or similar).

### 2. `edit-tier.spec.ts:39` — Toast assertion fails after save

**Concrete evidence in r4 log (lines 50-72):**

```
Locator: getByRole('status').filter({ hasText: /saved/i })
Expected: visible
Timeout: 5000ms
Error: element(s) not found
```

The spec progresses through `/user(s) impacted/i` (Plan 10-15 commit `e4c3da6` worked) and clicks Save. The save **may** be succeeding silently, but the spec expects a toast in `role="status"` containing the word "saved". Either:
- The save toast text is different (e.g., "Role updated" or "Changes applied" — check the actual toast in the source).
- The toast is rendered without `role="status"` (e.g., as `role="alert"` or no role).
- The save isn't completing — but the test runs for the full 5s timeout window so the API call should have fired.

Investigation: search for the toast call (`toast.success(...)` / `useToast()` invocation) in the diff-modal save handler. Two-line fix to align spec or source.

### 3. `role-editor.spec.ts:32` — `Add rule` button never resolves

**Concrete evidence in r4 log (lines 73-95):**

```
locator.click: Test timeout of 30000ms exceeded.
- waiting for getByRole('button', { name: /add rule/i })
```

The test reaches the create-role dialog (Plan 10-14 added the Description Textarea — commit `99699be`), fills name + description, but then `getByRole('button', { name: /add rule/i })` never resolves within 30s. Plan 10-15's Radix selectOption rewrite (commit `b1c7061`) targeted lines AFTER this — the rewrite never executes because the click before it hangs.

Hypothesis (matches PARTIAL-r2 cluster B note about UX-drift): the "Add rule" affordance in the create-role dialog is either:
- Labeled differently in the rendered DOM (not "Add rule" — check the dialog's actual button text).
- Rendered as a Radix `<DialogTrigger>` or other non-`button` role.
- Conditionally hidden until a subject is picked.

Investigation: open the create-role dialog at `/settings/roles` against preview and inspect the DOM for the rule-adding affordance.

### 4. `can-component.spec.ts:60` — admin Merge button not visible (highest investigation cost)

**Concrete evidence in r4 log (lines 27-46):**

```
Locator: getByRole('button', { name: /merge/i })
Expected: visible
Timeout: 5000ms
Error: element(s) not found
```

The admin path of the `<Can I="merge" a="Location">` gate Plan 10-12 added (`src/app/(app)/locations/[id]/page.tsx`). Plan 10-14 commit `589c979` null-guarded the page (cluster A from r2 was the null.map runtime error) — that fix landed and the page renders cleanly (no `pageErrors` in r4 — only the locator-miss). Plan 10-15 Branch A backfilled the admin's `user_roles` row — also landed (confirmed by diagnostic above). **Two source-side fixes that should have closed this gap did not.**

Plan 10-16 must investigate the CASL ability surface itself:
- `src/lib/abilities/build-ability.ts` (or equivalent path — see Plan 10-03 SUMMARY) — does the admin's ability builder grant `manage all` on `Location`, or is it `can('merge', 'Location')` with a specific subject signature that doesn't match the JSX call site?
- `src/components/ui/can.tsx` — the `<Can>` wrapper. Does the runtime ability resolve `I="merge" a="Location"` correctly with both the user's `user_roles` and the per-role `role_permissions`? Walk a single ability-eval against a known-good admin user/permission set in a unit test if available.
- The location detail page: does the Merge button JSX use the same casing/subject the ability check expects? (`a="Location"` vs `a="location"` — CASL is case-sensitive on subject names.)

This is the highest-cost investigation and the only failure where the source-side root cause is genuinely unclear.

## Cumulative passes / failures across r2, r3, r4

| Test | r2 (post-10-14 baseline) | r3 (post-10-15 first run) | r4 (post-10-15, this) |
|------|--------------------------|---------------------------|----------------------|
| can-component:39 viewer-no-Merge | ✓ | ✓ | ✓ |
| can-component:60 admin-Merge | ✘ | ✘ | ✘ |
| can-component:78 viewer-no-Configure | ✓ | ✓ | ✓ |
| edit-tier:39 diff-modal | ✘ (early) | ✘ (early) | ✘ (later — toast) |
| role-editor:15 Roles heading | ✓ | ✓ | ✓ |
| role-editor:32 add-rule | ✘ | ✘ | ✘ |
| user-role-assignment:41 region | ✓ | ✓ | ✓ |
| user-role-assignment:61 scope-assign | ✘ | ✘ | ✘ (button now resolves but disabled) |
| **PASS / 8** | **4/8** | **4/8** | **4/8** |

The "passing" tests (1, 3, 5, 7) are stable across all three rounds — Plans 10-14 and 10-15 protected them. The "failing" tests have moved closer to acceptance but none have crossed.

## Preserved state (do NOT undo in Plan 10-16)

- All commits `e4c3da6` through `5576f07` (Plan 10-15 work + STATE.md/ROADMAP.md sync) remain on `origin/gsd/phase-10-access-control-extended`. Plan 10-16 must NOT revert any of them — every one of them either fixed a real bug (admin user_roles backfill, /user(s) impacted text, globalSetup env-var populator) or set up infrastructure (Radix Select handling) for the still-failing tests.
- Migrations 0050..0055 remain applied on the Neon preview DB. No new migration is needed for Plan 10-16 (the diagnostic confirms `user_roles` is correct).
- All Plan 10-09 through 10-15 SUMMARY files remain valid.
- The 4 passing tests do NOT need re-investigation.

## Resume condition

Plan 10-13 resumes when **all** of the following are true:

1. **Plan 10-16 (gap-closure-round-4) has been authored** by the planner, targeting the 4 specific clusters above. The plan must prioritize them by investigation cost (1 → 4 in the hand-off list above): start with the disabled-Assign-role-button fix, then toast-text alignment, then add-rule resolution, then CASL admin-Merge eval.
2. **Plan 10-16 has shipped on the branch** (commits merged into `gsd/phase-10-access-control-extended` and pushed).
3. **Vercel preview rebuilt** with the new commits; the git-branch alias remains pinned to the latest deploy (no `BETTER_AUTH_URL` change needed — the alias survives rebuilds).
4. **Re-run 10-13** via:
   ```
   /gsd-execute-phase 10 --gaps-only --wave 8
   ```
   The orchestrator will re-pick `10-13-PLAN.md` because no `10-13-SUMMARY.md` exists. Task 1 checkpoint re-validates the preview alias + creds (no operator action needed if alias unchanged), Task 2 re-verifies preview DB state (idempotent — should be fast), then Task 3 re-runs the 8-test Playwright suite. Expected post-Plan-10-16: ≥6/8 PASS, target 8/8.
5. On a successful re-run, Task 4 doc updates and the `10-13-SUMMARY.md` are written THEN (not now). All three PARTIAL files (r1, r2, r3) may be retained as historical context, or deleted in the SUMMARY commit per the operator's call.

## Out of scope for this pause

Per the plan's pause protocol, this PARTIAL commit does **not** touch:

- `10-VERIFICATION.md`
- `deferred-items.md`
- `10-HUMAN-UAT.md`
- `.planning/STATE.md`
- `.planning/ROADMAP.md`
- `REQUIREMENTS.md`

Those files retain their state from before the Task 3 round-4 attempt. They will be updated atomically in the resumed run's final SUMMARY commit, reflecting the post-Plan-10-16 PASS state.

## Files committed in this pause

- `.planning/phases/10-access-control-extended/10-13-PARTIAL-r3.md` (this file, new)
- `.planning/phases/10-access-control-extended/artifacts/playwright-10-13-r4.log` (152-line full run log, new — copied from `/tmp/playwright-10-13-r4.log`)
