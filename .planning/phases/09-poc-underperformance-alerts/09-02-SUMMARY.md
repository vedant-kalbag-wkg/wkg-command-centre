---
phase: "09"
plan: "02"
subsystem: performance-alerts
tags: [pure-logic, tdd, alerts, iso-week, batching, idempotency]
dependency_graph:
  requires: []
  provides:
    - src/lib/performance-alerts/classify-dispatch.ts
    - src/lib/performance-alerts/iso-week.ts
    - src/lib/performance-alerts/poc-batching.ts
    - src/lib/performance-alerts/hash.ts
  affects: []
tech_stack:
  added: []
  patterns:
    - Pure functional TypeScript modules (no I/O, no side effects)
    - TDD Red-Green-Refactor per task
    - ISO-8601 week computation via Intl.DateTimeFormat Europe/London
    - SHA-256 idempotency keying via node:crypto
key_files:
  created:
    - src/lib/performance-alerts/classify-dispatch.ts
    - src/lib/performance-alerts/classify-dispatch.test.ts
    - src/lib/performance-alerts/iso-week.ts
    - src/lib/performance-alerts/iso-week.test.ts
    - src/lib/performance-alerts/poc-batching.ts
    - src/lib/performance-alerts/poc-batching.test.ts
    - src/lib/performance-alerts/hash.ts
  modified: []
decisions:
  - "BOTTOM_TIER sentinel is 'Emerging' (matches classifyOutletTier return values in metrics.ts)"
  - "isoWeekKey uses Intl.DateTimeFormat Europe/London to project to wall-clock date before ISO arithmetic — avoids DST drift"
  - "groupByPoc uses Map<string|null, T[]> to preserve insertion order and handle null POC sentinel in a single pass"
  - "sha256 uses node:crypto createHash — no third-party dependency"
  - "decideAlert accepts 'now: Date' as parameter — no Date.now() calls, fully deterministic"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-09"
  tasks_completed: 3
  files_created: 7
---

# Phase 09 Plan 02: Pure Logic Library Summary

Pure-functional core of the weekly POC underperformance alert cron: flip-in/chronic dispatch classifier, DST-aware ISO-8601 week key generator, per-POC email batcher, and SHA-256 idempotency key helper.

## Tasks Completed

| Task | Name | Commits | Tests |
|------|------|---------|-------|
| 1 | classify-dispatch (decideAlert) | 5e27821 (test), 874ee40 (feat) | 8 passing |
| 2 | iso-week (isoWeekKey) | 2a32cd7 (test), 0e28a3e (feat) | 8 passing |
| 3 | poc-batching + hash | 51b6f34 (test), 118ec0c (feat) | 9 passing |

**Total: 25 tests passing, 0 failing.**

## TDD Gate Compliance

All three tasks followed strict Red-Green-Refactor:

- RED commits: `test(09-02)` committed before any implementation, confirmed failing (`Cannot find module` for each)
- GREEN commits: `feat(09-02)` committed after all tests passed
- No REFACTOR phase needed — implementations were clean on first pass

Gate sequence validated via `git log`: test commit precedes feat commit for each task.

## Verification

```
npx vitest run --project unit src/lib/performance-alerts/
PASS (25) FAIL (0)

npx tsc --noEmit
TypeScript: No errors found
```

## Key Decisions

### D-10 dispatch logic (classify-dispatch.ts)

`CHRONIC_CAP_MS = 30 * 24 * 60 * 60 * 1000` — boundary is inclusive (`>=`), so exactly-30-days returns `"chronic"`. Prior being null with Emerging → `"flip-in"` (not chronic), because no history means the kiosk just entered the tier.

### ISO-8601 week in London time (iso-week.ts)

Uses `Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London" })` to extract the London calendar date (year/month/day), then runs the standard ISO Thursday-rule algorithm purely on UTC arithmetic. BST test case (midnight UTC = London Monday) passes correctly.

### null POC sentinel (poc-batching.ts)

`Map<string | null, T[]>` keys null naturally in JavaScript, so no special-casing needed. The cron job checks `pocUserId === null` to skip email dispatch while still creating a log row (D-07).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All modules are complete implementations with no placeholder values.

## Threat Flags

None. These are pure in-memory functions: no network endpoints, no auth paths, no file access, no DB schema changes.

## Self-Check: PASSED

Files created:
- src/lib/performance-alerts/classify-dispatch.ts — FOUND
- src/lib/performance-alerts/classify-dispatch.test.ts — FOUND
- src/lib/performance-alerts/iso-week.ts — FOUND
- src/lib/performance-alerts/iso-week.test.ts — FOUND
- src/lib/performance-alerts/poc-batching.ts — FOUND
- src/lib/performance-alerts/poc-batching.test.ts — FOUND
- src/lib/performance-alerts/hash.ts — FOUND

Commits:
- 5e27821 — FOUND (test classify-dispatch RED)
- 874ee40 — FOUND (feat classify-dispatch GREEN)
- 2a32cd7 — FOUND (test iso-week RED)
- 0e28a3e — FOUND (feat iso-week GREEN)
- 51b6f34 — FOUND (test poc-batching RED)
- 118ec0c — FOUND (feat poc-batching + hash GREEN)
