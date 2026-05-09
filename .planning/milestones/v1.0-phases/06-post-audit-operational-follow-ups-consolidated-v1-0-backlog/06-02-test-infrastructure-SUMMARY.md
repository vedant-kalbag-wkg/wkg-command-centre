---
phase: 06-post-audit-operational-follow-ups-consolidated-v1-0-backlog
plan: 02
subsystem: testing
tags: [vitest, playwright, monday, graphql, drizzle, regression]

# Dependency graph
requires:
  - phase: 04-data-migration
    provides: Inline Monday GraphQL traffic in src/lib/monday/import-location-products.ts (the implementation under test)
  - phase: 05
    provides: PR #29 fix to listConfigGroups (commit fbcce77) — the bug this regression spec catches
provides:
  - First-class src/lib/monday/client.ts module (mondayQuery, mondayQueryWithRetry, iterateBoardItems, mapColumnValues, extractStatusLabel)
  - 14 passing unit tests covering Monday GraphQL surface (auth, error, pagination, retry, mapping, status-label extraction)
  - Permanent Playwright regression spec for kiosk-config-groups multi-location list/detail pages
  - Cross-reference comment in tests/kiosk-config-groups/list.spec.ts pointing operators at the revert/run/restore exercise
affects: [Future Monday CLI scripts that should adopt @/lib/monday/client; future kiosk-config-groups SQL refactors]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "vi.stubGlobal('fetch', ...) for HTTP-mocking unit tests"
    - "vi.useFakeTimers() + vi.advanceTimersByTimeAsync() for retry-with-backoff tests"
    - "Test prerequisite assertion in beforeAll (throw-loud-on-missing-seed) instead of silent skip"

key-files:
  created:
    - src/lib/monday/client.ts
    - tests/kiosk-config-groups/multi-location.spec.ts
    - .planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-02-test-infrastructure-SUMMARY.md
  modified:
    - src/lib/__tests__/monday-client.test.ts
    - src/lib/monday/import-location-products.ts
    - tests/kiosk-config-groups/list.spec.ts
    - tasks/todo.md

key-decisions:
  - "mapColumnValues accepts a `keyBy: 'id' | 'title'` parameter — the existing test surface keys by Monday column id (stable) and by title (human-readable), and a single helper supports both rather than splitting into two functions"
  - "import-location-products.ts bridges its dep-injected mondayApiToken into process.env.MONDAY_API_TOKEN for the duration of the call, then restores via try/finally — preserves the existing public signature while letting the new env-driven client handle auth"
  - "Multi-location regression spec aborts loudly in beforeAll when DB has no regions row instead of silently passing — missing seed becomes a CI signal, not a green-but-empty test"

patterns-established:
  - "Pattern: extracted-then-tested — when planner says 'fill the it.todo placeholders' but the implementation is inline, extract to a module first, then fill against the real surface"
  - "Pattern: defensive afterAll — guard each delete behind `if (id)` so a beforeAll throw doesn't time out the cleanup hook"

requirements-completed: [SC7, SC8, SC10]

# Metrics
duration: 38min
completed: 2026-04-28
---

# Phase 06 Plan 02: Test Infrastructure Summary

**Extracted Monday GraphQL client into `src/lib/monday/client.ts` (mondayQuery / mondayQueryWithRetry / iterateBoardItems / mapColumnValues / extractStatusLabel), filled all 14 `it.todo` placeholders with real fetch-stubbed unit tests, and added a multi-location kiosk-config-groups Playwright regression spec that catches PR #29's `ANY(${ids})` Drizzle bug.**

## Performance

- **Duration:** ~38 min
- **Started:** 2026-04-28T05:03Z
- **Completed:** 2026-04-28T05:41Z
- **Tasks:** 3 (all autonomous, no checkpoints)
- **Files modified:** 6 (2 created + 4 modified)
- **Lines changed:** +979 / -64 (net +915)

## Accomplishments

- **SC7 closed:** `src/lib/monday/client.ts` is now a first-class testable module. All 14 previously-`it.todo` placeholders in `src/lib/__tests__/monday-client.test.ts` are real `it(...)` tests covering auth header, missing-token throw, GraphQL error propagation, single-page items_page, multi-page cursor follow, empty board, retry-on-rate-limit (with fake-timer-driven backoff), max-retry-throw, no-retry-on-non-rate-limit, subitem nesting, mapColumnValues by id and title, unmapped-column residual, and extractStatusLabel across the three known StatusValue shapes.
- **SC8 closed:** `tests/kiosk-config-groups/multi-location.spec.ts` seeds a config group with exactly 2 active linked locations + 1 active product (availability="yes"), then asserts `/kiosk-config-groups` (list) and `/kiosk-config-groups/[id]` (detail) render with HTTP < 400 and zero browser console errors. The seed shape is exactly what tripped `listConfigGroups` pre-`fbcce77` (the broken `ANY(($1, $2, $3))` binding that PostgreSQL rejected with SQLSTATE 42809 on `ids.length >= 2`).
- **SC10 contribution:** `tasks/todo.md` records the plan completion under "Informal follow-ups" with a one-paragraph summary tying both halves of the work to the success criteria.
- **Bonus:** legacy inline GraphQL fetch + retry loop removed from `import-location-products.ts` — single shared retry implementation across the codebase.

## Task Commits

Each task was committed atomically with `--no-verify` (per Wave 2 sequential-execution instructions; the orchestrator validates hooks once after all agents complete):

1. **Task 1: Extract Monday client + fill 14 tests** — `07b3ac9` (feat)
2. **Task 2: Multi-location kiosk-config-groups Playwright fixture** — `8298333` (test)
3. **Task 3: Update tasks/todo.md** — `cb6cd94` (docs)

_Task 1 was a TDD task. The plan calls for separate RED (test) → GREEN (impl) → REFACTOR (consume) commits, but in this case the RED-only state would not have typechecked (the test file imports a module that doesn't exist), so all three TDD steps landed in a single feat commit. The commit message documents the RED → GREEN → REFACTOR sequence explicitly so the history is still legible._

## Files Created/Modified

- **`src/lib/monday/client.ts` (created, 310 LOC)** — Monday GraphQL client. Public surface: `mondayQuery<T>(query, variables)`, `mondayQueryWithRetry<T>(query, variables, options?)`, `iterateBoardItems(boardId, options?)`, `mapColumnValues<TFieldMap>(item, fieldMap, keyBy)`, `extractStatusLabel(value)`. Plus `MondayItem` and `MondayColumnValue` types.
- **`src/lib/__tests__/monday-client.test.ts` (modified, +375 / -3)** — 14 real unit tests replacing the 14 `it.todo` placeholders. All HTTP via `vi.stubGlobal("fetch", ...)`. Rate-limit retry tests use `vi.useFakeTimers() + vi.advanceTimersByTimeAsync()` to fast-forward exponential backoff sleeps.
- **`src/lib/monday/import-location-products.ts` (modified, +30 / -64)** — Inline `fetch(...)` + retry loop replaced with delegation to `mondayQueryWithRetry`. The dep-injected `mondayApiToken` is bridged into `process.env.MONDAY_API_TOKEN` for the duration of the call (restored via try/finally) so the env-driven client works without changing the public function signature. Legacy `Monday.com GraphQL error: ...` error prefix preserved.
- **`tests/kiosk-config-groups/multi-location.spec.ts` (created, 222 LOC)** — Playwright regression spec for PR #29's `ANY(${ids})` bug. Seeds + asserts + cleans up.
- **`tests/kiosk-config-groups/list.spec.ts` (modified, +9 / 0)** — Top-of-file comment cross-referencing `multi-location.spec.ts` and the manual revert/run/restore verification procedure.
- **`tasks/todo.md` (modified, +3 / -2)** — One-paragraph completion line under "Informal follow-ups". Carries along earlier 5.2 / 5.4 status updates the operator made on disk.

## Decisions Made

- **`mapColumnValues` keying** — accepts `keyBy: "id" | "title"` parameter. Most production call sites in this repo key column_values by Monday's stable column id (e.g. `mirror9`, `label2__1`, `dup__of_commission9__1`), but the test contract for tests 12/13 explicitly maps `"Hotel Name"` and `"Address"` (titles). Rather than ship two near-identical helpers, the single helper supports both.
- **No new dependencies** — explicitly required by the plan. The new client is built on `fetch` (global) and `vitest`'s built-in `vi.stubGlobal` / `vi.useFakeTimers` — both already in the repo. Lockfile untouched (per CLAUDE.md npm-ci hardening).
- **Spec abort on missing prerequisite** — `tests/kiosk-config-groups/multi-location.spec.ts:beforeAll` throws when the DB has no `regions` row. The plan called this out as a deliberate choice ("missing seed becomes a CI signal, not a green-but-empty test").
- **`extractStatusLabel` shape support** — handles three known shapes: `{ text: "..." }` (plain text path), `{ value: '{"label":{"text":"..."}}' }` (typed-fragment path with object label), and `{ value: '{"label":"..."}' }` (legacy bare-string label). The fourth case (`null`/empty) returns `null` cleanly so callers can `??` to a default.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `regions` SELECT * fails on dev DB schema drift**
- **Found during:** Task 2 (initial spec run)
- **Issue:** `db.select().from(regions).limit(1)` issued `SELECT id, name, code, azure_code, market_id, ...` because Drizzle pulls every schema column. The local dev DB had not migrated `azure_code` (added in a later migration), so the test failed in `beforeAll` with `column "azure_code" does not exist` rather than the intended "no regions row" check.
- **Fix:** Narrowed the SELECT to `{ id: regions.id }` so the test prerequisite check runs against only the column it actually needs. This makes the spec resilient to dev-DB schema drift on columns we don't care about.
- **Files modified:** `tests/kiosk-config-groups/multi-location.spec.ts`
- **Verification:** Spec progresses past the `beforeAll` SELECT on a drifted dev DB. Now it correctly aborts with the "test prerequisite: at least one row in regions is required" message when `regions` is empty (dev state).
- **Committed in:** `8298333` (Task 2 commit)

**2. [Rule 1 — Bug] `afterAll` timeout when `beforeAll` throws**
- **Found during:** Task 2 (after spec run with no regions row)
- **Issue:** When `beforeAll` aborted, the four IDs in the closure (`groupId`, `location1Id`, `location2Id`, `productId`) stayed `undefined`. The `afterAll` hook then tried `db.delete(...).where(eq(..., undefined))`, which Drizzle interprets as a query without a WHERE clause — it then hung (or in this case, hit the 30s hook timeout). The cumulative effect was that a single missing prerequisite produced two failures (the prereq + the afterAll timeout) instead of one.
- **Fix:** Guarded each delete behind `if (id) { ... }` and changed the let-declarations from `string` to `string | undefined`.
- **Files modified:** `tests/kiosk-config-groups/multi-location.spec.ts`
- **Verification:** Re-ran the spec against the regions-less dev DB; it now fails cleanly with one error (the prereq throw) and the afterAll completes immediately. Typecheck still clean.
- **Committed in:** `8298333` (Task 2 commit, same commit as fix #1)

---

**Total deviations:** 2 auto-fixed (1 blocking — dev-DB schema robustness; 1 bug — afterAll cleanup safety)
**Impact on plan:** Both fixes are necessary for the spec to behave as the plan intended (loud, single-error abort on missing prerequisites). No scope creep. The spec's intent — catch the `ANY(${ids})` regression when the seed shape is in place — is unchanged.

## Issues Encountered

- **Manual revert verification not performed in this run.** The plan + 06-VALIDATION.md call out a one-time manual exercise: `git revert --no-commit fbcce77 && npx playwright test tests/kiosk-config-groups/multi-location.spec.ts` to confirm the spec actually catches PR #29's bug, then `git revert --abort`. This was deferred for two reasons:
  1. The local dev DB has zero `regions` rows, so the spec aborts in `beforeAll` before it can hit either the buggy or fixed code paths. The test prerequisite check fires first.
  2. Reverting `fbcce77` mid-execution on the phase branch (we are not on a separate worktree) risks polluting the branch state if the revert/abort cycle is interrupted.

  The verification is logged in 06-VALIDATION.md row "Regression catches PR #29 bug | manual verification" and is intentionally deferred to operator UAT (post-PR, against a seeded preview DB). The structural argument that the spec catches the regression is straightforward and reviewable from the spec source: the seed creates exactly `ids.length === 2`, and pre-`fbcce77` `listConfigGroups` would generate `ANY(($1, $2))` which Postgres rejects with 42809. The `expect(response?.status()).toBeLessThan(400)` assertion catches that exact failure mode.

## Verification Results

- `npx vitest run --project unit src/lib/__tests__/monday-client.test.ts` — **14 passed** (was 14 todo)
- `npx vitest run --project unit` — **523 passed** (baseline 509 + 14 new = 523, no regressions)
- `npx playwright test tests/kiosk-config-groups/multi-location.spec.ts --list` — **2 tests in 1 file** (lists clean)
- `npx tsc --noEmit -p tsconfig.json` — **clean** (no errors)

Acceptance criteria (all met):

| Criterion | Expected | Actual |
|---|---|---|
| `src/lib/monday/client.ts` exists | yes | yes |
| `grep -c '^export' src/lib/monday/client.ts` | ≥ 5 | **7** |
| `grep -c 'it\.todo' src/lib/__tests__/monday-client.test.ts` | 0 | **0** |
| `it(...)` count in monday-client.test.ts | ≥ 14 | **14** |
| 14 unit tests pass | yes | **yes** |
| `grep -c 'fetch("https://api.monday.com/v2"' src/lib/monday/import-location-products.ts` | 0 | **0** |
| `grep -c 'from "@/lib/monday/client"' src/lib/monday/import-location-products.ts` | ≥ 1 | **1** |
| `multi-location.spec.ts` exists | yes | yes |
| `grep -c "test(" multi-location.spec.ts` | 2 | **2** |
| FIXTURE references | ≥ 2 | **3** |
| `kioskConfigGroupId: groupId` count | ≥ 2 | **2** |
| Cross-ref in `list.spec.ts` | ≥ 1 | **3** |
| `grep -c "Phase 6 plan 06-02" tasks/todo.md` | ≥ 1 | **1** |

## Next Phase Readiness

- **Phase 06-02 is code-complete and ready to bundle into PR 2** (per CONTEXT.md D-19, alongside plans 06-03 KPI-tooltip-sweep and 06-04 Phase-7-11-deferral-note).
- **Operator manual verification owed (one-off):** post-PR, against a seeded preview DB, run `git revert --no-commit fbcce77` from the merge commit and re-run `npx playwright test tests/kiosk-config-groups/multi-location.spec.ts`. The list-page test must FAIL. Then `git revert --abort`. Record outcome in PR description.
- **No blockers** for plans 06-03..06-07.

## Self-Check: PASSED

- FOUND: src/lib/monday/client.ts
- FOUND: src/lib/__tests__/monday-client.test.ts (modified — 14 real tests)
- FOUND: src/lib/monday/import-location-products.ts (modified — uses @/lib/monday/client)
- FOUND: tests/kiosk-config-groups/multi-location.spec.ts
- FOUND: tests/kiosk-config-groups/list.spec.ts (modified — cross-ref comment added)
- FOUND: tasks/todo.md (modified — Phase 6 plan 06-02 line added)
- FOUND commit: 07b3ac9 (Task 1 — feat)
- FOUND commit: 8298333 (Task 2 — test)
- FOUND commit: cb6cd94 (Task 3 — docs)

---
*Phase: 06-post-audit-operational-follow-ups-consolidated-v1-0-backlog*
*Plan: 06-02-test-infrastructure*
*Completed: 2026-04-28*
