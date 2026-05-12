---
phase: "10"
plan: "04"
subsystem: "rbac / casl"
tags: ["rbac", "casl", "authorization", "shim", "field-redaction"]
dependency-graph:
  requires: ["10-03"]
  provides: ["rbac-casl-shim", "call-site-pattern-a"]
  affects: ["locations/actions.ts", "locations/[id]/page.tsx", "locations/new/page.tsx"]
tech-stack:
  added: []
  patterns: ["dual-path CASL shim", "readableFields Pattern A migration"]
key-files:
  created: []
  modified:
    - src/lib/rbac.ts
    - src/app/(app)/locations/actions.ts
    - src/app/(app)/locations/[id]/page.tsx
    - src/app/(app)/locations/new/page.tsx
decisions:
  - "Dual-path shim: CASL ability.can() when ability present, legacy role check as fallback — preserves bare UserCtx test fixtures"
  - "bankingDetails used as pivot field for canSeeSensitive boolean — consistent with external-invariant single source of truth"
  - "Pattern A for all 3 call sites: getUserCtx() + readableFields(ctx.ability, 'Location') + Set lookup — consistent approach across files"
metrics:
  duration: "~60 minutes (active)"
  completed: "2026-05-11T05:54:10Z"
  tasks-completed: 2
  tasks-total: 2
---

# Phase 10 Plan 04: RBAC Shim and Call Site Cutover Summary

CASL-delegating dual-path shim for `rbac.ts` + Pattern A migration of 3 Location call sites to `readableFields(ctx.ability, "Location")`.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Rewrite rbac.ts as CASL-delegating shim | `f834a39` | src/lib/rbac.ts |
| 2 | Migrate 3 call sites to CASL Pattern A | `035c4b4` | actions.ts, [id]/page.tsx, new/page.tsx |

## What Was Built

**Task 1 — rbac.ts CASL shim:**

`src/lib/rbac.ts` was rewritten as a dual-path shim preserving all existing public API signatures:
- `UserCtx` gains optional `ability?: AppAbility` field
- `canAccessSensitiveFields`: CASL path when `user.ability` present (`ability.can("read", "Location", "bankingDetails")`), legacy role check fallback for bare fixtures
- `redactSensitiveFields`: sensitive key lists imported from `external-invariant.ts` (single source of truth — T-10-04-02 mitigation)
- All 19 `rbac.test.ts` tests remain GREEN with no changes — bare `{userType, role}` fixtures take the legacy fallback path

**Task 2 — Pattern A call site migration:**

All 3 Location call sites migrated to `getUserCtx()` + `readableFields(ctx.ability, "Location")`:
- `actions.ts` `getLocation()`: `redactSensitiveFields(locationData, {userType, role})` replaced with Set-based field filter over `readableFields` result
- `[id]/page.tsx`: `getSessionOrThrow()` + `canAccessSensitiveFields({userType, role})` replaced with `getUserCtx()` + `allowed.has("bankingDetails")`
- `new/page.tsx`: same Pattern A migration as `[id]/page.tsx`

Acceptance criteria met: all 3 files now import `readableFields` from `@/lib/casl/fields`.

## Verification

- TypeScript: `npx tsc --noEmit` → no errors
- Tests: `npx vitest run --project unit src/lib/rbac.test.ts` → 19 PASS, 0 FAIL
- `location-products-client.tsx` not touched (owned by Plan 10-07)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan template used wrong import names**
- **Found during:** Task 1
- **Issue:** Plan template referenced `ALWAYS_SENSITIVE_KEYS` / `EXTERNAL_ADDITIONAL_KEYS` but actual `external-invariant.ts` exports are `BANKING_CONTRACT_FIELDS` / `EXTERNAL_ONLY_SENSITIVE_FIELDS`
- **Fix:** Used actual export names throughout
- **Files modified:** src/lib/rbac.ts

**2. [Rule 1 - Observation] [id]/page.tsx and new/page.tsx call `canAccessSensitiveFields`, not `redactSensitiveFields`**
- **Found during:** Task 2 analysis
- **Issue:** Plan described "3 redactSensitiveFields call sites" but the 2 RSC pages call `canAccessSensitiveFields` to produce a boolean prop. The migration pattern is the same (Pattern A) but produces a `canSeeSensitive` boolean via `allowed.has("bankingDetails")` rather than a redacted object.
- **Fix:** Applied Pattern A semantically — `getUserCtx()` + `readableFields` + Set lookup for boolean result
- **Files modified:** [id]/page.tsx, new/page.tsx

**3. [Rule 2 - Worktree] Worktree HEAD was on main branch tip**
- **Found during:** Session start
- **Issue:** Worktree HEAD was at `af24d24` (main) instead of `db3290b` (phase-10 branch). CASL directory was absent.
- **Fix:** `git reset --hard db3290b26912eeba72052c074ce9fef9f0a6a5ad` before any changes
- **Files modified:** none (git state correction only)

## Known Stubs

None — all field filtering is driven by live `ctx.ability` from `buildAbility(userId)`.

## Threat Flags

None — no new network endpoints or auth paths introduced. Field redaction moved from static key lists to CASL ability rules, which is a security improvement (ability is built from DB-persisted role-permission rules).

## Self-Check: PASSED

- `f834a39` exists in git log
- `035c4b4` exists in git log
- src/lib/rbac.ts present with CASL shim
- src/app/(app)/locations/actions.ts uses `readableFields`
- src/app/(app)/locations/[id]/page.tsx uses `readableFields`
- src/app/(app)/locations/new/page.tsx uses `readableFields`
