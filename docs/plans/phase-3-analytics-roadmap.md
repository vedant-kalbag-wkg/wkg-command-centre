# Project Roadmap

**Last updated:** 2026-04-25
**Branch in flight:** `feat/admin-triggers-and-etl-smoke` (admin operations + ETL smoke)
**Most recent merged milestone:** Phase 3+4 admin operations + property-first analytics (PR #25 merged earlier 2026-04-25)

## Status by milestone

### M10 — Bug Fixes + Data Quality Foundations — DONE
- BUG-01 trend-builder date range — `src/app/(app)/analytics/trend-builder/page.tsx`
- BUG-02 pivot MoM/YoY — `src/app/(app)/analytics/pivot-table/`
- M10.2 markets hierarchy — `markets` table + `regions.marketId` FK + `useMarketGroups` in region selector
- M10.3 operating-group mapping — `locations.operating_group_id` FK
- M10.4 data-quality dashboard — `/settings/data-quality`

### M11 — Performance Flagging & Maturity — DONE
- M11.1 traffic-light thresholds — `/settings/thresholds` + `classifyTrafficLight` across heat-map + portfolio
- M11.2 location flagging — `location_flags` table + FlagBadge/FlagDialog wired into heat-map + portfolio + audit log
- M11.3 high-performer comparison — patterns card on portfolio (post-Phase-4 reshape)
- M11.4 kiosk maturity — filter + column in heat-map + portfolio + dedicated `/analytics/maturity`

### M12 — Experiment Measurement & Comparison — PARTIAL
- M12.1 YoY comparison — DONE on portfolio + trend builder
- M12.2 cohort experiment analysis — DONE; `/analytics/experiments` with intervention overlays
- **M12.3 seasonality controls — PARTIAL.** Rolling averages (raw / 7d / 30d) shipped on trend builder via `applyRollingAverage`. Missing: period-normalised / index-100 view that compares a window's performance to the same window in prior years. Deferred.
- **M12.4 saved comparison templates — NOT DONE.** `/analytics/compare` is ad-hoc only. Need a `saved_comparisons` table + named save/load UI. Deferred.

### M13 — Event System & Insight-to-Action — DONE
- M13.1 event system — `business_events` + categories seeded (Promotion / Holiday / Operational / Market) + EventAnnotations on trend builder + portfolio daily trends
- M13.2 insight-to-action — `action_items` table + flag-to-action conversion in FlagDialog
- M13.3 action dashboard — `/analytics/actions-dashboard` with filters + source-back-linking

### Phase 4 — Admin Operations & ETL — DONE (current branch)
Shipped on `feat/admin-triggers-and-etl-smoke` (9 commits — plus the lockdown commit):
- `/settings/outlet-types` — outlet-type classifier, Monday-placeholder review reason, region picker (single + bulk), show-classified toggle, conflict pre-flight on `(primary_region_id, outlet_code)` (`902eb4d`, `23fed29`)
- `/settings/data-import/monday` — admin-triggered Monday import (advisory-locked, audited) (`fd59015`, `1c9db46`)
- `/settings/data-import/azure` — read-only Azure ETL run history with KPIs + filters (`fafc943`)
- `/settings/audit-log` — read-only audit_logs viewer with filters + pagination (`6a57949`)
- `regions.AU` (Australia) added with `azure_code='AU'`; Australia DCM placeholders default to AU (`265efdd`)
- `scripts/seed-testdata-azure.ts` + `npm run seed:azure-testdata` — synthetic 4-day NetSuite CSVs in Azure `testdata` container, smoked end-to-end against a throwaway Neon branch (`cdf6936`)
- Sidebar wiring for Audit Log + Azure ETL Runs (`a720ee2`)
- Azure ETL Vercel cron — wired at `vercel.json` (`0 4 * * *` → `/api/etl/azure/run`)
- Drizzle migrator skip-by-max-timestamp bug — patched via `patch-package` (`patches/drizzle-orm+0.45.2.patch`, originally landed on `main` in `0f19cd6`)
- External portal locked down (`archive/portal-lockdown-2026-04-25` — see Deferred)

## Deferred / future work

| Item | Source | Note |
|---|---|---|
| **M12.3** Seasonality / period-normalised view | Roadmap | Rolling averages shipped; index-100 / YoY-overlay charts still missing |
| **M12.4** Saved comparison templates | Roadmap | Need `saved_comparisons` table + named save/load on `/analytics/compare` |
| **External portal** | `phase-2-external-portal.md` (deleted) | Half-built; locked down 2026-04-25 — `/portal/analytics/*` redirects to `/portal/coming-soon`. Revive with `git revert archive/portal-lockdown-2026-04-25` once external-user scoping is wired through every analytics surface. |
| **9 Australia kiosks → AU region** | Operator task | AU region now exists; their associated locations still on UK by default. Operator triage via `/settings/outlet-types?showClassified=1` + Region picker. No code work. |
| **Drizzle upstream PR** | `0f19cd6` follow-up | Local patch in `patches/`; upstream contribution still TBD |

## Operational notes

- **Vercel envs**: `AZURE_STORAGE_CONNECTION_STRING` + `MONDAY_API_TOKEN` on production. Preview has `DATABASE_URL` + `BETTER_AUTH_SECRET` scoped to the branch `feat/netsuite-etl-data-model` (now merged) — flip to "all preview branches" in Vercel UI before the next preview is needed.
- **Neon backup branches**: keep `pre-monday-placeholders-20260424T181301`, `pre-au-region-2026...`, `pre-monday-import-20260424T175609`, `pre-migration-0024-20260424T145839` until ~2026-05-01 then delete.
- **Azure containers**: `clientdata` (production NetSuite drops, currently empty until cron's first successful run), `testdata` (4 days × 13-row synthetic seed for smoke runs — persistent).

## Reading order for new contributors

1. `README.md` — project overview
2. `CLAUDE.md` — branch and dev conventions (npm lockfile gotcha is in here)
3. This file — current state + what's deferred
4. `docs/plans/2026-04-24-netsuite-etl-restructure-design.md` — Azure ETL design rationale
5. `docs/plans/2026-04-24-phase-3-outlet-types-phase-4-property-performers.md` — most recent merged feature work
