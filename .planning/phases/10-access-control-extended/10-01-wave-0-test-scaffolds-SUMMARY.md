---
phase: "10"
plan: "01"
subsystem: "access-control / test-infrastructure"
tags: ["tdd", "wave-0", "red-tests", "casl", "typescript"]
dependency_graph:
  requires: []
  provides:
    - "wave-0 RED test scaffolds for Plans 10-02 through 10-07"
    - "@casl/ability installed as dev dependency"
  affects:
    - "src/lib/casl/__tests__/ (6 unit stubs)"
    - "tests/db/ (5 integration stubs)"
    - "tests/access-control/ (4 Playwright stubs)"
tech_stack:
  added:
    - "@casl/ability@^6.7.3"
  patterns:
    - "Wave 0 RED pattern: @ts-expect-error suppresses module-not-found errors on internal CASL modules that don't exist until Plan 10-03"
    - "dynamic import() as any pattern for not-yet-existing schema exports"
    - "ctx.db.query as any for Drizzle relational queries on not-yet-registered tables"
key_files:
  created: []
  modified:
    - "package.json"
    - "package-lock.json"
    - "src/lib/casl/__tests__/ability.test.ts"
    - "src/lib/casl/__tests__/deny-wins.test.ts"
    - "src/lib/casl/__tests__/external-invariant.test.ts"
    - "src/lib/casl/__tests__/permitted-fields.test.ts"
    - "src/lib/casl/__tests__/seed.test.ts"
    - "src/lib/casl/__tests__/subjects.test.ts"
    - "tests/db/casl-ability.integration.test.ts"
    - "tests/db/custom-role.integration.test.ts"
    - "tests/db/lockout-guard.integration.test.ts"
    - "tests/db/better-auth-admin-plugin.integration.test.ts"
    - "tests/db/migration-0051-backfill.integration.test.ts"
decisions:
  - "Use @ts-expect-error (not @ts-ignore) so TypeScript enforces suppression removal when modules are created"
  - "Cast dynamic import('@/db/schema') as any for not-yet-existing table exports rather than adding stub schema entries"
  - "Install @casl/ability@^6.7.3 as devDependency; lockfile updated via npm install --package-lock-only"
metrics:
  duration: "~90 minutes (cross-session)"
  completed_date: "2026-05-10"
  tasks_completed: 4
  files_modified: 13
---

# Phase 10 Plan 01: Wave 0 RED Test Scaffolds Summary

**One-liner:** Wave 0 RED test scaffolds for CASL RBAC — 15 test files covering unit/integration/E2E, all cleanly typed with `@ts-expect-error` and `as any` patterns, deliberately failing at runtime until Plans 10-02/10-03 implement the CASL modules.

## What Was Built

- **6 unit test stubs** under `src/lib/casl/__tests__/`: ability, deny-wins, external-invariant, permitted-fields, seed, subjects
- **5 integration test stubs** under `tests/db/`: casl-ability, custom-role, lockout-guard, better-auth-admin-plugin, migration-0051-backfill
- **4 Playwright E2E stubs** under `tests/access-control/`: can-component, edit-tier, role-editor, user-role-assignment
- **Auth fixtures extended**: `tests/helpers/auth.ts` with `TEST_OPS_IT` / `TEST_VIEWER` credentials + `signInAs` helper

## Verification

- `tsc --noEmit`: **zero errors**
- `playwright test --list tests/access-control/`: **4 specs parsed cleanly, 0 failures**
- Runtime failures preserved: all integration tests fail at module-load because `@/lib/casl/ability`, `@/lib/casl/lockout-guard`, `@/lib/casl/role-mutations` do not exist yet (Wave 2 GREEN bar)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Install @casl/ability dev dependency**
- **Found during:** Task 1 (unit test stubs import from `@casl/ability`)
- **Issue:** `@casl/ability` was not in package.json; TypeScript could not resolve the import
- **Fix:** `npm install --save-dev @casl/ability@^6.7.3 --package-lock-only` then `npm ci --ignore-scripts`
- **Files modified:** `package.json`, `package-lock.json`
- **Commit:** ec5aa18

**2. [Rule 1 - Bug] Fix @ts-expect-error scope on multi-line import blocks**
- **Found during:** Task 3 (integration test TypeScript check)
- **Issue:** `@ts-expect-error` only suppresses the immediately following line. Multi-line `import { ... } from "..."` blocks caused TS2578 (unused directive) + TS2307 (module not found) because the directive was on `import {` not on the `from "..."` line
- **Fix:** Collapsed all affected imports to single lines
- **Files modified:** `tests/db/lockout-guard.integration.test.ts`
- **Commit:** 664a979

**3. [Rule 1 - Bug] Cast dynamic import("@/db/schema") as any for not-yet-existing exports**
- **Found during:** Task 3 (tsc --noEmit)
- **Issue:** TypeScript resolves dynamic `import()` to the module's actual type and checks destructured property names at compile time. `roles`, `userRoles`, `rolePermissions` aren't exported from schema yet (Plan 10-02 creates them), causing TS2339
- **Fix:** `await import("@/db/schema") as any` at all call sites accessing not-yet-existing exports
- **Files modified:** `tests/db/migration-0051-backfill.integration.test.ts`, `tests/db/better-auth-admin-plugin.integration.test.ts`, `tests/db/lockout-guard.integration.test.ts`
- **Commit:** 664a979

**4. [Rule 1 - Bug] Cast ctx.db.query as any for not-yet-registered Drizzle tables**
- **Found during:** Task 3 (tsc --noEmit)
- **Issue:** Drizzle's relational query object is typed based on registered tables. `ctx.db.query.roles` causes TS2339 because the `roles` table isn't registered in schema yet
- **Fix:** `const dbQ = ctx.db.query as any;` at all call sites
- **Files modified:** `tests/db/migration-0051-backfill.integration.test.ts`, `tests/db/better-auth-admin-plugin.integration.test.ts`, `tests/db/lockout-guard.integration.test.ts`
- **Commit:** 664a979

## Commits

| Hash | Description |
|------|-------------|
| ec5aa18 | test(10-01): extend auth fixtures with TEST_OPS_IT / TEST_VIEWER + signInAs helper |
| 25bee14 | test(10-01): add 6 RED unit-test scaffolds for @/lib/casl/* |
| cff362f | test(10-01): add 5 integration + 4 Playwright RED scaffolds |
| 664a979 | test(10-01): add Wave 0 RED test scaffolds with @ts-expect-error directives |

## Known Stubs

All 15 test files are intentional stubs — they will remain failing at runtime until Plans 10-02/10-03/10-04 implement the CASL modules. This is the correct Wave 0 RED pattern; stubs are not unintentional.

## Self-Check: PASSED
