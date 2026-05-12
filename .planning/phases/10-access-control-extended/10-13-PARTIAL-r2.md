---
phase: 10
plan: 13
status: paused
reason: 5 Playwright failures handed off to follow-on Plan 10-14 (gap-closure-round-2)
pause_date: 2026-05-11
branch: gsd/phase-10-access-control-extended
head_at_pause: 7497c12
resume_after: Plan 10-14 ships and Vercel preview rebuilds
resume_command: /gsd-execute-phase 10 --gaps-only --wave 8
---

# Plan 10-13 — Pause Note

Plan 10-13 (`Live Playwright UAT against preview alias + doc closeout`) is **paused**, not failed or complete. It will be resumed AFTER follow-on Plan 10-14 ships the source-level fixes for the 5 failure clusters captured below.

This file is the formal pause marker. **No `10-13-SUMMARY.md` has been committed** — that file is reserved for the final SUMMARY written after the resumed run reaches the ≥6/8 PASS acceptance gate.

## Status

- **Tasks 1-2: COMPLETE** (operator handoff + preview DB state verified)
- **Task 3: PARTIAL** (Playwright run executed; 3/8 PASS — below the ≥6/8 acceptance gate)
- **Task 4: NOT STARTED** (doc updates deferred until the resumed run completes)

10-VERIFICATION.md, deferred-items.md, 10-HUMAN-UAT.md, STATE.md, and ROADMAP.md are **NOT touched** by this pause. Those updates belong in 10-13's final SUMMARY after the re-run, not here.

## What completed

1. **Migration 0054 fix shipped** — Commit `7497c12` (`fix(10): widen role_permissions UNIQUE to include inverted; restore dropped read-only Location inverted rule`) is on `origin/gsd/phase-10-access-control-extended` and has been picked up by the Vercel preview rebuild.

2. **Task 2 verifications passed against preview DB** —
   - `migrations/meta/_journal.json` length confirmed (Plan 10-09 journal-sync intact)
   - 3 roles seeded (admin, ops-it, read-only) on the Neon preview DB
   - `role_permissions` count meets the ≥23 floor
   - `user_scopes WHERE role_id IS NULL` returns 0 (0052 gate satisfied)
   - Canonical `scripts/seed-test-users.ts` (Plan 10-10) ran cleanly; TEST_OPS_IT + TEST_VIEWER are present with correct `user_roles` links

3. **Env-var hygiene fixes on Vercel preview** —
   - `BETTER_AUTH_URL` confirmed pinned to the git-branch alias (per CLAUDE.md `## Vercel preview env vars`), not a per-deploy `<hash>` URL
   - `.env.preview` pulled via `vercel env pull --environment=preview --git-branch=gsd/phase-10-access-control-extended`
   - Admin credentials confirmed and used as one-shot env vars (not persisted to disk)

4. **Two Playwright runs executed against the preview alias** —
   - Run 1: `/tmp/playwright-10-13.log` (mtime 2026-05-11 17:24) — 3 PASS / 5 FAIL, exit non-zero
   - Run 2 (re-run): `/tmp/playwright-10-13-r2.log` (mtime 2026-05-11 17:29) — 3 PASS / 5 FAIL, exit non-zero, different failure surface on cluster A
   - Suite executed (not just `--list`) — CLAUDE.md `## Playwright specs against preview deploys` merge gate is satisfied for the execution-attempt requirement, but the PASS gate is NOT yet met

## What did NOT complete

- **Task 3 acceptance gate (≥6/8 PASS).** Both runs returned 3/8 PASS. The 5 failures cluster into 2 root-cause groups (A and B below) which require source-level fixes, not flake mitigation. Re-running 10-13 against the current preview will not change the result.
- **Task 4 doc updates.** Updating 10-VERIFICATION.md `status: verified`, resolving DEFERRED-10-02, writing the `Gap Closure Wave (Plans 10-09..10-13)` section, appending the STATE.md close entry, and the 10-HUMAN-UAT.md post-gap-closure run note — all deferred to the final SUMMARY phase.
- **`10-13-SUMMARY.md`.** Intentionally not written.

## The 5 failure clusters

Tally across the two runs: 3/8 PASS each run (`viewer-no-merge` only PASSed in run 1; the other 2 PASSes were `viewer-no-Configure` and `admin-sees-Roles-heading` — stable across both).

### Cluster A — `/locations/[id]` runtime null.map error

**Spec assertions that failed:**

- Run 2 only: `tests/access-control/can-component.spec.ts:57` — `viewer does NOT see Merge button on /locations/[id]`
  - Failure mode: **NOT** a selector miss. The page renders, but `pageErrors` collects a `TypeError: Cannot read properties of null (reading 'map')` and the final `expect(pageErrors).toEqual([])` assertion fails. The `Merge button not visible` part of the test is actually satisfied (the page errored before the button could render).
  - Stack hint: a `.map(...)` call on `null` somewhere downstream of the `/locations/[id]` data fetch. Likely a nullable list field in the location detail payload being rendered without a null/empty guard (kiosks list? assignments? merges history?).
  - Run 1 PASSed the same test, which suggests the null-map is data-dependent: it fires for some location-id values and not others. The location-id is resolved via `await page.request.get("/api/admin/locations")` and `locations[0]?.id` — different runs may pick different first-locations.

- Runs 1 & 2: `tests/access-control/can-component.spec.ts:73` — `admin sees Merge button on /locations/[id]`
  - Failure mode: `getByRole('button', { name: /merge/i }).toBeVisible()` times out at 5000ms with `element(s) not found`.
  - This is the **admin path** of the `<Can I="merge" a="Location">` gate Plan 10-12 added. The component is present in source (`src/app/(app)/locations/[id]/page.tsx` per Plan 10-12 SUMMARY) but does not render on preview. Two hypotheses for Plan 10-14 to investigate (in this order):
    1. **The page crashes before the Merge button renders.** Cluster A's null.map likely fires on the admin path too — the admin run might be hitting the same broken location-id and the page errors out before the `<Can>` gate emits the button.
    2. **The CASL ability for admin is missing or mis-spelled.** Less likely given Plan 10-12 SUMMARY claims it shipped, but worth a quick sanity check (`I="merge" a="Location"` vs. `I="merge" a="location"` case sensitivity, or the admin ability builder not granting `manage all` on Location).

  **Plan 10-14 investigation file paths:**
  - `src/app/(app)/locations/[id]/page.tsx` — the page component (look for any `.map(` on potentially-null fields)
  - `src/app/(app)/locations/[id]/*.tsx` — any sub-components rendered from the page
  - `src/lib/abilities/build-ability.ts` (or equivalent — see Plan 10-03 SUMMARY for path) — admin merge Location grant
  - `src/components/ui/can.tsx` — the `<Can>` wrapper

### Cluster B — Role/tier admin UI spec drift

These are 3 distinct failures in 3 different admin flows, but all share the same root cause: **Playwright selectors don't resolve against the rendered DOM on preview.** Each needs a separate look at its target page/component.

- Runs 1 & 2: `tests/access-control/edit-tier.spec.ts:55` — `admin modifies Ops-IT rule, sees diff modal with impacted count, saves, ops-it user sees effect`
  - Failure mode (run 1): `getByRole('heading', { name: /ops.it/i }).toBeVisible()` times out at 5000ms — element not found.
  - Failure mode (run 2): the test reaches further (the heading must have resolved on retry) but then hits the 30000ms test timeout — the downstream rule-edit / diff-modal flow doesn't progress to completion.
  - Investigation: the tier-edit page at `/settings/roles/tier/[name]` (or equivalent) — is the page's H1 actually `Ops-IT` (matches `/ops.it/i`)? If the heading text was changed to e.g. "Ops-IT permissions" or "Edit Ops-IT tier", the regex still matches, but if it's `<h2>` or rendered via `<div role="heading">` without an explicit `aria-level`, `getByRole('heading')` will miss it.
  - Investigation file path: `src/app/(app)/settings/roles/[name]/page.tsx` (or wherever the tier-edit page lives — see Plan 10-05 SUMMARY).

- Runs 1 & 2: `tests/access-control/role-editor.spec.ts` — `admin creates a custom role and sees toast + new row`
  - Failure mode: `Test timeout of 30000ms exceeded.` No specific assertion shown in the log — the test hangs somewhere in the create-role dialog flow before any expectation completes.
  - Investigation: the create-role dialog at `/settings/roles` (the "Create role" button Plan 10-11 made always-rendered) — does clicking it open a dialog whose submit button the spec can find? Walk the spec step-by-step against the live preview to find which step hangs:
    - Open `/settings/roles`
    - Click "Create role" button (per Plan 10-11, always-rendered with aria-hidden icon)
    - Dialog should appear — spec likely calls `getByRole('textbox', { name: /name/i })` and fills it
    - Submit — toast assertion or `getByRole('row', { name: /<role-name>/i })` should match
  - Investigation file path: `src/app/(app)/settings/roles/page.tsx` + the create-role dialog component (likely `src/app/(app)/settings/roles/create-role-dialog.tsx` or similar).

- Runs 1 & 2: `tests/access-control/user-role-assignment.spec.ts` — `admin assigns Ops-IT role to viewer user with south-west scope`
  - Failure mode: `Test timeout of 30000ms exceeded.` Same shape as the role-editor failure — the test hangs in the scope-picker flow, no specific assertion logged.
  - Run 1 also failed test `admin can navigate to viewer user profile and see role-assignment block` at `user-role-assignment.spec.ts:56` — `getByRole('region', { name: /role assignment/i }).toBeVisible()` timed out.
    - Run 2 passed that test (the `region` did resolve on retry), but the downstream `assign-Ops-IT-with-south-west-scope` test still timed out.
  - Investigation: the role-assignment block at `/users/[id]` (or `/settings/users/[id]`) — Plan 10-11 SUMMARY says this was wrapped in `<section role="region" aria-label="Role assignment">`. Why does it not resolve stably? Possibilities:
    1. The section is conditionally rendered (e.g. only for users with a `user_roles` row, or only after a data fetch settles) — the spec arrives too early. Add a `waitFor` or fix the page to render the section eagerly.
    2. The scope-picker dialog (likely opens on clicking "Assign role") — its `dimension type` / `dimension id|value` form fields don't expose the labels the spec expects (per the 10-13 plan threat note about a11y mismatch in scope picker). Spec lines to check: `getByLabel(/dimension type/i)`, `getByLabel(/dimension (id|value)/i)`.
  - Investigation file paths: `src/app/(app)/users/[id]/page.tsx` (or `/settings/users/[id]`), the role-assignment block component, and the scope-picker dialog.

### Screenshots / artifacts

No fresh screenshots were retained for the 2026-05-11 17:24 / 17:29 runs (`test-results/.playwright-artifacts-0/` PNGs are from 2026-04-21). The Playwright HTML report was also overwritten. The textual logs at `/tmp/playwright-10-13.log` and `/tmp/playwright-10-13-r2.log` are the durable record for this pause; copy them into the repo if needed for Plan 10-14:

```bash
mkdir -p .planning/phases/10-access-control-extended/artifacts
cp /tmp/playwright-10-13.log /tmp/playwright-10-13-r2.log \
   .planning/phases/10-access-control-extended/artifacts/
```

(Not done in this pause-commit — `/tmp` is sufficient for the immediate handoff to Plan 10-14, and the files are referenced verbatim above. If `/tmp` is wiped before Plan 10-14 starts, the log excerpts in this PARTIAL note carry the same failure shape.)

## Resume condition

Plan 10-13 resumes when **all** of the following are true:

1. **Plan 10-14 (gap-closure-round-2) has been authored** by the planner. It will target the 2 root-cause clusters above:
   - Cluster A — fix the `/locations/[id]` null.map (and confirm admin Merge gate then renders)
   - Cluster B — fix the 3 selector/spec-drift issues in create-role dialog, edit-tier heading, and assign-scope picker
2. **Plan 10-14 has shipped on the branch** (commits merged into `gsd/phase-10-access-control-extended` and pushed).
3. **Vercel preview rebuilt** with the new commits; the git-branch alias is still pinned to the latest deploy (no `BETTER_AUTH_URL` change needed since the alias survives rebuilds).
4. **Re-run 10-13** via:
   ```
   /gsd-execute-phase 10 --gaps-only --wave 8
   ```
   The orchestrator will re-pick `10-13-PLAN.md` because no `10-13-SUMMARY.md` exists. The Task 1 checkpoint will execute again (operator confirms preview alias + creds), then Task 2 re-verifies preview DB state (idempotent), then Task 3 re-runs the full 8-test Playwright suite. Expected post-Plan-10-14: ≥6/8 PASS, target 8/8.

5. On a successful re-run, Task 4 doc updates and the `10-13-SUMMARY.md` are written THEN (not now), and `10-13-PARTIAL.md` is deleted as part of the same commit (or kept as historical context — operator's call).

## Preserved state (do NOT undo)

- `7497c12` — migration 0054 fix on `origin`. **This is preserved.** Plan 10-14 must NOT revert or rebuild it.
- `gsd/phase-10-access-control-extended` branch HEAD at `7497c12`.
- Plans 10-09 through 10-12 SUMMARY files — their gap-closure work is verified in Task 2 and stands; the remaining 5 failures are NOT regressions in those plans but distinct gaps Plan 10-14 closes.

## Out of scope for this pause

Per operator directive, this PARTIAL commit does **not** touch:
- `10-VERIFICATION.md`
- `deferred-items.md`
- `10-HUMAN-UAT.md`
- `.planning/STATE.md`
- `.planning/ROADMAP.md`
- `REQUIREMENTS.md`

Those files retain their state from before the Task 3 attempt. They will be updated atomically in the resumed run's final SUMMARY commit, reflecting the post-Plan-10-14 PASS state.
