---
title: v2 data-reset decision — wipe-and-rebuild from Monday
date: 2026-04-29
context: Same-name location collapse policy (DM-V2-01) scoped via /gsd-explore conversation. Supersedes the "Fix path" section of tasks/v2-carryover-from-v1-phase-6.md § V2-DM-01.
---

# v2 Data Reset Decision

## TL;DR

The 19 same-name location groups currently on prod (e.g. 8 rows for "Residence Inn by Marriott Kensington") fragment analytics rollups and confuse ops attribution. Surgical pair-wise merging via `scripts/multi-pos-merge.ts` was the v1.0 path; for v2 we instead **wipe the Monday-sourced + sales-sourced + audit/temporal + test-rollout tables and rebuild from Monday + `seed_data/`**, with a first-class admin UI for ongoing location-merge cleanup.

## Driver

Analytics + ops attribution. Today, sales for "Residence Inn Kensington" fan into 8 separate `location_id`s, so:

- Group-by-location reports show 8 entries for one hotel
- YoY / cohort rollups join on `location_id` and break across the duplicates
- Ops staff can't tell which row to dispatch against

A forward-only rule (just enforce going forward, leave history alone) was rejected — the existing 19 groups already break analytics today. Retroactive cleanup is mandatory.

## Locked rules

1. **Monday is the source of truth** for hotel/location identity. Every active location must originate from a Monday hotel item (Live Estate / Ready to Launch / Removed / AU DCM boards), with outlet codes mirrored from the child board. The 4 hotel boards are canonical.
2. **No manual SQL for operator cleanup, ever.** Routine destructive ops (e.g. merging same-name location duplicates that Monday emits) must be a first-class admin UI feature, not a developer script. `scripts/multi-pos-merge.ts` becomes legacy after Plan C ships.
3. **`LOCATION_NEEDED` sentinel** — when sales ETL encounters an `Outlet Code` that isn't matched by any Monday-imported kiosk, create the kiosk and assign it to a single canonical `LOCATION_NEEDED` location. Operator workflow: visit `/locations/<location_needed>`, see N orphan kiosks, either add the real hotel to Monday + reassign, or create the location in-tool + reassign. Replaces the v1.0 "60 NO_MONDAY locations" exception bucket.
4. **Two-pass `assigned_at` seed rule.** During Monday import, `kiosk_assignments.assigned_at = location.live_date` (or NULL if Monday has no live_date). After full sales ETL, backfill any NULL `assigned_at` with `MIN(salesRecords.date)` per kiosk's outlet_code. Reuses `scripts/backfill-kiosk-install-dates.ts` (the Phase 5.2 script that already implements this fallback chain).

## What wipes vs survives

**Wiped** (scripted truncate):
- Monday-sourced: `locations`, `kiosks`, `products`, `providers`, `locationProducts`, `locationGroups*`, `regions*`, `hotelGroups*`, `markets`, `locationFlags`
- Sales-sourced: `salesRecords`, `salesImports`, `salesBlobIngestions`, `productCodeFallbacks`, `commissionLedger` (derived)
- Audit / temporal: `auditLogs`, `kioskAssignments` (re-seeded with two-pass rule above)
- Test rollout substrate (confirmed test-only): `installations`, `installationKiosks`, `installationMembers`, `milestones`, `businessEvents`, `eventLog`
- Cleanup / staging: `mergeProposals`, `importStagings`, `weatherCache`

**Preserved**:
- Auth: `user`, `account`, `session`, `verification`, `userScopes`
- App config: `appSettings` (thresholds, geocoding key ref), `pipelineStages` (customised), `eventCategories`
- User customisations: `userViews`, `analyticsSavedViews`, `analyticsPresets`, `duplicateDismissals`, `kioskConfigGroups`, `outletExclusions`, `experimentCohorts`, `actionItems`

## Sequencing constraint

Two-pass `assigned_at` backfill (rule 4) must run **after** the full sales ETL completes — the `MIN(salesRecords.date)` fallback needs the entire corpus loaded. Runbook ordering:

1. Pre-wipe snapshot (Neon point-in-time)
2. Truncate the wipe set
3. `runFullImport` (Monday)
4. Sales ETL from `seed_data/` with `LOCATION_NEEDED` fallback for unknown outlets
5. `scripts/backfill-kiosk-install-dates.ts --apply` (two-pass rule)
6. Geocoding batch via `/settings/geocoding`
7. Verification + operator UAT

## Sales corpus depth (forward-looking)

`seed_data/` is currently Jan-Mar 2026 only. Phase ships against this slice. When the user has 2024-to-date sales available, a follow-on backfill ingests it; daily additions thereafter use the existing Azure ETL flow (smoked in PR #26). Captured as forward-looking seed in `.planning/seeds/v2-sales-corpus-backfill.md`.

## Alternative considered: surgical pair-wise merge (rejected)

The v1.0-path equivalent: keep the data, extend `scripts/multi-pos-merge.ts` to N-way, run it 19 times. Rejected because:

- Each group needs metadata-conflict resolution (which row's `address`, `live_date`, `banking_details` survives?) — high-touch operator review per group
- Doesn't address the underlying data-model bug (Monday → DB import created the duplicates in the first place; needs fixing upstream)
- Doesn't deliver an ongoing operator path for new same-name items Monday will keep emitting
- Reusing the v1.0 script perpetuates "destructive cleanup = developer-only" rather than building the admin UI the operator actually needs

The wipe pays a one-time history-loss cost (audit_logs, kiosk_assignments temporal depth pre-prod-launch) for a clean, tool-supported ongoing model.

## Open question for Plan A pre-flight

Does Monday have 1 hotel item per same-name group, or N? Determines whether the post-wipe state is clean automatically, or requires post-wipe operator merging via Plan C. Probe: extend `scripts/probe-monday-vs-db-addresses.ts` to count Monday items per normalised hotel name across the 4 hotel boards.
