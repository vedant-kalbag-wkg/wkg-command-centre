---
phase: 04-data-migration
plan: 00
subsystem: database
tags: [drizzle, postgres, vitest, playwright, monday-com, schema]

# Dependency graph
requires:
  - phase: 03-advanced-views
    provides: installation tables and schema patterns used as reference for phase 4 table additions
provides:
  - products table (id, name unique, timestamps) — target for Monday.com product seeding
  - providers table (id, name unique, timestamps) — target for Monday.com provider seeding
  - location_products table (location FK, product FK, provider FK nullable, availability, commissionTiers JSONB, timestamps)
  - Vitest configuration with node environment and @ alias for unit testing
  - 14 todo unit test stubs for monday-client (pagination, retry, subitems, field mapping)
  - 5 fixme Playwright E2E stubs for data import flow
affects: [04-01-board-exploration, 04-01-import-ui]

# Tech tracking
tech-stack:
  added: [vitest]
  patterns: [todo stubs for TDD-ready unit tests, fixme stubs for Playwright E2E verification]

key-files:
  created:
    - src/lib/__tests__/monday-client.test.ts
    - tests/admin/data-import.spec.ts
    - vitest.config.ts
  modified:
    - src/db/schema.ts

key-decisions:
  - "vitest.config.ts excludes tests/** to avoid vitest picking up Playwright spec files"
  - "locationProducts.providerId nullable — not all products have an assigned provider at import time"
  - "commissionTiers JSONB typed as Array<{ minRevenue, maxRevenue | null, rate }> — supports variable tier count per D-13"

patterns-established:
  - "Vitest include pattern: src/**/__tests__/**/*.test.ts — unit tests colocated with source in __tests__ dirs"
  - "Vitest exclude pattern: tests/** — Playwright specs isolated from vitest runs"

requirements-completed: [MIGR-01, MIGR-02, MIGR-03]

# Metrics
duration: 8min
completed: 2026-04-01
---

# Phase 4 Plan 00: Schema Extension and Test Scaffolding Summary

**Three new DB tables (products, providers, location_products with JSONB commission tiers) pushed to Postgres; Vitest configured with 14 todo unit stubs and 5 Playwright fixme stubs for Phase 4 migration work**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-01T18:35:00Z
- **Completed:** 2026-04-01T18:38:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added three Phase 4 tables to `src/db/schema.ts` with correct types, FKs, UNIQUE constraints, and JSONB commission tiers per D-12/D-13
- Pushed schema changes to Supabase Postgres via `drizzle-kit push` (clean apply)
- Installed vitest and created `vitest.config.ts` with node environment, globals, and `@` alias; configured to exclude Playwright test files
- Created 14 `it.todo` unit test stubs for monday-client covering mondayQuery, cursor pagination, rate-limit retry, subitems, and field mapping
- Created 5 `test.fixme` Playwright E2E stubs covering settings card, data-import page, dry-run, import progress, and completion

## Task Commits

Each task was committed atomically:

1. **Task 1: Add products, providers, location_products tables to schema** - `60bc51c` (feat)
2. **Task 2: Vitest config, monday-client unit stubs, data-import E2E stubs** - `88fd4f6` (feat)

## Files Created/Modified
- `src/db/schema.ts` - Added Phase 4 product/provider tables section with three new pgTable definitions
- `vitest.config.ts` - Vitest configuration with node environment, globals, @ alias, and explicit include/exclude patterns
- `src/lib/__tests__/monday-client.test.ts` - 14 todo unit test stubs for Monday.com API client
- `tests/admin/data-import.spec.ts` - 5 fixme Playwright E2E stubs for data import flow
- `package.json` / `package-lock.json` - vitest added as dev dependency

## Decisions Made
- **vitest include/exclude config**: Vitest's default glob picked up Playwright spec files and caused test type conflicts. Fixed by setting explicit `include: ["src/**/__tests__/**/*.test.ts"]` and `exclude: ["tests/**"]` in vitest.config.ts.
- **nullable providerId**: `locationProducts.providerId` is nullable — during import, some location_products rows may exist without a provider until admin assigns one (per D-12).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Vitest config needed explicit include/exclude to avoid Playwright conflicts**
- **Found during:** Task 2 (vitest configuration)
- **Issue:** Default vitest glob included `tests/*.spec.ts` files which use Playwright test types; `test.describe()` from Playwright threw `"Playwright Test did not expect test.describe() to be called here"` errors
- **Fix:** Added `include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"]` and `exclude: ["tests/**", "node_modules/**"]` to vitest.config.ts
- **Files modified:** vitest.config.ts
- **Verification:** `npx vitest run --reporter=verbose` shows 14 todo tests with 0 failures
- **Committed in:** 88fd4f6 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary fix for correct vitest operation. No scope creep.

## Issues Encountered
- `.env.local` not present in worktree (git worktrees don't copy ignored files) — symlinked from main repo before running `drizzle-kit push`

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema ready: products, providers, location_products tables available for Plans 04-01 and 04-02
- Test infrastructure ready: vitest runs cleanly, Playwright stubs listed
- Plan 04-01 (Board Exploration) can proceed — reads Monday.com API structure to validate field mappings

---
*Phase: 04-data-migration*
*Completed: 2026-04-01*
