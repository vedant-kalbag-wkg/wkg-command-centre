---
phase: "09"
plan: "04"
subsystem: "email"
tags: [email, react-email, inngest, poc-alerts, tdd]
dependency_graph:
  requires: [08-01-SUMMARY.md]
  provides: [poc-underperformance-email-template, inngest-poc-dispatch]
  affects: [src/inngest/functions/send-email.ts, src/inngest/events.ts]
tech_stack:
  added: []
  patterns: [react-email-table-layout, hand-crafted-plain-text, inngest-dispatch-table, tdd-red-green-refactor]
key_files:
  created:
    - src/emails/poc-underperformance.tsx
    - src/emails/__tests__/poc-underperformance.test.tsx
    - src/emails/__tests__/__snapshots__/poc-underperformance.test.tsx.snap
  modified:
    - src/emails/text-versions.ts
    - src/inngest/events.ts
    - src/inngest/functions/send-email.ts
    - vitest.config.ts
decisions:
  - Cast Component dispatch via (props: Record<string, unknown>) signature instead of Parameters<typeof Component>[0] to avoid TypeScript intersection narrowing on union of function types
  - pocUnderperformanceText receives portfolioUrl as a prop (not computed internally) to keep text version consistent with HTML version where portfolioUrl is computed from BRAND.prodUrl — caller controls the URL
  - Kiosk rows in plain-text use indented bullet format with detailUrl on a second line, matching the scannable table layout in the HTML version
metrics:
  duration: "~35 minutes"
  completed: "2026-05-09"
  tasks_completed: 3
  files_changed: 7
---

# Phase 09 Plan 04: POC Underperformance Email Template Summary

POC underperformance weekly digest email — `PocUnderperformanceEmail` react-email template, `pocUnderperformanceText` plain-text companion, and Inngest `send-email` dispatch wired for the `poc-underperformance` template key.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 (RED) | vitest config fix + 10 failing render tests | 980b298 |
| 1 (GREEN) | Implement PocUnderperformanceEmail component | 8b38ded |
| 2 | Add pocUnderperformanceText plain-text function | 29dd65c |
| 3 | Extend EmailKind/EmailTemplate unions + wire dispatch | 626f721 |
| — | Commit vitest snapshot baseline | 030e0f9 |

## What Was Built

### PocUnderperformanceEmail (src/emails/poc-underperformance.tsx)

Outlook-safe react-email template for the weekly POC underperformance digest:
- `KioskRow` interface: `{ kioskId, locationName, region, revenue: number|string, percentile: number|string, detailUrl }`
- `PocUnderperformanceEmailProps`: `{ pocName, kiosks: KioskRow[], moreCount, windowDays, runIsoWeek }`
- Table layout with `role="presentation"` thead/tbody (Outlook-safe)
- Location names linked to per-kiosk `detailUrl` in azure (`#00A6D3`)
- Conditional `moreCount` line below table when `> 0`
- CTA: `${BRAND.prodUrl}/analytics/portfolio`

### pocUnderperformanceText (src/emails/text-versions.ts)

Hand-crafted plain-text companion with:
- Kiosk lines: `  - LocationName (Region) | Revenue: X | pN\n    detailUrl`
- Conditional moreCount note
- Single CTA `portfolioUrl` at bottom (avoids [URL]Label Outlook duplication)

### Inngest dispatch extension (src/inngest/events.ts + send-email.ts)

BLOCKER-3 resolution:
- `EmailKind` union extended with `"underperforming_poc"`
- `EmailTemplate` union extended with `"poc-underperformance"`
- TEMPLATES dispatch table extended: `"poc-underperformance" → PocUnderperformanceEmail`
- Plain-text branch in `render-html` step handles `"poc-underperformance"` via `pocUnderperformanceText`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest config missing `.test.tsx` include patterns**
- **Found during:** Task 1 RED phase
- **Issue:** vitest unit project included `*.test.ts` globs only; JSX test files (`.test.tsx`) were silently excluded — the RED phase produced no test results at all instead of failing tests
- **Fix:** Added `"src/**/__tests__/**/*.test.tsx"` and `"src/**/*.test.tsx"` to the unit project include array
- **Files modified:** `vitest.config.ts`
- **Commit:** 980b298

**2. [Rule 1 - Bug] TypeScript TS2345 intersection narrowing on dispatch cast**
- **Found during:** Task 3 TypeScript compilation check
- **Issue:** `Component(templateProps as Parameters<typeof Component>[0])` — when `Component` is a union of two function types, TS resolves `Parameters<typeof Component>[0]` as the intersection of both prop types, making the cast target too narrow
- **Fix:** Cast `Component` itself to `(props: Record<string, unknown>) => React.ReactElement` — sidesteps the intersection without losing runtime correctness (dispatch table guarantees prop shape)
- **Files modified:** `src/inngest/functions/send-email.ts`
- **Commit:** 626f721

## TDD Gate Compliance

RED gate: `test(09-04)` commit `980b298` — 10 failing render tests (module-not-found error confirmed RED state)
GREEN gate: `feat(09-04)` commit `8b38ded` — all 10 tests pass

## Known Stubs

None — all template props flow through to rendered output. The `portfolioUrl` in the HTML template is computed from `BRAND.prodUrl` (not a stub); the cron caller will supply all kiosk row data.

## Threat Flags

None — no new network endpoints, auth paths, or trust-boundary schema changes. Template rendering and Inngest dispatch extension are internal to the existing `send-email` Inngest function.

## Self-Check: PASSED

- `src/emails/poc-underperformance.tsx` — EXISTS
- `src/emails/__tests__/poc-underperformance.test.tsx` — EXISTS
- `src/emails/__tests__/__snapshots__/poc-underperformance.test.tsx.snap` — EXISTS
- `src/emails/text-versions.ts` — MODIFIED (pocUnderperformanceText appended)
- `src/inngest/events.ts` — MODIFIED (EmailKind + EmailTemplate unions extended)
- `src/inngest/functions/send-email.ts` — MODIFIED (dispatch + plain-text branch)
- `vitest.config.ts` — MODIFIED (.test.tsx includes added)
- Commits 980b298, 8b38ded, 29dd65c, 626f721, 030e0f9 — all present
- TypeScript: 0 errors (`npx tsc --noEmit`)
- Unit tests: PASS 629 / FAIL 0
