---
phase: 03-advanced-views
plan: 01
subsystem: database
tags: [drizzle, postgres, neon, server-actions, playwright, zod]

# Dependency graph
requires:
  - phase: 02-core-entities-and-views
    provides: kiosks/locations schema, kiosk CRUD pattern, audit log, rbac helpers, Playwright test patterns

provides:
  - installations table with status/region/date range columns
  - milestones table with cascade FK to installations
  - installation_kiosks join table
  - installation_members join table (text userId per Better Auth decision)
  - userViews.viewType column with default "table"
  - 11 server actions: createInstallation, listInstallations, getInstallation, updateInstallation, deleteInstallation, createMilestone, deleteMilestone, addInstallationMember, removeInstallationMember, linkKioskToInstallation, unlinkKioskFromInstallation
  - 20 Playwright test stubs covering GANTT-01 to GANTT-04, CAL-01, CAL-02, and view-tab routing

affects:
  - 03-02 (installation CRUD pages depend on these tables and actions)
  - 03-03 (Gantt component depends on installations + milestones data)
  - 03-04 (Calendar component depends on installations + milestones data)
  - 03-05 (Integration depends on all Phase 3 schema)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Installation server actions follow kiosks/actions.ts pattern with requireRole + Zod + try/catch"
    - "test.fixme with async callback for Wave 0 stubs — no-callback form causes TypeScript errors in this Playwright version"
    - "inArray() from drizzle-orm for multi-installation queries — column.in() doesn't exist on Drizzle columns"

key-files:
  created:
    - src/app/(app)/installations/actions.ts
    - tests/helpers/installation-helpers.ts
    - tests/installations/crud.spec.ts
    - tests/installations/gantt.spec.ts
    - tests/installations/calendar.spec.ts
    - tests/installations/view-tabs.spec.ts
  modified:
    - src/db/schema.ts
    - src/lib/audit.ts

key-decisions:
  - "test.fixme requires async callback argument in current Playwright version — test.fixme('title') without callback fails TypeScript; must use test.fixme('title', async ({ page }) => { void page; })"
  - "audit.ts entityType extended to include 'installation'; action extended to include 'delete' — installations support hard delete, not archive"
  - "inArray() from drizzle-orm used for multi-row WHERE IN queries — Drizzle column objects have no .in() method"

patterns-established:
  - "Wave 0 test stubs use test.fixme('title', async ({ page }) => { void page; }) pattern"
  - "Server actions for join-table operations (link/unlink) use and(eq(), eq()) for compound WHERE"

requirements-completed:
  - GANTT-01
  - GANTT-03
  - GANTT-04

# Metrics
duration: 5min
completed: 2026-03-19
---

# Phase 3 Plan 01: Installation Data Foundation Summary

**Four new Drizzle tables (installations, milestones, installation_kiosks, installation_members) pushed to Neon, 11 server actions with Zod/RBAC, and 20 Playwright Wave 0 stubs covering all Phase 3 requirement IDs**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-19T11:52:50Z
- **Completed:** 2026-03-19T11:57:14Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Added 4 new tables to schema.ts and pushed to Neon via drizzle-kit push --force
- Added viewType column to userViews with default "table"
- Created 11 typed server actions for full installation/milestone/member/kiosk-link CRUD
- Created 20 Playwright test stubs (all test.fixme) covering GANTT-01 to GANTT-04, CAL-01, CAL-02, and view-tab routing
- TypeScript compiles clean; all 20 stubs appear in npx playwright test --list

## Task Commits

1. **Task 1: Schema extension** - `3ed53e7` (feat)
2. **Task 2: Server actions + test stubs** - `7bbbd0e` (feat)

## Files Created/Modified

- `src/db/schema.ts` - Added installations, milestones, installationKiosks, installationMembers tables; added viewType to userViews
- `src/app/(app)/installations/actions.ts` - 11 server actions with Zod validation, requireRole, try/catch error handling
- `src/lib/audit.ts` - Extended entityType to include "installation"; action to include "delete"
- `tests/helpers/installation-helpers.ts` - Stub helpers for Phase 3 tests
- `tests/installations/crud.spec.ts` - 3 test.fixme stubs for installation CRUD
- `tests/installations/gantt.spec.ts` - 7 test.fixme stubs for GANTT-01 to GANTT-04 plus interactions
- `tests/installations/calendar.spec.ts` - 6 test.fixme stubs for CAL-01 and CAL-02
- `tests/installations/view-tabs.spec.ts` - 4 test.fixme stubs for ?view= URL routing

## Decisions Made

- **test.fixme requires callback**: The no-argument `test.fixme("title")` form causes TypeScript overload errors in the current Playwright version. All Wave 0 stubs use `test.fixme("title", async ({ page }) => { void page; })`.
- **audit.ts extended for "installation"**: entityType union and action union both extended to support installation CRUD operations (delete action added, as installations support hard delete not archive).
- **inArray() not column.in()**: Drizzle ORM columns don't have an `.in()` method. Multi-row WHERE IN queries require `inArray(column, values)` imported from drizzle-orm.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extended audit.ts to support "installation" entityType and "delete" action**
- **Found during:** Task 2 (creating actions.ts)
- **Issue:** writeAuditLog signature only accepted "kiosk" | "location" for entityType and didn't include "delete" as a valid action. Installation actions need both.
- **Fix:** Extended union types in audit.ts for entityType and action
- **Files modified:** src/lib/audit.ts
- **Verification:** TypeScript compiles without errors
- **Committed in:** 7bbbd0e (Task 2 commit)

**2. [Rule 1 - Bug] Fixed test.fixme no-callback TypeScript error**
- **Found during:** Task 2 (creating test stub files)
- **Issue:** `test.fixme("title")` without a callback fails TypeScript overload resolution in current Playwright version
- **Fix:** Changed all stubs to `test.fixme("title", async ({ page }) => { void page; })`
- **Files modified:** all 4 test spec files
- **Verification:** `npx tsc --noEmit` passes, `npx playwright test --list` shows 20 stubs
- **Committed in:** 7bbbd0e (Task 2 commit)

**3. [Rule 1 - Bug] Fixed inArray usage in listInstallations**
- **Found during:** Task 2 (TypeScript check on actions.ts)
- **Issue:** Used `column.in(array)` which doesn't exist on Drizzle PgColumn; TypeScript error TS2339
- **Fix:** Replaced with `inArray(column, array)` imported from drizzle-orm
- **Files modified:** src/app/(app)/installations/actions.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 7bbbd0e (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 missing critical, 2 bugs)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None — no external service configuration required. Schema pushed to Neon via drizzle-kit push.

## Next Phase Readiness

- Installation schema exists in Neon DB — Plan 03-02 can build CRUD pages immediately
- Server actions are typed and tested at compile level — Plan 03-02 can import and use them
- Test stubs are registered — Gantt/Calendar implementations in Plans 03-03/03-04 can fill them in
- No blockers

---
*Phase: 03-advanced-views*
*Completed: 2026-03-19*
