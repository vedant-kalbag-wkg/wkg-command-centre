---
title: Backfill 2024-to-date sales corpus + verify Azure daily ETL takeover
trigger_condition: User has 2024-onwards sales corpus available (currently `seed_data/` covers Jan-Mar 2026 only)
planted_date: 2026-04-29
---

# Seed: Sales Corpus Backfill

The v2 data-reset phase ships against `seed_data/` (Jan/Feb/Mar 2026) — 3 months. When the full historical corpus arrives, this work activates.

## Trigger

User has 2024-onwards sales export ready (CSV format same as `seed_data/GB_WKG_NetS_*.csv`, or Azure-blob-equivalent). Current `seed_data/` is sufficient for v2 phase 1 ship; this is post-ship.

## Scope

1. **Backfill ingestion** — re-run sales ETL against the 2024-to-date corpus. Idempotency: re-running over already-loaded `Saleref` should be a no-op. Verify against `salesImports`/`salesBlobIngestions` ledgers.
2. **Re-trigger two-pass `assigned_at` backfill** — once corpus depth grows, the `MIN(salesRecords.date)` fallback may produce earlier dates for kiosks whose Monday `live_date` was NULL. Re-run `scripts/backfill-kiosk-install-dates.ts --apply` to refresh.
3. **Verify Azure daily ETL takeover** — Azure ETL was smoked in PR #26. Confirm the daily ingestion path is live, idempotent, and points at the correct prod blob source.
4. **Analytics depth verification** — maturity / trend / YoY-compare dashboards now have multi-year depth. Spot-check that Cohort and Compare views produce expected shapes.

## Notes

- Azure flow already exists per PR #26; this is a verification / activation step, not a build
- The v2 data-reset phase locked Monday as identity SoT; sales corpus expansion doesn't touch Monday
- If 2024-to-date arrives **before** the v2 data-reset phase ships, fold the backfill into Plan B's seed step (single ETL run against the full corpus instead of `seed_data/` only)
