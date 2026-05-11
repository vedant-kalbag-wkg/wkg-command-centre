---
phase: 10
plan: 05
subsystem: roles-admin-ui
tags: [rbac, roles, admin-ui, casl, lockout-guard, audit-log]
requirements: [AUTH-06, AUTH-07]

dependency_graph:
  requires:
    - 10-03  # casl-core-ability-builder (buildAbility, getUserCtx, lockout-guard)
  provides:
    - roles CRUD UI at /settings/roles and /settings/roles/[id]
    - server-action surface for list/get/create/replace/delete/clone
    - diff-preview modal with impacted-user count + lockout prevention
  affects:
    - src/app/(app)/settings/page.tsx  # gains Roles tile

tech_stack:
  added:
    - react-hook-form + useFieldArray for rule-row repeater
  patterns:
    - two-file "use server" split (actions.ts + editor-internal.ts)
    - _*ForActor helpers with db: AnyDb first arg
    - result envelope { success } | { error } | { status: "lockout_prevention" }
    - flatMap expansion: N-action form row → N RawRule entries

key_files:
  created:
    - src/app/(app)/settings/roles/actions.ts
    - src/app/(app)/settings/roles/editor-internal.ts
    - src/app/(app)/settings/roles/page.tsx
    - src/app/(app)/settings/roles/role-list-client.tsx
    - src/app/(app)/settings/roles/[id]/page.tsx
    - src/app/(app)/settings/roles/[id]/role-editor-client.tsx
    - src/app/(app)/settings/roles/[id]/diff-preview-modal.tsx
  modified:
    - src/app/(app)/settings/page.tsx

decisions:
  - "new/page.tsx consolidated into dialog inside role-list-client.tsx — matched users-page-client.tsx donor pattern; avoids a separate RSC route for a simple create flow"
  - "Conditions builder ships as structured key+op+value rows with a 'Switch to JSON' escape hatch per rule — no raw JSON as primary surface (per CONTEXT §4.Q4.1)"
  - "assignedUserCount loaded at page-load time from RoleDetail; passed as prop to DiffPreviewModal — avoids extra RPC before modal opens"
  - "rowToRawRules uses flatMap: one form row with N actions expands into N separate RawRule entries at save boundary; DB schema stores one action per row"
  - "lockout guard runs assertAtLeastOneEffectiveAdmin(tx) INSIDE the db.transaction after DELETE+INSERT and BEFORE writeAuditLog; both replaceRolePermissions and deleteRole paths guarded"
  - "refreshUserRoleMirror called inside tx only on deleteRole path; replaceRolePermissions does not call it because rule replacement does not change user_roles assignments"

metrics:
  duration: ~3h (across 2 sessions)
  completed: 2026-05-10
  tasks_completed: 3
  files_modified: 8
---

# Phase 10 Plan 05: Settings Roles Admin UI Summary

Admin CRUD UI for the roles system: browse all roles, drill into a role to edit its rule set, preview a diff with impacted-user count before saving, and have changes take effect on the next request — all without a deploy.

## What Was Built

Eight files shipped across three tasks (plan originally listed nine; `new/page.tsx` was consolidated into a dialog inside `role-list-client.tsx`):

| File | Purpose |
|------|---------|
| `actions.ts` | `"use server"` wrappers: listRoles, getRole, createRole, replaceRolePermissions, deleteRole, cloneRole |
| `editor-internal.ts` | NO directive; `_*ForActor` helpers + AnyDb/Actor/RoleListItem/RoleDetail types |
| `roles/page.tsx` | RSC list view — role table, gated on `ability.can("manage", "Role")` |
| `roles/role-list-client.tsx` | `"use client"` island — table renderer, Create dialog, Clone dialog, Delete with tooltip |
| `roles/[id]/page.tsx` | RSC detail view — loads role, CASL gate → redirect, passes to editor |
| `roles/[id]/role-editor-client.tsx` | `"use client"` form — react-hook-form + useFieldArray, subject/action/field/condition per row |
| `roles/[id]/diff-preview-modal.tsx` | `"use client"` diff preview — added/removed/changed sections, impacted-user count, lockout prevention |
| `settings/page.tsx` | Settings hub gains a Roles tile (gated) |

## Architecture Decisions

**new/page.tsx not created.** The Create-role flow was consolidated as a dialog inside `role-list-client.tsx`, matching the `users-page-client.tsx` donor pattern. A separate RSC route would have added a page that renders only a form modal; the inline dialog approach avoids the round-trip and the file.

**Conditions builder shape.** Structured key+op+value rows ship as the primary surface, with a "Switch to JSON" escape hatch per rule. This satisfies CONTEXT §4.Q4.1 ("no raw JSON editor as primary surface") while keeping an escape hatch for complex CASL condition objects.

**Multi-action expansion at save boundary.** The form stores `actions: string[]` per row (chip multi-select UX). At the point where `RawRule[]` is produced for saving, `rowToRawRules` (plural, via `flatMap`) expands each row with N actions into N separate `RawRule` entries, matching the DB schema's one-action-per-row constraint.

**impactedUserCount from page-load data.** `role.assignedUserCount` is loaded at page-load time from `RoleDetail` and passed as a prop to `DiffPreviewModal`. This avoids an extra server round-trip before the modal opens. The count is a pre-save estimate (users assigned to the role), not a post-save computed diff.

## Audit Log Entry Shapes

Three event types land for every role mutation, matching RESEARCH §Q5 verbatim:

```ts
// role.create
{ action: "role.create", roleId, roleName, actorId }

// role.permissions.replace
{ action: "role.permissions.replace", roleId, roleName, ruleCount, impactedUserCount, actorId }

// role.delete
{ action: "role.delete", roleId, roleName, actorId }
```

## Lockout Guard Behaviour

`assertAtLeastOneEffectiveAdmin(tx)` runs inside the `db.transaction` after the DELETE+INSERT of rules (or the role deletion) and BEFORE `writeAuditLog`. If the guard throws `LOCKOUT_PREVENTION`, the tx rolls back and the server action returns `{ status: "lockout_prevention" }`. The modal surface handles this with a targeted toast: "This change would leave the system with no effective admin. Assign Admin (or a role that grants 'manage all') to at least one user before continuing."

## System Role Immutability

Roles with `kind === "system"` (i.e. Admin) are uneditable end-to-end:
- UI: banner shown, all form controls disabled, Save disabled
- Server action: `assertNotSystem` throws `"System roles are immutable."` before any DB write, returning `{ error: "System roles are immutable." }`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TS2339: `impactedUserCount` access outside `success` branch**
- **Found during:** Task 3 (diff-preview-modal.tsx)
- **Issue:** After the early-return guard for `"error" in result`, TypeScript still typed `result` as `{ success: true; impactedUserCount: number } | { status: "lockout_prevention" }`. Accessing `result.impactedUserCount` directly caused TS2339 because the lockout branch has no such property.
- **Fix:** Added explicit `if ("success" in result)` guard wrapping the success toast call.
- **Files modified:** `src/app/(app)/settings/roles/[id]/diff-preview-modal.tsx`
- **Commit:** f6061ef

**2. [Rule 1 - Bug] TS2322: `string | string[]` not assignable to `Action | string`**
- **Found during:** Task 3 (role-editor-client.tsx)
- **Issue:** The original `rowToRawRule` (singular) tried to produce a single `RawRule` with `action: row.actions.length === 1 ? row.actions[0] : row.actions`. With multiple actions selected, `row.actions` is `string[]`, not assignable to `Action | string`.
- **Fix:** Renamed to `rowToRawRules` (plural) returning `RawRule[]`, using `flatMap` at the call site to expand one form row with N actions into N rules. This also correctly aligns with the DB schema (one action per row).
- **Files modified:** `src/app/(app)/settings/roles/[id]/role-editor-client.tsx`
- **Commit:** f6061ef

**3. [Scope consolidation] new/page.tsx not created**
- **Found during:** Task 2 planning
- **Decision:** Create-role flow consolidated into an inline dialog inside `role-list-client.tsx`. Matched the `users-page-client.tsx` donor pattern; the separate route would have added a page that renders only a modal form. File count: 8 (not 9).
- **Impact:** No functionality removed; Create dialog fully functional.

## Known Stubs

None. All form fields wire to live server actions. The conditions builder is functional (structured rows + JSON escape hatch). The diff modal calls `replaceRolePermissions` and shows live results.

## Playwright Status

Plan 10-01 RED specs (`tests/roles/`) are structurally present and `--list` clean. Full GREEN run against a preview deploy is gated on Plan 10-08 (close-out + E2E verification).

## Self-Check: PASSED

- `f6061ef` — feat(10-05): add role detail editor + diff-preview modal — FOUND
- `ddef878` — feat(10-05): add role list page + client island + settings hub tile — FOUND
- `2c7be96` — feat(10-05): add server-action surface (actions.ts + editor-internal.ts) — FOUND
- `src/app/(app)/settings/roles/actions.ts` — FOUND
- `src/app/(app)/settings/roles/editor-internal.ts` — FOUND
- `src/app/(app)/settings/roles/page.tsx` — FOUND
- `src/app/(app)/settings/roles/role-list-client.tsx` — FOUND
- `src/app/(app)/settings/roles/[id]/page.tsx` — FOUND
- `src/app/(app)/settings/roles/[id]/role-editor-client.tsx` — FOUND
- `src/app/(app)/settings/roles/[id]/diff-preview-modal.tsx` — FOUND
- `src/app/(app)/settings/page.tsx` — FOUND (modified)
