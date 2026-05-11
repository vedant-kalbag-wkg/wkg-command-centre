---
phase: 10
plan: "06"
subsystem: access-control
tags: [role-assignment, user-management, lockout-guard, scopes, server-actions]
dependency_graph:
  requires: [10-03, 10-05]
  provides: [user-role-assignment-ui, deleteUser-lockout-wrap, per-user-role-scope-edit]
  affects: [settings-users-detail, manage-scopes-dialog, user-table]
tech_stack:
  added: []
  patterns:
    - two-file-use-server-split (role-actions.ts / role-internal.ts)
    - lockout-guard-before-commit (assertAtLeastOneEffectiveAdmin inside db.transaction)
    - role-mirror-in-tx (refreshUserRoleMirror called inside same tx as user_roles write)
    - per-user-role-scope-binding (ManageScopesDialog extended with roleId prop)
key_files:
  created:
    - src/app/(app)/settings/users/[id]/role-internal.ts
    - src/app/(app)/settings/users/[id]/role-actions.ts
    - src/app/(app)/settings/users/[id]/page.tsx
    - src/app/(app)/settings/users/[id]/role-assignment-client.tsx
  modified:
    - src/app/(app)/settings/users/actions.ts
    - src/components/admin/manage-scopes-dialog.tsx
    - src/app/(app)/settings/users/[id]/scopes-actions.ts
    - src/app/(app)/settings/users/[id]/scopes-internal.ts
    - tests/db/user-scopes-actions.integration.test.ts
decisions:
  - two-file-split mandatory to prevent Turbopack from registering _*ForActor helpers as public server-action RPC endpoints
  - lockout-guard runs AFTER user_roles DELETE, BEFORE tx commit — detects unsafe state before it lands
  - deleteUser wraps lockout-guard BEFORE auth.api.removeUser (can't roll back Better Auth's own delete)
  - ManageScopesDialog Add-form hidden for legacy callers (roleId omitted) to preserve backward compat
  - addScope/scopes-internal roleId now required positional arg — integration tests updated in same commit
metrics:
  duration: "~3 hours (multi-session)"
  completed: "2026-05-11"
  tasks_completed: 4
  files_changed: 9
---

# Phase 10 Plan 06: User Role Assignment UI and removeUser Wrap Summary

JWT-authenticated IAM role assignment UI plus lockout-safe user deletion — admin can assign/revoke custom roles per user with per-(user,role) dimension scopes via ManageScopesDialog, and deleteUser is wrapped with assertAtLeastOneEffectiveAdmin to close the Q6 coverage gap.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | role-internal + role-actions two-file server-action split | `7aca73e` | role-internal.ts, role-actions.ts |
| 2 | user detail page + role-assignment-client | `f8717bd` | [id]/page.tsx, role-assignment-client.tsx |
| 3 | wrap deleteUser with lockout-guard | `9774a09` | users/actions.ts |
| 4 | extend scopes with roleId binding + edit-scopes UI | `57ce9bb` | manage-scopes-dialog.tsx, scopes-actions.ts, scopes-internal.ts, role-assignment-client.tsx, tests/db/user-scopes-actions.integration.test.ts |

## What Was Built

### Task 1 — Two-file server-action split (role-internal.ts / role-actions.ts)

`role-internal.ts` holds the three `_*ForActor` helpers plus type exports with no `"use server"` directive — the mandatory comment block explains why the split is required (Turbopack crashes on type re-exports from `"use server"` files; helpers without the directive cannot be called as network RPC endpoints).

`_assignRoleForActor` runs a `db.transaction` that:
1. Upserts the `user_roles` row (idempotent on `(userId, roleId)`)
2. Inserts any initial `user_scopes` rows
3. Calls `refreshUserRoleMirror(userId, tx)` to keep the `user.role` text mirror in lock-step
4. Writes an audit log entry (`entityType='user_role'`, `action='assign'`, `kind='user.roles.assign'`)

`_revokeRoleForActor` runs a `db.transaction` that:
1. Captures scope rows before delete
2. Deletes `user_scopes` and `user_roles` rows
3. Calls `assertAtLeastOneEffectiveAdmin(tx)` — lockout guard runs AFTER delete, BEFORE commit
4. Calls `refreshUserRoleMirror(userId, tx)`
5. Writes audit log (`kind='user.roles.revoke'`, `scopesAtRevoke` captured)

`role-actions.ts` has `"use server"` and exports `listUserRoles`, `assignRole`, `revokeRole`. `revokeRole` catches the `LOCKOUT_PREVENTION` error and returns `{ status: "lockout_prevention" }` instead of throwing.

### Task 2 — User detail page + role-assignment client

`[id]/page.tsx` is an RSC that:
- Awaits `params` (Next.js 15 dynamic params are a Promise)
- Gates on `ctx.ability.can("manage", "User") || ctx.ability.can("manage", "all")`
- Parallel-fetches assignments, all roles, and scopes via `Promise.all`
- Constructs `targetUser: UserListItem` from the DB row
- Renders `<RoleAssignmentClient>` with full prop set

`role-assignment-client.tsx` is a `"use client"` component that:
- Shows all current assignments with role display name, kind, scope count, and assigned date
- Provides a role picker (Select) filtered to unassigned roles
- Has per-assignment "Edit scopes" button (SlidersHorizontal) that opens `ManageScopesDialog` scoped to `(user, roleId)`
- Handles `{ status: "lockout_prevention" }` with the canonical recovery message: "Assign Admin (or a role that grants 'manage all') to at least one user before continuing"

### Task 3 — deleteUser lockout wrap (closes RESEARCH Q6)

`users/actions.ts deleteUser` now calls `assertAtLeastOneEffectiveAdmin(db, { excludeUserId: userId })` before `auth.api.removeUser`. If the guard throws `LOCKOUT_PREVENTION`, the function returns `{ error: "Refusing to delete..." }` without calling Better Auth's delete. This closes the gap flagged in RESEARCH §Q6: Better Auth's own `removeUser` does not check for lockout, so wrapping at the action layer is the only safe interception point.

### Task 4 — Per-(user, role) scope editing via ManageScopesDialog

`ManageScopesDialog` now accepts `roleId?: string` and `assignmentLabel?: string`. When `roleId` is provided:
- `listScopes` is called with `roleId` → only scopes bound to that (user, role) pair are shown
- The Add scope form is rendered (conditionally hidden when `roleId` absent — backward compat for legacy callers like `user-table.tsx`)
- `addScope` is called with `roleId` as the required second arg
- Dialog title shows `Manage scopes — {assignmentLabel}`

`scopes-internal.ts _addScopeForActor` now takes `roleId` as a required 4th positional param. It verifies that a `user_roles` row exists for `(userId, roleId)` before inserting — returns `"user does not have this role assigned"` if not found.

`role-assignment-client.tsx` wires this end-to-end: each assignment row's "Edit scopes" button sets `{ open: true, roleId: a.roleId, label: a.roleDisplayName }` and renders `<ManageScopesDialog>` conditionally when `scopeDialog.roleId` is set.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated integration test call sites for _addScopeForActor signature change**

- **Found during:** Task 4 verification (`tsc --noEmit`)
- **Issue:** `_addScopeForActor` gained a required `roleId` 4th positional param in Task 4. All 16 call sites in `tests/db/user-scopes-actions.integration.test.ts` still used the old 5-arg signature, producing 17 TypeScript errors (`TS2554: Expected 6 arguments, but got 5`).
- **Fix:** Added `roles` and `userRoles` schema imports; declared `let testRoleId: string`; seeded a test role + `userRoles` rows in `beforeAll`; updated all 16 `_addScopeForActor` call sites to pass `testRoleId` as the 4th arg; moved `@ts-expect-error` directive above the `'bogus'` dimensionType arg (not above `testRoleId`).
- **Files modified:** `tests/db/user-scopes-actions.integration.test.ts`
- **Commit:** `57ce9bb` (included in Task 4 commit)

### Plan Adjustments

- Plan originally specified "5 files (4 new + 1 augmented)"; the per-(user,role) scope-edit work (Task 4) added `manage-scopes-dialog.tsx`, `scopes-actions.ts`, and `scopes-internal.ts` as additional augmented files, plus the integration test fix — 9 files total across 4 tasks.
- AUTH-07 SC4 (per-user role assignment with per-(user,role) scope editing) is fully delivered in this plan. The plan's output spec explicitly notes this was originally deferred to v1.2 but moved to v1.1 in the iter-1 revision.

## AUTH-07 SC4 Delivery Status

The plan delivers AUTH-07 SC4 end-to-end:
- Admin can assign a role from the `/settings/users/[id]` page
- Per-(user, role) dimension scopes can be added/removed via ManageScopesDialog opened from the role row
- Revocation cascades scopes (explicit delete in tx + FK safety net)
- Lockout guard prevents both last-admin revoke and last-admin delete

## Known Stubs

None — all data sources are wired. `initialScopes` prop is retained in `role-assignment-client.tsx` (with `void initialScopes` suppression) for forward extension but does not affect any rendered output since the dialog re-fetches on open.

## Threat Flags

None — no new network endpoints beyond the two server actions (`assignRole`, `revokeRole`, `listUserRoles`, `addScope`, `listScopes`, `removeScope`). All are gated on `requireRole('admin')`. The user detail page is gated on `ctx.ability.can("manage", "User")`.

## Self-Check: PASSED

Files exist:
- `src/app/(app)/settings/users/[id]/role-internal.ts` — FOUND
- `src/app/(app)/settings/users/[id]/role-actions.ts` — FOUND
- `src/app/(app)/settings/users/[id]/page.tsx` — FOUND
- `src/app/(app)/settings/users/[id]/role-assignment-client.tsx` — FOUND

Commits exist:
- `7aca73e` — Task 1 — FOUND
- `f8717bd` — Task 2 — FOUND
- `9774a09` — Task 3 — FOUND
- `57ce9bb` — Task 4 — FOUND
