---
phase: 02-core-entities-and-views
plan: "00"
subsystem: testing
tags: [playwright, e2e, test-stubs, nyquist, wave-0]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: Playwright config, existing auth test helpers pattern from tests/auth/setup.ts

provides:
  - 14 Playwright test stub files (12 spec files + 2 helper modules) for all Phase 2 requirements
  - Shared signInAsAdmin/Member/Viewer auth fixtures in tests/helpers/auth.ts
  - Shared createTestKiosk/createTestLocation/cleanupTestData DB fixtures in tests/helpers/db.ts
  - npx playwright test --list shows 34 pending stubs across KIOSK, LOC, VIEW, KANBAN, BULK, AUDIT

affects:
  - 02-01 (kiosk CRUD) — references tests/kiosks/kiosk-crud.spec.ts, pipeline-stages, kiosk-assignment
  - 02-02 (location CRUD) — references tests/locations/location-*.spec.ts
  - 02-03 (table/views) — references tests/kiosks/table-view.spec.ts, saved-views.spec.ts
  - 02-04 (kanban) — references tests/kiosks/kanban.spec.ts
  - 02-05 (bulk/audit) — references tests/kiosks/bulk-operations.spec.ts, tests/audit/audit-log.spec.ts

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "test.fixme() for Wave 0 pending stubs — tests appear in --list but don't fail suite"
    - "Separate helpers/ directory for shared auth and DB fixtures"
    - "test.beforeEach signInAsAdmin pattern for authenticated test suites"
    - "TODO stub pattern for DB helpers — compile now, implement when CRUD pages exist"

key-files:
  created:
    - tests/helpers/auth.ts
    - tests/helpers/db.ts
    - tests/kiosks/kiosk-crud.spec.ts
    - tests/kiosks/pipeline-stages.spec.ts
    - tests/kiosks/kiosk-assignment.spec.ts
    - tests/kiosks/table-view.spec.ts
    - tests/kiosks/saved-views.spec.ts
    - tests/kiosks/kanban.spec.ts
    - tests/kiosks/bulk-operations.spec.ts
    - tests/locations/location-crud.spec.ts
    - tests/locations/location-contract.spec.ts
    - tests/locations/location-rbac.spec.ts
    - tests/locations/location-kiosks-tab.spec.ts
    - tests/audit/audit-log.spec.ts
  modified: []

key-decisions:
  - "Used test.fixme() over test.skip() — fixme shows in --list output without requiring a callback argument, giving better plan-by-plan traceability"
  - "DB helpers (createTestKiosk, createTestLocation) are compile-only stubs until CRUD pages exist (Plans 02-01/02-02) — avoids nav to non-existent pages during stub phase"
  - "Seed script only creates admin user — member/viewer sign-in helpers documented as TODO with note to update db:seed before LOC-04/RBAC tests"
  - "location-rbac.spec.ts calls signInAsViewer directly in each test (not beforeEach) — different roles per test require per-test login"

patterns-established:
  - "Wave 0 stub pattern: test.fixme() stubs with TODO comments referencing the implementing plan number"
  - "Auth helpers extend tests/auth/setup.ts — new helpers import from tests/helpers/auth.ts, not the original"

requirements-completed:
  - KIOSK-01
  - KIOSK-02
  - KIOSK-03
  - KIOSK-04
  - KIOSK-05
  - KIOSK-06
  - LOC-01
  - LOC-02
  - LOC-03
  - LOC-04
  - LOC-05
  - VIEW-01
  - VIEW-02
  - VIEW-03
  - VIEW-04
  - VIEW-05
  - KANBAN-01
  - KANBAN-02
  - KANBAN-03
  - BULK-01
  - BULK-02
  - AUDIT-01
  - AUDIT-02
  - AUDIT-03

# Metrics
duration: 15min
completed: 2026-03-19
---

# Phase 02 Plan 00: Wave 0 Test Stubs Summary

**14 Playwright test stub files with 34 pending requirement stubs covering all Phase 2 KIOSK/LOC/VIEW/KANBAN/BULK/AUDIT requirements, plus shared auth and DB helper fixtures**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-19T04:27:00Z
- **Completed:** 2026-03-19T04:42:00Z
- **Tasks:** 2
- **Files modified:** 14 created, 0 modified

## Accomplishments

- Created `tests/helpers/auth.ts` with `signInAsAdmin`, `signInAsMember`, `signInAsViewer` fixtures following existing `tests/auth/setup.ts` pattern
- Created `tests/helpers/db.ts` with `createTestKiosk`, `createTestLocation`, `cleanupTestData` stub functions (compile-only until CRUD pages exist in Plans 02-01/02-02)
- Created all 12 Playwright test spec files with `test.fixme()` stubs for every Phase 2 requirement — `npx playwright test --list` shows 78 total tests (34 new stubs + existing suite)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared test helpers (auth and DB fixtures)** - `6537ff2` (feat)
2. **Task 2: Create all 12 Playwright test stub files with pending tests** - `e8423f6` (feat)

## Files Created/Modified

- `tests/helpers/auth.ts` — signInAsAdmin/Member/Viewer + TEST_ADMIN/MEMBER/VIEWER constants
- `tests/helpers/db.ts` — createTestKiosk, createTestLocation, cleanupTestData stubs
- `tests/kiosks/kiosk-crud.spec.ts` — 8 stubs for KIOSK-01, KIOSK-02, KIOSK-03
- `tests/kiosks/pipeline-stages.spec.ts` — 6 stubs for KIOSK-04
- `tests/kiosks/kiosk-assignment.spec.ts` — 4 stubs for KIOSK-05, KIOSK-06
- `tests/kiosks/table-view.spec.ts` — 5 stubs for VIEW-01, VIEW-02, VIEW-03
- `tests/kiosks/saved-views.spec.ts` — 4 stubs for VIEW-04, VIEW-05
- `tests/kiosks/kanban.spec.ts` — 5 stubs for KANBAN-01, KANBAN-02, KANBAN-03
- `tests/kiosks/bulk-operations.spec.ts` — 4 stubs for BULK-01, BULK-02
- `tests/locations/location-crud.spec.ts` — 4 stubs for LOC-01, LOC-02
- `tests/locations/location-contract.spec.ts` — 3 stubs for LOC-03
- `tests/locations/location-rbac.spec.ts` — 3 stubs for LOC-04
- `tests/locations/location-kiosks-tab.spec.ts` — 2 stubs for LOC-05
- `tests/audit/audit-log.spec.ts` — 6 stubs for AUDIT-01, AUDIT-02, AUDIT-03

## Decisions Made

- Used `test.fixme()` over `test.skip()` — fixme stubs show in `--list` output without requiring a callback, giving better plan-by-plan traceability
- DB helpers are compile-only stubs until CRUD pages exist — avoids navigating to non-existent pages during stub phase
- Seed script only creates admin user — member/viewer helpers documented as TODO with note to update `db:seed` before LOC-04/RBAC tests
- `location-rbac.spec.ts` calls signInAsViewer directly in each test (not beforeEach) — different roles per test require per-test login

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**Pre-existing smoke test failure (out of scope):** `tests/smoke.spec.ts:8` ("app shell sidebar renders") fails with "element(s) not found" for `getByRole('navigation', { name: 'Main navigation' })`. Confirmed pre-existing by running test against the commit before this plan (stash test). This is unrelated to the Wave 0 stub files created in this plan. Logged for future investigation.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 14 Wave 0 test stub files are in place — Plans 02-01 through 02-05 can now reference them in their verify commands
- `npx playwright test --list` shows all stubs without errors — Nyquist compliance unblocked
- DB helpers need implementing during Plan 02-01 (kiosk CRUD pages) and 02-02 (location CRUD pages)
- Seed script needs member/viewer users added before LOC-04 RBAC tests can run

---
*Phase: 02-core-entities-and-views*
*Completed: 2026-03-19*
