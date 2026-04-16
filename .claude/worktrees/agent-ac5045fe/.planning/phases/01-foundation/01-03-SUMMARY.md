---
phase: 01-foundation
plan: 03
subsystem: auth
tags: [rbac, admin-plugin, user-management, invite-flow, role-badges, playwright, deactivate-user]

# Dependency graph
requires:
  - phase: 01-02
    provides: "Better Auth server/client, admin plugin, email utility, session-aware layout, seed user"
provides:
  - RBAC helpers (requireRole, isAdmin, canAccessSensitiveFields, redactSensitiveFields)
  - Admin user management page (Settings > Users) with invite, role change, deactivate flows
  - Server actions for user management (inviteUser, listUsers, changeUserRole, deactivateUser)
  - Invite user dialog with react-hook-form + zod validation
  - Change role and deactivate user confirmation dialogs matching UI-SPEC copywriting
  - Non-admin disabled controls with permission tooltips (LOCKED DECISION)
  - 11 Playwright E2E tests for admin and RBAC flows
  - AppShell action slot for page-level CTAs
affects: [02-kiosk-crud, all-downstream-phases]

# Tech tracking
tech-stack:
  added: [shadcn-select]
  patterns: [server-actions-with-rbac, role-badge-styling, disabled-with-tooltip, invite-via-password-reset]

key-files:
  created:
    - src/lib/rbac.ts
    - src/app/(app)/settings/users/actions.ts
    - src/app/(app)/settings/users/users-page-client.tsx
    - src/components/admin/invite-user-dialog.tsx
    - src/components/admin/user-table.tsx
    - src/components/admin/change-role-dialog.tsx
    - src/components/admin/deactivate-dialog.tsx
    - src/components/ui/select.tsx
    - tests/admin/invite-user.spec.ts
    - tests/admin/change-role.spec.ts
    - tests/admin/deactivate-user.spec.ts
    - tests/rbac/sensitive-fields.spec.ts
    - tests/rbac/viewer-controls.spec.ts
  modified:
    - src/app/(app)/settings/users/page.tsx
    - src/components/layout/app-shell.tsx
    - tests/auth/setup.ts

key-decisions:
  - "Better Auth createUser only accepts 'user'|'admin' role — create as 'user' then setRole to member/viewer"
  - "Better Auth setRole typed as 'user'|'admin' but runtime accepts any string — cast to bypass TypeScript"
  - "Server API uses requestPasswordReset (not forgetPassword) for invite email flow"
  - "Added try-catch around page.tsx getSession for Neon cold start resilience"
  - "AppShell extended with optional action prop for page-level CTA buttons"

patterns-established:
  - "Server action RBAC pattern: requireRole('admin') guard at top of every server action"
  - "Role badge pattern: Admin #121212, Member #F4F4F4, Viewer #E5F1F9 — 6px radius, 6px/12px padding"
  - "Disabled control pattern: show button disabled with Tooltip explaining permission restriction"
  - "Invite flow pattern: createUser + setRole + requestPasswordReset (password reset = invite email)"
  - "Deactivate-only pattern: banUser with reason, no permanent deletion, 0.5 opacity row"

requirements-completed: [AUTH-04, AUTH-05]

# Metrics
duration: 25min
completed: 2026-03-18
---

# Phase 1 Plan 03: Admin User Management & RBAC Summary

**Admin user management UI with invite/role-change/deactivate flows, RBAC helpers for sensitive field redaction, and 11 Playwright E2E tests covering AUTH-04 and AUTH-05**

## Performance

- **Duration:** 25 min
- **Started:** 2026-03-18T14:54:33Z
- **Completed:** 2026-03-18T15:19:33Z
- **Tasks:** 2
- **Files modified:** 17

## Accomplishments

- Full Settings > Users page with admin user management: invite users by email+role, change roles with confirmation, deactivate (ban-only) with audit trail preservation
- RBAC helper library exporting requireRole, isAdmin, canAccessSensitiveFields, redactSensitiveFields for downstream phase use
- Non-admin users see disabled controls with "You don't have permission" tooltips (not hidden, not click-to-error)
- 11 Playwright E2E tests for admin flows (invite, role change, deactivate) and RBAC restrictions (API protection, viewer controls)
- All UI copy matches the UI-SPEC Copywriting Contract exactly

## Task Commits

Each task was committed atomically:

1. **Task 1: Build Settings > Users page with server actions and RBAC helpers** - `02df6ea` (feat)
2. **Task 2: Write Playwright E2E tests for admin and RBAC** - `b1cc320` (test)

## Files Created/Modified

- `src/lib/rbac.ts` - Role-based access control helpers: requireRole, isAdmin, canAccessSensitiveFields, redactSensitiveFields
- `src/app/(app)/settings/users/actions.ts` - Server actions: inviteUser, listUsers, changeUserRole, deactivateUser
- `src/app/(app)/settings/users/users-page-client.tsx` - Client wrapper with invite button, user table, refresh logic
- `src/app/(app)/settings/users/page.tsx` - Server component fetching users, checking admin role
- `src/components/admin/invite-user-dialog.tsx` - Invite dialog with email+role form, zod validation, Sonner toasts
- `src/components/admin/user-table.tsx` - User list table with role badges, status, actions dropdown
- `src/components/admin/change-role-dialog.tsx` - Role change confirmation dialog per copywriting contract
- `src/components/admin/deactivate-dialog.tsx` - Deactivate confirmation with destructive red CTA
- `src/components/layout/app-shell.tsx` - Extended with optional action prop for header CTAs
- `src/components/ui/select.tsx` - shadcn Select component (installed)
- `tests/admin/invite-user.spec.ts` - 3 tests: open dialog, invite member, validation error
- `tests/admin/change-role.spec.ts` - 1 test: change role with confirmation dialog
- `tests/admin/deactivate-user.spec.ts` - 1 test: deactivate with confirmation, toast, inactive badge
- `tests/rbac/sensitive-fields.spec.ts` - 3 tests: admin controls, API protection, role distinction
- `tests/rbac/viewer-controls.spec.ts` - 3 tests: redirect unauthenticated, disabled button docs, disabled dropdown docs
- `tests/auth/setup.ts` - Fixed signInAsAdmin to use #password selector (strict mode)

## Decisions Made

- Better Auth's `createUser` API only accepts `"user" | "admin"` as role values at creation time. Workaround: create user as "user" then immediately call `setRole` to assign "member" or "viewer"
- Better Auth's `setRole` TypeScript types only allow `"user" | "admin"` but the runtime stores any string. Used `as "user" | "admin"` cast to bypass TypeScript while runtime correctly stores member/viewer
- Server-side API method is `requestPasswordReset` (not `forgetPassword` which is the client-side name). Used `auth.api.requestPasswordReset()` in server actions
- Added `try-catch` around `auth.api.getSession()` in page.tsx to handle Neon serverless cold start connection failures gracefully
- Extended `AppShell` component with optional `action` prop for page-level CTA buttons in the header

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Better Auth createUser role type constraint**
- **Found during:** Task 1 (server actions)
- **Issue:** `auth.api.createUser()` only accepts `"user" | "admin"` for role, not `"member" | "viewer"`
- **Fix:** Create as "user", then call `setRole()` immediately after to set the actual role
- **Files modified:** src/app/(app)/settings/users/actions.ts
- **Committed in:** 02df6ea (Task 1 commit)

**2. [Rule 1 - Bug] Fixed Better Auth setRole type constraint**
- **Found during:** Task 1 (server actions)
- **Issue:** `auth.api.setRole()` TypeScript types only accept `"user" | "admin"`, but runtime stores any string
- **Fix:** Cast `validatedRole as "user" | "admin"` to bypass TypeScript strict typing
- **Files modified:** src/app/(app)/settings/users/actions.ts
- **Committed in:** 02df6ea (Task 1 commit)

**3. [Rule 1 - Bug] Fixed server API method name for password reset**
- **Found during:** Task 1 (server actions)
- **Issue:** Used `auth.api.forgetPassword()` which doesn't exist on server API; only `requestPasswordReset` exists
- **Fix:** Changed to `auth.api.requestPasswordReset()`
- **Files modified:** src/app/(app)/settings/users/actions.ts
- **Committed in:** 02df6ea (Task 1 commit)

**4. [Rule 1 - Bug] Fixed Select onValueChange null handling**
- **Found during:** Task 1 (dialog components)
- **Issue:** base-ui Select's `onValueChange` passes `string | null`, but handlers expected `string`
- **Fix:** Added null check: `(val) => val && setSelectedRole(val)`
- **Files modified:** src/components/admin/change-role-dialog.tsx, src/components/admin/invite-user-dialog.tsx
- **Committed in:** 02df6ea (Task 1 commit)

**5. [Rule 1 - Bug] Fixed Playwright setup.ts password selector collision**
- **Found during:** Task 2 (Playwright tests)
- **Issue:** `getByLabel("Password")` in setup.ts matched both input and show/hide button (same as Plan 01-02 bug)
- **Fix:** Changed to `page.locator("#password")`
- **Files modified:** tests/auth/setup.ts
- **Committed in:** b1cc320 (Task 2 commit)

**6. [Rule 3 - Blocking] Installed shadcn Select component**
- **Found during:** Task 1 (dialog components)
- **Issue:** Select component needed for role selection dropdown but not yet installed
- **Fix:** Ran `npx shadcn@latest add select`
- **Files modified:** src/components/ui/select.tsx, package.json
- **Committed in:** 02df6ea (Task 1 commit)

---

**Total deviations:** 6 auto-fixed (5 bugs, 1 blocking)
**Impact on plan:** All fixes necessary for correctness. No scope creep.

## Issues Encountered

- Better Auth admin plugin's TypeScript types are narrower than runtime capabilities — `createUser` and `setRole` accept any string at runtime but types restrict to `"user" | "admin"`. Required type casting for member/viewer roles.
- Neon serverless PostgreSQL cold start causes first DB query to fail intermittently. Added try-catch in page.tsx and retry logic in Playwright beforeEach to handle this. Pre-existing issue from Plan 01-02 (also affects smoke test).
- SMTP server not running locally (port 1025) causes Better Auth background task errors when sending invite emails. These are non-blocking console errors — invite creation succeeds, email delivery fails silently.

## User Setup Required

None beyond what was configured in Plans 01-01 and 01-02.

## Next Phase Readiness

- Phase 1 Foundation complete: auth, RBAC, user management all working
- RBAC helpers ready for Phase 2 sensitive field redaction (bankingDetails, contractValue, etc.)
- Admin seed user + test users available for downstream testing
- Invite flow working: createUser + setRole + requestPasswordReset
- Full Playwright suite: 24 tests (23 passing, 1 pre-existing Neon cold start flake)
- Ready for Phase 2: Kiosk CRUD, location management, pipeline stages

---
*Phase: 01-foundation*
*Completed: 2026-03-18*
