---
phase: 09-poc-underperformance-alerts
plan: 05
subsystem: admin-ui
tags: [admin, performance-alerts, inngest, rbac, server-action, playwright]
dependency_graph:
  requires: [09-03]
  provides: [admin-performance-alerts-page, triggerRunNow-action]
  affects: [audit_logs, inngest-event-bus]
tech_stack:
  added: []
  patterns: [next-rsc-admin-page, server-action-rbac, useTransition-toast, testcontainers-integration]
key_files:
  created:
    - src/app/(app)/admin/performance-alerts/page.tsx
    - src/app/(app)/admin/performance-alerts/run-now-button.tsx
    - src/app/(app)/admin/performance-alerts/actions.ts
    - tests/admin/performance-alerts.integration.test.ts
    - tests/admin/performance-alerts.spec.ts
  modified: []
decisions:
  - "Rate limit window stays at 5 minutes (server-side audit_logs check), not reduced despite 60s Inngest dedupe key — defence-in-depth at different layers"
  - "Stat card for 'Bottom tier' uses 'Emerging' tier label from kioskPerformanceAlertState; if tier names change in 09-03, update the lookup key"
  - "Playwright spec committed without running — per CLAUDE.md, specs must run against preview alias not just --list"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-09"
  tasks_completed: 3
  files_created: 5
  files_modified: 0
---

# Phase 09 Plan 05: Admin Performance Alerts Page Summary

**One-liner:** RSC admin page at `/admin/performance-alerts` with 6 stat cards, Run Now button (server action with 5-min rate limit + idempotency-keyed Inngest event), and full integration + Playwright test coverage.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Admin page + run-now button + server action | fa5622c | page.tsx, run-now-button.tsx, actions.ts |
| 2 | Integration tests — RBAC + audit + rate-limit | 95f8cdc | tests/admin/performance-alerts.integration.test.ts |
| 3 | Playwright E2E spec (awaiting operator UAT) | e038535 | tests/admin/performance-alerts.spec.ts |

## Checkpoint: Task 3 — Playwright UAT

**Status:** AWAITING operator verification against Vercel preview alias.

The spec at `tests/admin/performance-alerts.spec.ts` is committed and parses clean (`--list` passes). It must be run against the preview deploy per CLAUDE.md.

## What Was Built

### `src/app/(app)/admin/performance-alerts/page.tsx`
RSC page protected by `requireRole("admin")`. Renders:
- "Latest run" card: last_run_at (MAX from kioskPerformanceAlertState), classified count, bottom-tier count, emails sent (24h), skipped — no POC (24h), silenced kiosks
- `RunNowButton` client component
- "Recent runs" card: last 10 audit_logs entries with entityType='performance_alert_run'

### `src/app/(app)/admin/performance-alerts/actions.ts`
`triggerRunNow()` server action:
1. `requireRole("admin")` — throws Forbidden on mismatch
2. SELECT most recent audit_logs row with entityType='performance_alert_run'; if within 5 minutes, return `{ ok: false, error: "Rate limited", minutesRemaining }`
3. `inngest.send({ id: "performance-alerts-manual-{userId}-{minuteBucket}", name: "performance-alerts/run.requested", data: { actorId, actorName } })`
4. `writeAuditLog({ ..., entityType: "performance_alert_run", action: "trigger" })`
5. Return `{ ok: true }`

### `src/app/(app)/admin/performance-alerts/run-now-button.tsx`
Client component with `useTransition` + sonner toasts:
- Success: "Run queued — refresh in ~30 seconds"
- Rate limited: "Already queued — wait ~N more minutes"
- Error: `error.message`

### `tests/admin/performance-alerts.integration.test.ts`
4 Testcontainers-backed integration tests:
1. Throws Forbidden for non-admin (requireRole mock rejects)
2. Emits inngest event + writes audit row for admin (real DB, mock inngest)
3. Rate-limits second call within 5 minutes (seeded audit row at NOW())
4. Proceeds when most recent audit row is older than 5 minutes (seeded 10 min ago)

All 4 tests pass.

### `tests/admin/performance-alerts.spec.ts`
Playwright E2E spec (clones cache-purge.spec.ts pattern):
- Signs in as admin via `signInAsAdmin(page)`
- Navigates to `/admin/performance-alerts`
- Asserts "Performance alerts" heading visible
- Asserts "Run now" button visible and enabled
- Clicks button, asserts "Run queued" toast within 10s
- Reloads, asserts "Manual run trigger" entry appears in recent runs

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All stat fields read from real DB tables. Empty state ("—" / "0") is valid for a freshly deployed instance before the first cron run.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes beyond what the threat model already covers.

## Self-Check: PASSED

Files created:
- src/app/(app)/admin/performance-alerts/page.tsx — FOUND
- src/app/(app)/admin/performance-alerts/run-now-button.tsx — FOUND
- src/app/(app)/admin/performance-alerts/actions.ts — FOUND
- tests/admin/performance-alerts.integration.test.ts — FOUND
- tests/admin/performance-alerts.spec.ts — FOUND

Commits:
- fa5622c — FOUND
- 95f8cdc — FOUND
- e038535 — FOUND
