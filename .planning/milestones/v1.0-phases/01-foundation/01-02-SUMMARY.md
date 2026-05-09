---
phase: 01-foundation
plan: 02
subsystem: auth
tags: [better-auth, email-password, session-management, password-reset, react-hook-form, zod, playwright, route-protection]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Database schema, app shell, route groups, Playwright config"
provides:
  - Better Auth server instance with invite-only mode, admin plugin, 30-day sliding sessions
  - Better Auth client instance with type-safe signIn/signOut/useSession exports
  - Email utility for password reset and invite emails via Nodemailer
  - API auth handler at /api/auth/[...all]
  - proxy.ts route protection (Next.js 16) redirecting unauthed to /login
  - Branded login form with react-hook-form + zod validation
  - Password reset request and confirmation flow
  - Set-password page for invite acceptance and password reset
  - Session-aware sidebar footer with user avatar, name, role badge, sign out
  - 11 Playwright E2E auth tests (login, signup blocked, session persistence, password reset)
  - Admin seed script for test user creation
affects: [01-03, all-downstream-phases]

# Tech tracking
tech-stack:
  added: []
  patterns: [better-auth-invite-only, proxy-ts-route-protection, react-hook-form-zod-validation, session-aware-layout]

key-files:
  created:
    - src/lib/auth.ts
    - src/lib/auth-client.ts
    - src/lib/email.ts
    - src/app/api/auth/[...all]/route.ts
    - src/proxy.ts
    - src/db/seed.ts
    - src/components/auth/login-form.tsx
    - src/components/auth/reset-password-form.tsx
    - src/components/auth/set-password-form.tsx
    - src/app/(auth)/reset-password/page.tsx
    - src/app/(auth)/set-password/page.tsx
    - tests/auth/login.spec.ts
    - tests/auth/signup-blocked.spec.ts
    - tests/auth/session-persistence.spec.ts
    - tests/auth/password-reset.spec.ts
    - tests/auth/setup.ts
  modified:
    - src/app/(auth)/login/page.tsx
    - src/app/(app)/layout.tsx
    - src/components/layout/app-sidebar.tsx
    - src/lib/auth-client.ts
    - package.json

key-decisions:
  - "Used @better-auth/drizzle-adapter (extracted package) instead of better-auth/adapters/drizzle as the subpath doesn't exist in v1.5.5"
  - "Used (authClient as any).forgetPassword() cast because Better Auth runtime-generates password methods that aren't reflected in client types without server config inference"
  - "Used #password CSS selector in Playwright tests instead of getByLabel('Password') to avoid strict mode collision with show/hide button aria-label"
  - "Added BETTER_AUTH_URL=http://localhost:3000 to .env.local to suppress base URL warnings"

patterns-established:
  - "Auth form pattern: react-hook-form + zod with onBlur validation, inline errors with AlertCircle icon, Sonner toast for server errors"
  - "Route protection pattern: proxy.ts checks session, redirects unauthed to /login, authed on auth pages to /kiosks"
  - "Session-aware layout: server component layout checks auth.api.getSession(), passes user to client sidebar component"
  - "Seed script pattern: npx tsx --env-file=.env.local --tsconfig tsconfig.json for running with path aliases"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03]

# Metrics
duration: 11min
completed: 2026-03-18
---

# Phase 1 Plan 02: Authentication System Summary

**Better Auth 1.5 email/password auth with invite-only mode, 30-day sliding sessions, proxy.ts route protection, branded login/reset/set-password UI, session-aware sidebar, and 11 passing Playwright E2E tests**

## Performance

- **Duration:** 11 min
- **Started:** 2026-03-18T14:38:10Z
- **Completed:** 2026-03-18T14:50:08Z
- **Tasks:** 2
- **Files modified:** 22

## Accomplishments

- Complete Better Auth server/client setup with email/password, admin plugin, nextCookies, and 30-day sliding session window
- proxy.ts route protection redirecting unauthenticated users to /login and authenticated users away from auth pages
- Branded auth UI: login form with validation and eye toggle, reset password with email confirmation flow, set-password with token
- Session-aware sidebar footer showing user avatar (initials), name, role badge (Admin/Member/Viewer with distinct colors), and sign out
- 11 Playwright E2E tests all passing: login form rendering, validation errors, successful sign-in, invalid credentials toast, forgot password navigation, no signup link, signup API blocked, session persistence on reload, password reset UI flow

## Task Commits

Each task was committed atomically:

1. **Task 1: Configure Better Auth server/client, API route, proxy.ts, and email utility** - `572c89e` (feat)
2. **Task 2: Build branded auth UI forms, session-aware sidebar, and Playwright auth tests** - `653143a` (feat)

## Files Created/Modified

- `src/lib/auth.ts` - Better Auth server instance with disableSignUp, admin plugin, 30-day sessions
- `src/lib/auth-client.ts` - Better Auth client with adminClient plugin, exports signIn/signOut/useSession
- `src/lib/email.ts` - Nodemailer-based email utility for password reset and invite emails
- `src/app/api/auth/[...all]/route.ts` - Better Auth API handler (GET + POST)
- `src/proxy.ts` - Next.js 16 route protection replacing middleware.ts
- `src/db/seed.ts` - Admin user seed script for testing
- `src/components/auth/login-form.tsx` - Login form with react-hook-form + zod, eye toggle, error handling
- `src/components/auth/reset-password-form.tsx` - Reset password form with email confirmation state
- `src/components/auth/set-password-form.tsx` - Set password form with token, min 8 chars, confirm match
- `src/app/(auth)/login/page.tsx` - Updated to use LoginForm component
- `src/app/(auth)/reset-password/page.tsx` - New reset password page
- `src/app/(auth)/set-password/page.tsx` - New set password page with Suspense for useSearchParams
- `src/app/(app)/layout.tsx` - Added server-side session check, passes user to sidebar
- `src/components/layout/app-sidebar.tsx` - Added user prop, role badge, sign out button
- `tests/auth/login.spec.ts` - 6 login tests including @smoke sign-in
- `tests/auth/signup-blocked.spec.ts` - 1 test verifying POST to sign-up is rejected
- `tests/auth/session-persistence.spec.ts` - 1 @smoke test for session persistence across reload
- `tests/auth/password-reset.spec.ts` - 3 tests for reset and set-password UI
- `tests/auth/setup.ts` - Shared test utilities and admin credentials

## Decisions Made

- Used `@better-auth/drizzle-adapter` (extracted package) instead of `better-auth/adapters/drizzle` -- the subpath doesn't exist in v1.5.5, only the external package resolves
- Used `(authClient as any).forgetPassword()` type cast because Better Auth generates password reset methods at runtime from emailAndPassword config, but TypeScript types don't reflect them without direct server type inference
- Used `#password` CSS selector in Playwright tests instead of `getByLabel('Password')` to avoid strict mode violation with the show/hide button's aria-label containing "password"
- Added `BETTER_AUTH_URL=http://localhost:3000` to `.env.local` to suppress Better Auth base URL warnings during build
- Wrapped `SetPasswordForm` in `<Suspense>` because `useSearchParams()` requires a Suspense boundary in Next.js 16

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed seed script return type**
- **Found during:** Task 1 (seed script creation)
- **Issue:** `auth.api.createUser()` returns `{ user: UserWithRole }` not a flat user object; `user.email` TypeScript error
- **Fix:** Changed to `result.user.email`
- **Files modified:** src/db/seed.ts
- **Committed in:** 572c89e (Task 1 commit)

**2. [Rule 3 - Blocking] Fixed Better Auth drizzle adapter import path**
- **Found during:** Task 1 (auth server setup)
- **Issue:** `better-auth/adapters/drizzle` subpath doesn't exist in v1.5.5; only `@better-auth/drizzle-adapter` resolves
- **Fix:** Used `@better-auth/drizzle-adapter` import
- **Files modified:** src/lib/auth.ts
- **Committed in:** 572c89e (Task 1 commit)

**3. [Rule 1 - Bug] Fixed Playwright test locator collision**
- **Found during:** Task 2 (Playwright tests)
- **Issue:** `getByLabel("Password")` resolved to 2 elements (input + show/hide button with aria-label containing "password")
- **Fix:** Used `page.locator("#password")` CSS selector for the password input
- **Files modified:** tests/auth/login.spec.ts, tests/auth/session-persistence.spec.ts
- **Committed in:** 653143a (Task 2 commit)

**4. [Rule 1 - Bug] Fixed strict mode violation in password-reset test**
- **Found during:** Task 2 (Playwright tests)
- **Issue:** `getByText("Reset your password")` matched both heading and body text containing the phrase
- **Fix:** Used `getByRole("heading", { name: "Reset your password" })` for specificity
- **Files modified:** tests/auth/password-reset.spec.ts
- **Committed in:** 653143a (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (3 bugs, 1 blocking)
**Impact on plan:** All fixes necessary for correctness. No scope creep.

## Issues Encountered

- shadcn form component (`npx shadcn@latest add form`) installed silently without creating the file. Proceeded without it by using react-hook-form + zod directly with Input/Label/Button components.
- Better Auth forgetPassword type not exported in client types. Runtime method exists but TypeScript requires `as any` cast. This is a known Better Auth limitation when the client can't infer server config.
- Seed script needed `--env-file=.env.local --tsconfig tsconfig.json` flags to resolve both environment variables and `@/` path aliases.

## User Setup Required

None beyond what was configured in Plan 01-01. Database is connected, BETTER_AUTH_URL added.

## Next Phase Readiness

- Auth system complete: login, session persistence, password reset flow all working
- Route protection via proxy.ts protecting all app routes
- Admin seed user available for testing (admin@weknow.co / Admin123!)
- Ready for Plan 01-03 (RBAC and user management in Settings > Users)
- Playwright auth test suite can be extended for admin/RBAC tests

---
*Phase: 01-foundation*
*Completed: 2026-03-18*
