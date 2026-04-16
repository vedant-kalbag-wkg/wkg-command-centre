---
phase: 01-foundation
plan: 01
subsystem: ui, database, infra
tags: [nextjs, tailwind-v4, shadcn-ui, drizzle-orm, neon-postgresql, playwright, weknow-brand]

# Dependency graph
requires: []
provides:
  - Next.js 16 project scaffold with Turbopack
  - Full database schema (10 tables) via Drizzle ORM
  - WeKnow brand design tokens in Tailwind v4 @theme inline
  - 15 shadcn/ui components installed
  - Collapsible sidebar app shell with 3 nav items
  - Route group structure ((app) and (auth))
  - Branded login page placeholder
  - Playwright test infrastructure with smoke tests
affects: [01-02, 01-03, all-downstream-phases]

# Tech tracking
tech-stack:
  added: [next@16, react@19, drizzle-orm, @neondatabase/serverless, drizzle-kit, better-auth, @better-auth/drizzle-adapter, tailwindcss@4, shadcn/ui, sonner, zod, react-hook-form, @hookform/resolvers, nodemailer, @playwright/test, lucide-react]
  patterns: [css-first-tailwind-v4, shadcn-sidebar-collapsible-icon, route-groups, neon-http-driver]

key-files:
  created:
    - src/db/schema.ts
    - src/db/index.ts
    - drizzle.config.ts
    - src/app/globals.css
    - src/components/layout/app-sidebar.tsx
    - src/components/layout/app-shell.tsx
    - src/app/(app)/layout.tsx
    - src/app/(app)/kiosks/page.tsx
    - src/app/(app)/locations/page.tsx
    - src/app/(app)/settings/page.tsx
    - src/app/(app)/settings/users/page.tsx
    - src/app/(auth)/layout.tsx
    - src/app/(auth)/login/page.tsx
    - playwright.config.ts
    - tests/smoke.spec.ts
  modified:
    - package.json
    - src/app/layout.tsx
    - src/app/page.tsx

key-decisions:
  - "Wrapped sidebar nav in semantic <nav> element for Playwright accessibility queries"
  - "Used rgba() values directly for Azure tints instead of oklch to avoid Tailwind v4 conversion issues"
  - "Scoped sidebar CSS variables to :root for brand consistency without dark mode"

patterns-established:
  - "AppShell pattern: title prop + children for consistent page layout with content header"
  - "Sidebar nav with isActive based on usePathname() for active route detection"
  - "Route groups: (app) for authenticated pages with sidebar, (auth) for standalone pages"
  - "Tailwind v4 @theme inline for all design tokens, no tailwind.config.js"

requirements-completed: [AUTH-01, AUTH-02]

# Metrics
duration: 10min
completed: 2026-03-18
---

# Phase 1 Plan 01: Project Scaffold Summary

**Next.js 16 scaffold with Drizzle ORM full schema (10 tables), WeKnow-branded Tailwind v4 tokens, shadcn/ui sidebar shell, route groups, and Playwright smoke tests**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-18T14:09:13Z
- **Completed:** 2026-03-18T14:19:30Z
- **Tasks:** 2
- **Files modified:** 34

## Accomplishments

- Full database schema with 10 tables: Better Auth tables (user, session, account, verification) and application tables (kiosks, locations, kiosk_assignments, pipeline_stages, audit_logs, user_views) with FLOAT8 positions and denormalized audit names
- WeKnow brand design tokens in Tailwind v4 CSS-first config with Azure/Graphite/all secondary colours and tints, no hsl() wrappers
- Collapsible sidebar app shell (icon mode) with Kiosks, Locations, Settings nav items, Graphite background, Azure active state
- Branded login page with "Sign in to WeKnow", password show/hide, forgot password link, no signup (invite-only)
- Playwright test infrastructure with 2 passing smoke tests (homepage redirect + sidebar nav)

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold Next.js 16 with dependencies, schema, and tokens** - `55a3c86` (feat)
2. **Task 2: App shell, route groups, placeholder pages, Playwright** - `ae8a3ca` (feat)

## Files Created/Modified

- `src/db/schema.ts` - Full database schema with 10 tables (Better Auth + application)
- `src/db/index.ts` - Drizzle instance with Neon HTTP driver
- `drizzle.config.ts` - Drizzle Kit config pointing to schema and Neon
- `src/app/globals.css` - WeKnow brand tokens in @theme inline, sidebar CSS variables
- `src/app/layout.tsx` - Root layout with Sonner Toaster and TooltipProvider
- `src/app/page.tsx` - Redirect to /kiosks
- `src/components/layout/app-sidebar.tsx` - Collapsible sidebar with 3 nav items
- `src/components/layout/app-shell.tsx` - Page wrapper with content header
- `src/app/(app)/layout.tsx` - SidebarProvider + AppSidebar wrapper
- `src/app/(app)/kiosks/page.tsx` - Kiosks placeholder page
- `src/app/(app)/locations/page.tsx` - Locations placeholder page
- `src/app/(app)/settings/page.tsx` - Redirect to /settings/users
- `src/app/(app)/settings/users/page.tsx` - Users placeholder page
- `src/app/(auth)/layout.tsx` - Centered auth layout
- `src/app/(auth)/login/page.tsx` - Branded login form
- `playwright.config.ts` - Playwright config with webServer
- `tests/smoke.spec.ts` - 2 smoke tests for redirect and sidebar nav

## Decisions Made

- Wrapped sidebar navigation items in a semantic `<nav aria-label="Main navigation">` element for proper ARIA semantics and Playwright queryability (shadcn Sidebar renders divs, not nav)
- Used rgba() values directly for Azure tints rather than relying on Tailwind v4 oklch conversion to maintain exact brand colour fidelity
- Scoped all brand CSS variables to :root only (no dark mode variant) since this is an internal tool with a fixed brand palette
- Skipped drizzle-kit push (no live DATABASE_URL yet) -- user must configure Neon connection string before DB operations

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed sidebar accessibility for Playwright test**
- **Found during:** Task 2 (Playwright smoke tests)
- **Issue:** shadcn Sidebar renders as `<div>`, not `<nav>`. `getByRole("navigation")` couldn't find sidebar. Also `getByText("Kiosks")` matched both sidebar and page heading.
- **Fix:** Added `<nav aria-label="Main navigation">` wrapper around sidebar menu group. Scoped test assertions to nav element.
- **Files modified:** src/components/layout/app-sidebar.tsx, tests/smoke.spec.ts
- **Verification:** Both Playwright smoke tests pass
- **Committed in:** ae8a3ca (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Improved accessibility semantics. No scope creep.

## Issues Encountered

- create-next-app refused to run in a directory with existing files (.planning, .env.test). Resolved by temporarily moving files, running create-next-app, then restoring them.
- Drizzle-kit push was skipped because no real DATABASE_URL is configured yet (placeholder in .env.local). User must set up Neon connection before running `npx drizzle-kit push`.

## User Setup Required

Before Plan 01-02 (auth setup), the user must:
1. Create a Neon PostgreSQL project and database
2. Replace the placeholder `DATABASE_URL` in `.env.local` with the actual Neon connection string
3. Generate a random 32-character string for `BETTER_AUTH_SECRET` in `.env.local`
4. Run `npx drizzle-kit push` to push the schema to Neon

## Next Phase Readiness

- Full database schema ready for Better Auth adapter connection (Plan 01-02)
- App shell and route structure ready for auth protection (Plan 01-02)
- Login page placeholder ready for real auth form logic (Plan 01-02)
- Settings/users placeholder ready for RBAC UI (Plan 01-03)
- Playwright infrastructure ready for auth E2E tests

---
*Phase: 01-foundation*
*Completed: 2026-03-18*
