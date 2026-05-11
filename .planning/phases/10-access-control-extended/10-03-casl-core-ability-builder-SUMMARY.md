---
phase: 10
plan: "03"
subsystem: casl
tags: [casl, ability-builder, rbac, authorization, react-context]
dependency_graph:
  requires: [10-01, 10-02]
  provides: [casl-ability-builder, user-ctx-ability, ability-context]
  affects: [all-server-actions, all-route-handlers, analytics-queries]
tech_stack:
  added: ["@casl/ability", "@casl/react"]
  patterns: [MongoAbility, AbilityBuilder, createContextualCan, react.cache memoization]
key_files:
  created:
    - src/lib/casl/types.ts
    - src/lib/casl/subjects.ts
    - src/lib/casl/fields.ts
    - src/lib/casl/external-invariant.ts
    - src/lib/casl/seed.ts
    - src/lib/casl/role-mirror.ts
    - src/lib/casl/lockout-guard.ts
    - src/lib/casl/ability.ts
    - src/lib/casl/ability-context.tsx
  modified:
    - src/lib/auth/get-user-ctx.ts
    - src/lib/scoping/scoped-query.ts
    - src/app/locations/actions.ts
    - src/app/api/export/csv/route.ts
    - src/app/api/export/excel/route.ts
decisions:
  - "Used react.cache for per-request buildAbility memoization (no Redis needed at this tier)"
  - "Deny-wins semantics: rules sorted allow first, deny last to ensure CASL deny overrides"
  - "ALWAYS_SENSITIVE_KEYS enforced via applyExternalUserInvariant regardless of role rules"
  - "UserCtx widened with required ability: AppAbility (not optional) to force compile-time wiring"
  - "Double cast as unknown as 'Location' for condition-based can() calls in tests — CASL runtime handles __caslSubjectType__ correctly"
metrics:
  duration: "~3 hours"
  completed: "2026-05-10"
  tasks_completed: 4
  files_modified: 37
---

# Phase 10 Plan 03: CASL Core Ability Builder Summary

CASL MongoAbility builder with react.cache memoization, UserCtx widening with required ability field, and AbilityProvider/Can components for client-side hydration.

## What Was Built

### Task 1 — Pure CASL modules (d11c806)

- `types.ts`: `ACTIONS`/`SUBJECTS` const arrays, `Action`/`Subject` union types, `AppAbility = MongoAbility<[Action, Subject]>`, `RawRule` type
- `subjects.ts`: `SUBJECT_TABLES` registry mapping subjects to DB table names, `assertValidSubject`/`assertValidAction` runtime guards
- `fields.ts`: `fieldsOfSubject` (schema introspection) and `readableFields` via `permittedFieldsOf`
- `external-invariant.ts`: `ALWAYS_SENSITIVE_KEYS`, `EXTERNAL_ADDITIONAL_KEYS`, `applyExternalUserInvariant` — enforces field-level restrictions for external/kiosk users regardless of role rules
- `seed.ts`: `DEFAULT_ROLE_RULES` map (admin→manage all, ops-it→manage Location/Kiosk, viewer→read Location/Kiosk), `buildSeededAbility`, `getDefaultRulesForRole`

### Task 2 — Role-mirror and lockout-guard utilities (d7fa993)

- `role-mirror.ts`: `refreshUserRoleMirror` syncs `user_roles` table from `user.role` column; `PRIMARY_TIER_RANK` ordering
- `lockout-guard.ts`: `assertAtLeastOneEffectiveAdmin` queries `user_roles` + `role_permissions` to prevent last-admin lockout; `LOCKOUT_PREVENTION` constant

### Task 3 — buildAbility + UserCtx wiring (94afe0c)

- `ability.ts`: `buildAbility(userId)` wrapped in `react.cache` for per-request memoization — loads user row, user_roles, role_permissions, userScopes in one DB query; applies system short-circuit for admin (manage all); merges scope conditions for ops-it; applies external invariant last
- `UserCtx` in `scoped-query.ts` widened with required `ability: AppAbility` field
- `getUserCtx` in `get-user-ctx.ts` augmented to call `buildAbility` in both session paths and add to returned ctx
- `INTERNAL_USER_CTX` stub given empty ability cast
- All downstream files (`actions.ts`, `csv/route.ts`, `excel/route.ts`) updated where they construct UserCtx-like objects
- 20+ test files updated with `import type { AppAbility }` + `as AppAbility` cast on `createMongoAbility([])` calls

### Task 4 — AbilityProvider and Can (d47af7b)

- `ability-context.tsx`: `'use client'` directive; `AbilityContext` React context initialised with empty `AppAbility`; `Can` via `createContextualCan(AbilityContext.Consumer)`; `AbilityProvider` accepting `RawRuleOf<AppAbility>[]` props and memoizing via `useMemo`

## Test Results

- CASL unit tests: **48 PASS, 0 FAIL** (`src/lib/casl/__tests__/`)
- Wave 0 RED tests turned GREEN — `casl-ability.integration.test.ts` now compiles cleanly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ability.ts` committed in Task 3 not Task 1/2**
- Found during: Task 3 staging
- Issue: `ability.ts` was untracked (not in Tasks 1/2 commits from prior session) even though it is a core CASL module. It logically belongs with the builder wiring rather than the pure utilities.
- Fix: Included `ability.ts` in the Task 3 commit where it fits semantically.
- Files modified: `src/lib/casl/ability.ts`
- Commit: 94afe0c

**2. [Rule 1 - Bug] `createContext` initial value type mismatch**
- Found during: Task 4 write
- Issue: `createMongoAbility([])` without type parameter returns `MongoAbility<AbilityTuple>` not `AppAbility`, causing a type error when passed to `createContext<AppAbility>`.
- Fix: Added `as AppAbility` cast on the initial context value: `createMongoAbility([]) as AppAbility`.
- Files modified: `src/lib/casl/ability-context.tsx`
- Commit: d47af7b

**3. [Rule 1 - Bug] CASL `subject()` helper insufficient for string-union Subject**
- Found during: Task 3 (fixing `casl-ability.integration.test.ts`)
- Issue: `subject("Location", obj)` returns `ForcedSubject<"Location">` (an intersection type) which is not assignable to `Subject` (plain string union). First fix attempt failed.
- Fix: Used `as unknown as "Location"` double cast — preserves CASL runtime `__caslSubjectType__` detection while satisfying TypeScript.
- Files modified: `tests/db/casl-ability.integration.test.ts`
- Commit: 94afe0c

## Known Stubs

None — `buildAbility` is fully wired to the DB schema from Tasks 10-01 and 10-02.

## Threat Flags

None — no new network endpoints or auth paths introduced. `ability-context.tsx` is a client-only React context component; server-side `buildAbility` is the trust boundary, enforced in `getUserCtx`.

## Self-Check: PASSED

Files verified:
- src/lib/casl/types.ts: FOUND
- src/lib/casl/subjects.ts: FOUND
- src/lib/casl/fields.ts: FOUND
- src/lib/casl/external-invariant.ts: FOUND
- src/lib/casl/seed.ts: FOUND
- src/lib/casl/role-mirror.ts: FOUND
- src/lib/casl/lockout-guard.ts: FOUND
- src/lib/casl/ability.ts: FOUND
- src/lib/casl/ability-context.tsx: FOUND

Commits verified:
- d11c806: feat(10-03): add pure CASL modules
- d7fa993: feat(10-03): add role-mirror and lockout-guard utilities
- 94afe0c: feat(10-03): wire buildAbility into getUserCtx and widen UserCtx
- d47af7b: feat(10-03): add AbilityProvider and Can component for RSC hydration
