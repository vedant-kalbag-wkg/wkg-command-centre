---
phase: "09-poc-underperformance-alerts"
plan: "01"
subsystem: "database"
tags: [schema, migration, drizzle, postgresql, poc-alerts]
dependency_graph:
  requires: []
  provides:
    - "kiosk_performance_alert_state table (Drizzle + DDL)"
    - "kiosks.alert_silenced_at + kiosks.alert_silenced_reason columns"
    - "app_settings: underperformance_window_days=30"
    - "app_settings: pipeline_stage_id_live UUID (resolved from pipeline_stages WHERE position=7000)"
  affects:
    - "src/db/schema.ts"
    - "migrations/0043_phase_09_poc_alert_state.sql"
tech_stack:
  added: []
  patterns:
    - "Hand-authored idempotent SQL migration (IF NOT EXISTS / ON CONFLICT DO NOTHING / pg_constraint guard)"
    - "Pipeline UUID resolved at migration runtime — no hardcoded UUID"
key_files:
  created:
    - "migrations/0043_phase_09_poc_alert_state.sql"
  modified:
    - "src/db/schema.ts"
decisions:
  - "Used direct pg Client to apply 0043 (drizzle-kit push requires interactive TTY; same workaround used for 0041 and 0042)"
  - "Migration intentionally excluded from migrations/meta/_journal.json — hand-authored, idempotent, consistent with 0041+0042 precedent"
  - "pipeline_stage_id_live UUID resolved at migration runtime from pipeline_stages WHERE position=7000 (D-09)"
metrics:
  duration: "~25 min"
  completed: "2026-05-09"
  tasks_completed: 3
  tasks_total: 3
---

# Phase 9 Plan 01: Schema and Migration Summary

POC alert state table, kiosks silence columns, and app_settings seeds authored in Drizzle schema and applied to dev DB via hand-authored idempotent migration.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Extend schema.ts — kioskPerformanceAlertState table + kiosks silenced columns | `ca85adb` |
| 2 | Author migrations/0043_phase_09_poc_alert_state.sql (7 deltas, idempotent) | `6831505` |
| 3 | Apply migration to dev DATABASE_URL — all 7 deltas OK | (no separate commit — execution artifact) |

## Live DB Verification (Task 3)

All assertions confirmed against dev DATABASE_URL:

| Check | Result |
|-------|--------|
| `kiosk_performance_alert_state` table columns | kiosk_id:uuid, tier:text, classified_at:timestamptz, last_run_at:timestamptz, last_alerted_at:timestamptz |
| `kiosks.alert_silenced_at` column exists | CONFIRMED |
| `kiosks.alert_silenced_reason` column exists | CONFIRMED |
| `app_settings.underperformance_window_days` | 30 |
| `app_settings.pipeline_stage_id_live` | `1dfbcb39-4304-43fa-b964-ed92c495befc` (UUID of Live stage at position=7000) |
| CHECK constraint `kiosk_performance_alert_state_tier_check` | EXISTS |
| Index `kiosk_performance_alert_state_tier_idx` | EXISTS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] drizzle-kit push requires interactive TTY**

- **Found during:** Task 3
- **Issue:** `npx drizzle-kit push` and `npx drizzle-kit push --force` both fail with "Interactive prompts require a TTY terminal" in the non-TTY worktree execution context. The push command triggers `promptColumnsConflicts` for new columns on existing tables and has no non-interactive flag.
- **Fix:** Applied 0043 directly via a temporary Node.js script using the `pg` Client, splitting the migration file on `--> statement-breakpoint` markers and running each statement sequentially. This is the same approach used for 0041 and 0042 (hand-authored migrations in this codebase are applied this way).
- **Files modified:** None (execution-time workaround, no code change).
- **Impact:** Zero — migration file is idempotent; Vercel/Neon production deploys still apply it via the standard migration path.

## Known Stubs

None — no UI or data-flow stubs introduced. Schema and migration only.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. The only schema-level additions are:

- `kiosk_performance_alert_state`: internal cron-written table, no direct API exposure in this plan.
- `kiosks.alert_silenced_at / alert_silenced_reason`: NULL by default; admin write-path planned in 09-06.
- `app_settings` rows: read-only config; no trust boundary change.

Threat mitigations from plan threat model applied:

| Threat ID | Mitigation | Status |
|-----------|-----------|--------|
| T-09-01-01 | `CHECK (tier IN ('Premium','Standard','Developing','Emerging'))` at DB layer | Applied (Delta 1.1) |
| T-09-01-06 | pipeline_stage_id_live resolved at runtime from pipeline_stages (no hardcoded UUID) | Applied (Delta 4) |

## Self-Check: PASSED

- `migrations/0043_phase_09_poc_alert_state.sql` — exists at expected path
- `src/db/schema.ts` — contains `kioskPerformanceAlertState = pgTable`
- Commit `ca85adb` — confirmed in git log
- Commit `6831505` — confirmed in git log
- Live DB: all 5 verification checks passed
