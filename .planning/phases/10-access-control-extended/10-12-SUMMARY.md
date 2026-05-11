---
phase: 10-access-control-extended
plan: 12
subsystem: ui
tags: [casl, can-gate, locations, gap-closure, playwright-uat]

requires:
  - phase: 10-access-control-extended
    provides: "AbilityProvider wired into src/app/(app)/layout.tsx (Plan 10-07); <Can> exported from src/lib/casl/ability-context.tsx (Plan 10-04); seed migration 0051 grants ('merge','Location',NULL) to ops-it (Plan 10-08)"
provides:
  - "Merge button visible on /locations/[id] for admin (system short-circuit) and ops-it (seed grant); hidden for viewer (no rule)"
  - "Wrapper <Can I=\"merge\" a=\"Location\"> on the detail page — satisfies the locked selector in tests/access-control/can-component.spec.ts lines 60-76"
  - "Closes 10-UAT-AUTONOMOUS.md Step 7 (admin sees Merge button on /locations/[id])"
affects: [10-13-preview-uat, future-merge-detail-flow-v2]

tech-stack:
  added: []
  patterns:
    - "<Can> client-component gating rendered inside RSC pages — Server Components can render Client Components (the <Can> wrapper is the Client island)"
    - "Button + Link via Base UI render prop — same shape as src/app/(app)/settings/roles/role-list-client.tsx:225"

key-files:
  created: []
  modified:
    - "src/app/(app)/locations/[id]/page.tsx — imports Link, Button, Can; adds <Can I=\"merge\" a=\"Location\"> wrapper around a Merge button after the LocationDetailForm and before LocationAdminPanel"

key-decisions:
  - "Inline placement in page.tsx (option A from plan interfaces) — minimum-change; no new Client island file needed because <Can> itself is a Client Component"
  - "Button target href is /locations?merge={id} — soft-link to the existing bulk-merge surface; spec only verifies visibility, not click-through"
  - "variant=\"outline\" (not destructive) — merge is reversible via the existing undo-merge path"
  - "Did NOT migrate {ctx.role === \"admin\"} gate on LocationAdminPanel to <Can> — separate scope item; this plan stays minimal"

patterns-established:
  - "Pattern: <Can I=\"<action>\" a=\"<Subject>\"> wrapping a Link+Button is the canonical way to add a permission-gated CTA on an RSC detail page; the rule lives in the role_permissions seed, the wrapper lives in the page"

requirements-completed: [AUTH-06, AUTH-07]

duration: 4min
completed: 2026-05-11
---

# Phase 10 Plan 12: <Can> Gate for Merge Button on Location Detail Page

**Adds a `<Can I="merge" a="Location">`-wrapped Merge button on /locations/[id] so admin and ops-it see it (and viewer does not) — closes the locked Playwright selector for `tests/access-control/can-component.spec.ts` line 60-76.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-11T11:14:00Z
- **Completed:** 2026-05-11T11:19:12Z
- **Tasks:** 2 (1 with file modification, 1 verification-only)
- **Files modified:** 1

## Accomplishments

- Added a CASL-gated Merge button on the location detail page using the existing `<Can>` component (no new infrastructure needed)
- Confirmed the integration chain spec → `<Can>` wrapper → `AbilityProvider` → `buildAbility` → `role_permissions` is intact end-to-end
- Preserved the existing bulk-merge surface on `src/components/locations/location-table.tsx` (0 diff)
- Preserved CASL types, migrations, and the `LocationAdminPanel` alert-silencing gate (0 diff)
- TypeScript compiles clean (`npx tsc --noEmit -p tsconfig.json` reported `No errors found`)

## Task Commits

1. **Task 1: Add a Merge button wrapped in `<Can I="merge" a="Location">` on the /locations/[id] page** — `0c4e8c7` (feat)
2. **Task 2: Sanity-verify CASL wiring covers the Can gate end-to-end** — _no commit (verification-only, no file changes per plan)_

## Files Created/Modified

- `src/app/(app)/locations/[id]/page.tsx` — Added 3 imports (`Link`, `Button`, `Can`) and a `<Can>`-wrapped Merge button block (lines 44-53). +13 lines, 0 deletions. Below is the exact JSX added (lines 44-53 of the post-edit file):

  ```tsx
  <Can I="merge" a="Location">
    <div className="flex items-center justify-end">
      <Button
        variant="outline"
        render={<Link href={`/locations?merge=${location.id}`} />}
      >
        Merge
      </Button>
    </div>
  </Can>
  ```

  Placement: after `<LocationDetailForm .../>`, before the `{ctx.role === "admin" && <LocationAdminPanel .../>}` block, inside `<div className="mx-auto max-w-3xl space-y-6">`.

  Imports added (top of file):

  ```tsx
  import Link from "next/link";
  import { Button } from "@/components/ui/button";
  import { Can } from "@/lib/casl/ability-context";
  ```

## Decisions Made

- **Inline placement vs new client island** — chose inline in the RSC. `<Can>` is already a Client Component (`"use client"` in ability-context.tsx); React supports an RSC rendering a Client Component child. No new file required.
- **Render-prop pattern (`render={<Link/>}`) over `asChild`** — matches the only existing Button+Link precedent in the codebase at `src/app/(app)/settings/roles/role-list-client.tsx:225`. The project's `Button` is `@base-ui/react/button` Primitive which natively supports `render`; `asChild` is not in the type surface.
- **Did not migrate `LocationAdminPanel`'s role gate** — the existing `ctx.role === "admin"` check on the alert-silencing panel is unchanged. Migrating remaining role-text checks to `<Can>` is a separate consolidation item, called out in the plan.
- **Button target is `/locations?merge=${id}`** — a soft hint to the existing bulk-merge surface. The list page does not yet consume the `merge` query param; the spec only verifies visibility, not navigation outcome. If a future plan wires the list page to pre-select the row on `?merge=`, the link still resolves; no breakage.

## Deviations from Plan

None — plan executed exactly as written.

The single acceptance-criterion grep `grep -E '>Merge<|"Merge"' page.tsx` did not match because the JSX is multi-line (`>` on line 49, `Merge` on line 50, `</Button>` on line 51 — `prettier` formatting). The substantive requirement — the button's visible text is "Merge" so Playwright's `getByRole('button', { name: /merge/i })` resolves — IS satisfied. Verified with an awk multi-line check:

```bash
awk '/<Button/,/<\/Button>/' 'src/app/(app)/locations/[id]/page.tsx' | grep -q '^\s*Merge\s*$'
# exit 0
```

This is not a deviation — it is a brittleness in the grep regex shape, not in the code. Plan 10-13 (preview UAT) will validate via real Playwright run.

## Verification Results (Task 1 acceptance)

| Check | Status | Detail |
|-------|--------|--------|
| `grep -q '<Can I="merge" a="Location"' page.tsx` | PASS | line 44 |
| `grep -q 'from "@/lib/casl/ability-context"' page.tsx` | PASS | line 8 |
| Button visible text contains "Merge" | PASS | awk multi-line check on `<Button>...Merge...</Button>` |
| `grep -q "'merge'.*'Location'" migrations/0051_phase_10_seed_and_backfill.sql` | PASS | line 51 (ops-it INSERT block, lines 36-57) |
| `grep -rE '<Can I="merge"' 'src/app/(app)/locations/[id]/'` | PASS | 1 hit (the new wrapper) |
| `npx tsc --noEmit -p tsconfig.json` | PASS | No errors found |
| `git diff src/components/locations/location-table.tsx` empty | PASS | bulk surface untouched |
| `git diff src/lib/casl/types.ts` empty | PASS | no Action/Subject widening |
| `git diff migrations/` empty | PASS | no new/edited migrations |
| `git diff src/app/(app)/locations/[id]/location-admin-panel.tsx` empty | PASS | alert-silencing panel untouched |

## Verification Results (Task 2 integration chain)

| Check | Status | Evidence |
|-------|--------|----------|
| AbilityProvider in `src/app/(app)/layout.tsx` | PASS | lines 5, 22, 32 |
| `Can` exported from `src/lib/casl/ability-context.tsx` | PASS | line 11: `export const Can = createContextualCan(AbilityContext.Consumer);` |
| `buildAbility` in `src/lib/casl/ability.ts` | PASS | line 8 |
| `rolePermissions` joined in `src/lib/casl/ability.ts` | PASS | lines 11, 44, 45 |
| `<Can I=` usages in `src/app/(app)/` | 2 (was 1, +1 from this plan) | `location-products-client.tsx:410` + new `page.tsx:44`. Plan expected ≥4 conflating `src/app/(app)/` with `src/components/` (sidebar, user-menu live under `src/components/`). The substantive requirement — the new locations/[id] usage is counted — is satisfied. |
| `'merge', 'Location'` appears ONLY in ops-it INSERT block | PASS | awk block-counted: appears in BLOCK#2 (ops-it permissions, lines 36-57); does NOT appear in BLOCK#3 (read-only permissions, lines 66-80). Read-only INSERT block contains only `('read', 'Location', NULL)` and a field-restricted `('read', 'Location', '["bankingDetails","contractValue","contractTerms"]')` deny rule. |

Conclusion: chain is intact. Admin and ops-it will see the button; viewer/read-only will not. Spec at `tests/access-control/can-component.spec.ts` lines 60-76 will resolve against the next preview deploy.

## Issues Encountered

None.

## Reminder

**Full preview verification happens in Plan 10-13.** This plan only proves the code-level wiring; the locked Playwright spec must still be run against the Vercel preview alias with `BETTER_AUTH_URL` set per CLAUDE.md ("Playwright specs against preview deploys (not just `--list`)").

## Self-Check: PASSED

- File `src/app/(app)/locations/[id]/page.tsx` exists and contains the new wrapper — verified inline by Read tool.
- Commit `0c4e8c7` exists on branch `worktree-agent-a2af4ccace67ba04f` — verified by `git rev-parse --short HEAD` post-commit.
- No deletions: `git diff --diff-filter=D --name-only HEAD~1 HEAD` returned empty.

---
*Phase: 10-access-control-extended*
*Completed: 2026-05-11*
