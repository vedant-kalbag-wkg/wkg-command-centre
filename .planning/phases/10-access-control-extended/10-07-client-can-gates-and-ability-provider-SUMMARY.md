---
phase: "10"
plan: "07"
subsystem: "access-control"
tags: ["casl", "ability-provider", "can-component", "client-gates", "ssr"]
dependency_graph:
  requires:
    - "10-04 (AppAbility + Can component)"
    - "10-05 (getUserCtx + buildAbility)"
  provides:
    - "AbilityProvider wired into app layout — rules flow from SSR to all client components"
    - "Sidebar Configure group gated by CASL (not role string)"
    - "User-menu Admin section gated by CASL (not role string)"
    - "LocationProducts Recalculate button gated by CASL (not useSession role)"
  affects:
    - "src/app/(app)/layout.tsx"
    - "src/components/layout/app-sidebar.tsx"
    - "src/components/layout/user-menu.tsx"
    - "src/components/layout/app-shell-v2.tsx"
    - "src/app/(app)/locations/[id]/products/location-products-client.tsx"
tech_stack:
  added: []
  patterns:
    - "SSR-safe rules-as-prop: server builds AppAbility, passes rules JSON array to AbilityProvider"
    - "<Can I='action' a='Subject'> replaces inline role-string checks in client components"
key_files:
  created: []
  modified:
    - "src/app/(app)/layout.tsx"
    - "src/components/layout/app-sidebar.tsx"
    - "src/components/layout/user-menu.tsx"
    - "src/components/layout/app-shell-v2.tsx"
    - "src/app/(app)/locations/[id]/products/location-products-client.tsx"
decisions:
  - "Pass rules array (not ability instance) from server to AbilityProvider — ability instances are not serialisable across the RSC boundary"
  - "getUserCtx() is React-cached per request; calling it in layout.tsx adds zero extra DB round-trips"
  - "app-shell-v2.tsx needed updating even though not listed in plan files_modified — it was the intermediary passing isAdmin to AppSidebar"
metrics:
  duration: "~2 sessions (context overflow between)"
  completed_date: "2026-05-11"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 5
---

# Phase 10 Plan 07: Client Can Gates and AbilityProvider Summary

AbilityProvider wired into app layout via getUserCtx() rules-as-prop; three isAdmin/useSession role-string gates migrated to `<Can>` CASL checks across sidebar, user-menu, and location-products.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Wrap app layout with AbilityProvider via getUserCtx().ability.rules | 5a92e3a |
| 2 | Migrate sidebar + user-menu admin gates to `<Can I="manage" a="all">` | 2e543fc |
| 3 | Migrate location-products admin branch to `<Can I="manage" a="LocationProduct">` | 2bb3f08 |

## What Was Built

**Task 1 — AbilityProvider in app layout**

`src/app/(app)/layout.tsx` now calls `getUserCtx()` (React-cached, zero extra DB cost) and passes `ctx.ability.rules` as a prop to `AbilityProvider`. The ability rules flow down to every client component inside the `(app)` route group, including during SSR, eliminating hydration flicker (threat T-10-07-04).

**Task 2 — Sidebar and user-menu gates**

Both `app-sidebar.tsx` and `user-menu.tsx` previously computed `isAdmin = user.role === "admin"` from the session prop passed through `AppShellV2`. These role-string checks were replaced with `<Can I="manage" a="all">` wrappers. `app-shell-v2.tsx` (not originally listed in plan files but required for correctness) was also updated to remove the dead `isAdmin` computation and prop pass.

**Task 3 — Location-products gate**

`location-products-client.tsx` previously called `useSession()` to derive `isAdmin`, then threaded that boolean as a prop down to `ProductRow` to gate the Recalculate button. The entire chain was replaced: `useSession` import removed, `isAdmin` prop removed from `ProductRowProps` and its call site, and the Recalculate button now lives inside `<Can I="manage" a="LocationProduct">`. This mitigates T-10-07-01 (stale session role under impersonation).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] app-shell-v2.tsx required updating**

- **Found during:** Task 2
- **Issue:** `app-shell-v2.tsx` was the intermediary that computed `isAdmin = user.role === "admin"` and passed it as a prop to `AppSidebar`. The plan's `files_modified` list did not include it, but the migration could not complete without removing this prop-pass chain.
- **Fix:** Removed `const isAdmin = user.role === "admin"` from `AppShellV2` and changed `<AppSidebar isAdmin={isAdmin} />` to `<AppSidebar />`.
- **Files modified:** `src/components/layout/app-shell-v2.tsx`
- **Commit:** 2e543fc

## Known Stubs

None — all three gates fully wired to CASL ability checks.

## Threat Flags

None — no new network endpoints or auth paths introduced. Existing gates strengthened by migrating from role-string checks to CASL ability checks.

## Self-Check: PASSED

- `src/app/(app)/layout.tsx` — exists and imports AbilityProvider + getUserCtx
- `src/components/layout/app-sidebar.tsx` — exists and uses `<Can I="manage" a="all">`
- `src/components/layout/user-menu.tsx` — exists and uses `<Can I="manage" a="all">`
- `src/components/layout/app-shell-v2.tsx` — exists, isAdmin prop chain removed
- `src/app/(app)/locations/[id]/products/location-products-client.tsx` — exists and uses `<Can I="manage" a="LocationProduct">`
- Commits 5a92e3a, 2e543fc, 2bb3f08 — verified in git log
- `npx tsc --noEmit` — TypeScript: No errors found
- `npx playwright test --list tests/access-control/can-component.spec.ts` — PASS (spec parses; live run deferred to Plan 10-08 preview deploy)
