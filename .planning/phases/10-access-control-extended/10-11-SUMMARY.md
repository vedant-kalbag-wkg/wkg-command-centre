---
phase: 10-access-control-extended
plan: 11
subsystem: ui
tags: [a11y, playwright, selector-alignment, gap-closure, aria, role-admin]

# Dependency graph
requires:
  - phase: 10-access-control-extended
    provides: "Plan 10-08 locked Wave-0 Playwright selectors as the spec contract; Plan 10-04 shipped the /settings/roles and /settings/users/[id] pages this plan re-tags."
provides:
  - "/settings/roles Create role button always renders (disabled when !canManage) with deterministic accessible name 'Create role'"
  - "/settings/users/[id] role assignment block exposes a region with accessible name 'Role assignment'"
  - "/settings/users/[id] Assign button has visible text and aria-label 'Assign role' (resolves spec selector even during loading)"
affects: [10-13, 10-uat, playwright-access-control-specs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Disabled-not-hidden client gates so Playwright selectors resolve unconditionally; real authorisation stays server-side"
    - "Defensive aria-label on action buttons whose visible text swaps to a spinner during async state"
    - "aria-hidden on lucide-react icons so they never pollute button accessible names"

key-files:
  created: []
  modified:
    - src/app/(app)/settings/roles/role-list-client.tsx
    - src/app/(app)/settings/users/[id]/role-assignment-client.tsx

key-decisions:
  - "Render the Create role button unconditionally and only disable it when !canManage — guarantees Playwright getByRole resolves regardless of CASL evaluation drift on the preview deploy; server actions still enforce admin"
  - "Wrap the role-assignment Card in <section role='region' aria-label='Role assignment'> rather than retagging the Card itself — keeps the Card's CardHeader/CardTitle layout untouched"
  - "Rename Assign → Assign role with both visible text and aria-label — defensive against the loading state where visible text is replaced by a spinner"

patterns-established:
  - "Presentation-only spec alignment: when a Playwright selector fails on a live page that already has the right business logic, fix the rendered HTML (disabled vs hidden, accessible name, region wrappers) not the spec"

requirements-completed: [AUTH-06, AUTH-07]

# Metrics
duration: ~10min
completed: 2026-05-11
---

# Phase 10 Plan 11: Spec-contract HTML alignment for role-admin pages

**Two presentation-only edits (Create role button always rendered + role-assignment section/aria) close the five UAT-Step-7 selector mismatches without touching any business logic, CASL gates, or server-action signatures.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-11T11:08:00Z (approx)
- **Completed:** 2026-05-11T11:18:46Z
- **Tasks:** 3 (2 code edits + 1 static verification)
- **Files modified:** 2

## Accomplishments
- Replaced conditional Create role button render with unconditional disabled-when-!canManage variant on `/settings/roles`
- Wrapped role-assignment Card in `<section role="region" aria-label="Role assignment">` on `/settings/users/[id]`
- Renamed Assign button (text + aria-label) to "Assign role"; spinner inside is now aria-hidden
- Statically verified all four UAT heading invariants are present in source (`title="Roles"`, `title={result.role.displayName}`, `<h1>` in PageHeader, seed `'Ops-IT'`) — no edits needed for the heading cluster

## Task Commits

Each task was committed atomically:

1. **Task 1: Make Create role button always render (disabled-not-hidden) with aria-hidden icon** — `e74abdc` (fix)
2. **Task 2: Wrap role-assignment in section[role=region], rename Assign → Assign role with aria-label** — `15b28ca` (fix)
3. **Task 3: Verify heading invariants (no-edit)** — covered by static greps in this SUMMARY; no commit required

## Files Created/Modified
- `src/app/(app)/settings/roles/role-list-client.tsx` — Create role button now renders unconditionally; `disabled={!canManage}` replaces the conditional render; `<ShieldPlus aria-hidden="true" />` keeps icon out of accessible name. Diff scoped to the header-bar hunk only (+8/-6).
- `src/app/(app)/settings/users/[id]/role-assignment-client.tsx` — Outer `<section role="region" aria-label="Role assignment">` wraps the existing Card; Assign button renamed to "Assign role" both visually and via `aria-label="Assign role"`; loading-state `<Loader2>` marked `aria-hidden="true"`. Inner JSX re-indented one level (no logic changes; +97/-87 dominated by indentation).

## Static invariants confirmed (Task 3 — no code change)

All four invariants verified by grep against the worktree at HEAD:

| Invariant | File | Line | Match |
| - | - | - | - |
| `title="Roles"` passed to PageHeader | `src/app/(app)/settings/roles/page.tsx` | 28 | found |
| `title={result.role.displayName}` passed to PageHeader | `src/app/(app)/settings/roles/[id]/page.tsx` | 31 | found |
| `<h1` rendered in PageHeader | `src/components/layout/page-header.tsx` | 29 | found |
| Seeded `'Ops-IT'` displayName | `migrations/0051_phase_10_seed_and_backfill.sql` | 27 | found |

These four are the reason the heading-selector cluster (`getByRole('heading', { level: 1, name: 'Roles' })` and `getByRole('heading', { name: /ops.it/i })`) was already satisfied by source. The UAT-Step-7 failures for those selectors were upstream (admin auth/CASL), not source-level defects. Task 1's defensive disabled-button change also addresses the upstream CASL case for the Create button cluster.

## Decisions Made

- **Disabled-not-hidden Create button.** The plan's threat model accepted the minor information-disclosure trade-off (T-10-11-01..03): a non-admin who somehow flips the disabled attribute via devtools still hits the server-side admin gates in `editor-internal.ts` (`createRole`, `deleteRole`, `cloneRole`) and gets `error: not allowed`. Disabled-not-hidden makes the Playwright selector deterministic.
- **Section wrapper outside the Card.** Adding `role="region"` to the existing Card would have implied region semantics on the Shadcn Card primitive globally (or required a one-off prop), both of which leak scope. A simple `<section>` wrapper is the minimal change.
- **Both visible text and aria-label on Assign button.** The button swaps its visible content to a `<Loader2>` spinner while `isAssigning` is true. Without an explicit `aria-label`, the accessible name would drop during loading and the spec selector could miss the button mid-test. Belt-and-braces.

## Deviations from Plan

None — plan executed exactly as written. Both code edits matched the BEFORE/AFTER blocks in the plan verbatim; Task 3's static verification passed all four greps on the first run.

## Issues Encountered

None. Both edits applied cleanly. TypeScript (`npx tsc --noEmit -p tsconfig.json`) reported zero errors after each task.

## Verification evidence

- `grep -q 'disabled={!canManage}' src/app/\(app\)/settings/roles/role-list-client.tsx` — exit 0
- `grep -q 'aria-hidden="true"' src/app/\(app\)/settings/roles/role-list-client.tsx` — exit 0
- `grep -q 'Create role' src/app/\(app\)/settings/roles/role-list-client.tsx` — exit 0
- `grep -q 'role="region"' src/app/\(app\)/settings/users/\[id\]/role-assignment-client.tsx` — exit 0
- `grep -q 'aria-label="Role assignment"' src/app/\(app\)/settings/users/\[id\]/role-assignment-client.tsx` — exit 0
- `grep -q 'aria-label="Assign role"' src/app/\(app\)/settings/users/\[id\]/role-assignment-client.tsx` — exit 0
- `grep -q '"Assign role"' src/app/\(app\)/settings/users/\[id\]/role-assignment-client.tsx` — exit 0
- `grep -c '<section' …role-assignment-client.tsx` = 1 = `grep -c '</section>'` (balanced)
- `npx tsc --noEmit -p tsconfig.json` — `TypeScript: No errors found` (twice — once per task)
- `git diff` after Task 1 confined to the header-bar hunk in `role-list-client.tsx`
- `git diff` after Task 2 confined to `role-assignment-client.tsx`; business-logic call sites (`handleAssign`, `handleRevoke`, `listUserRoles`, `assignRole`, `revokeRole`) intact

## Confirmation: no business-logic or server-action changes

- No edits to `src/app/(app)/settings/roles/actions.ts`, `src/app/(app)/settings/roles/editor-internal.ts`, `src/app/(app)/settings/users/[id]/role-actions.ts`, `src/app/(app)/settings/users/[id]/role-internal.ts`, `src/lib/access/rbac.ts`, `src/lib/auth/lockout-guard.ts`, or `src/lib/auth/refresh-user-role-mirror.ts`.
- CASL gates, lockout-prevention guard, and `refreshUserRoleMirror` call sites all unchanged.
- The audit invariants from `10-VERIFICATION.md` (5/5 SC, dual-path rbac.ts, refreshUserRoleMirror call sites, lockout-guard call sites) remain satisfied.

## Pre-Playwright-run reminder

Plan 10-13 is the operator-run verification gate. After this plan merges and the Vercel preview redeploys:

1. Confirm `BETTER_AUTH_URL` on the preview env is pinned to the git-branch alias (per `CLAUDE.md`).
2. Run the three locked specs against the preview alias:
   - `tests/access-control/role-editor.spec.ts`
   - `tests/access-control/edit-tier.spec.ts`
   - `tests/access-control/user-role-assignment.spec.ts`
3. All five previously-failing selectors should now resolve:
   - `getByRole('heading', { level: 1, name: 'Roles' })` on `/settings/roles`
   - `getByRole('button', { name: /create role/i })` on `/settings/roles`
   - `getByRole('heading', { name: /ops.it/i })` on `/settings/roles/[ops-it-id]`
   - `getByRole('region', { name: /role assignment/i })` on `/settings/users/[viewer-id]`
   - `getByRole('button', { name: /assign role/i })` on `/settings/users/[viewer-id]`

## Self-Check: PASSED

Verified post-write:
- `src/app/(app)/settings/roles/role-list-client.tsx` exists and contains `disabled={!canManage}` and `aria-hidden="true"` — FOUND
- `src/app/(app)/settings/users/[id]/role-assignment-client.tsx` exists and contains `role="region"`, `aria-label="Role assignment"`, `aria-label="Assign role"`, `"Assign role"` — FOUND
- Commit `e74abdc` (Task 1) present in `git log --oneline` — FOUND
- Commit `15b28ca` (Task 2) present in `git log --oneline` — FOUND
- TypeScript clean after both commits

## Next Phase Readiness

- Plan 10-13 (operator-run Playwright UAT against preview alias) is unblocked.
- No follow-up phase work required from this plan; selector contract is now satisfied at source.

---
*Phase: 10-access-control-extended*
*Plan: 10-11*
*Completed: 2026-05-11*
