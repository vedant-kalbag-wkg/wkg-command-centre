# Session Handoff — Post-merge of PR #27 (Analytics audit fix Phases 1-4)

**Date**: 2026-04-27 (continuation of same day — third session)
**State**: PR #27 merged to `main` at commit `c1e22a5`. Local `main` synced. Branch `gsd/audit-quick-wins` is now obsolete (kept locally as belt-and-braces).
**Test state at `c1e22a5`**: unit suite **464 passed | 14 todo | 1 skipped**, integration suite green on CI (`tests/etl/azure-etl-full.integration.test.ts` skipped via `describe.skipIf(!CSV_PRESENT)`).

> **The merged code references schema columns and CHECK constraints that DO NOT yet exist in the prod database.** Sections 1–3 below MUST run before/alongside the prod deployment or every analytics dashboard will 500 in production.

---

## 1. URGENT — Prod migration runbook

The merged code expects migrations `0027` through `0034`. Prod has only `0001`–`0026`.

### 1.1 Pre-flight check (read-only)

Confirm what's actually applied on prod:

```bash
DATABASE_URL='postgresql://neondb_owner:npg_DpVZPe52KWLY@ep-blue-bonus-abey47wj-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require' \
  npx tsx -e "
import { sql } from 'drizzle-orm';
import { db } from '/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/src/db';
async function main() {
  const r = await db.execute(sql\`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 10\`);
  console.log(r.rows ?? r);
}
main().catch(e => { console.error(e); process.exit(1); });
"
```

You should see migrations `0001`–`0026` recorded. If `0027` onward is already there, **stop** — someone else applied them; skip section 1.2 and go to 1.3 (backfills) only if not yet run.

### 1.2 Apply migrations 0027–0034

The project uses Drizzle's migrator. Pattern:

```bash
DATABASE_URL='<prod-url>' npx drizzle-kit migrate
```

Or via the script (`scripts/migrate-neon-dev.ts`) — but rename / point it at prod first; do NOT just run it as-is or it'll target neon-dev. Safer one-liner:

```bash
DATABASE_URL='postgresql://neondb_owner:npg_DpVZPe52KWLY@ep-blue-bonus-abey47wj-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require' \
  npx drizzle-kit migrate
```

This walks `migrations/meta/_journal.json` in order and applies anything not yet recorded. All 8 of 0027–0034 are idempotent at the DDL level (column add `IF NOT EXISTS`, constraint `DROP IF EXISTS` then `ADD`).

**Migration order + what they do:**

| # | File | What it does |
|---|---|---|
| 0027 | `sales_reversal_columns.sql` | Adds `is_reversal`, `original_record_id`, `is_partial_reversal`, `processed_at_location_id` to `sales_records`. |
| 0028 | `rename_is_booking_fee_to_is_weknow_fee.sql` | Column rename. **Source code expects `is_weknow_fee`; until this runs, every query 500s.** |
| 0029 | `region_membership_dedup.sql` | UNIQUE constraint on `location_region_memberships(location_id)`. Cleans up multi-region rows. |
| 0030 | `location_group_membership_dedup.sql` | UNIQUE constraint on `location_group_memberships(location_id)`. Same cleanup. |
| 0031 | `hotel_groups_archived_at.sql` | Adds `archived_at` to `hotel_groups`. |
| 0032 | `outlet_exclusions_region_id.sql` | NOT NULL `region_id` on `outlet_exclusions`. |
| 0033 | `locations_iana_timezone_and_admin_settings.sql` | `locations.iana_timezone TEXT NOT NULL DEFAULT 'UTC'` + `app_settings('analytics_display_timezone')` row. |
| 0034 | `locations_location_type_internal.sql` | CHECK rebuild on `locations.location_type` to accept `'internal'` + UPDATE the BK row. |

### 1.3 Backfill scripts (post-migrations, pre-traffic)

All four scripts are idempotent — re-runs produce 0 changes. Run in this order:

```bash
# Set prod DATABASE_URL once for the session
export DATABASE_URL='postgresql://neondb_owner:npg_DpVZPe52KWLY@ep-blue-bonus-abey47wj-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

npx tsx scripts/backfill-reversals.ts                                  # D2 — populates is_reversal + original_record_id
npx tsx scripts/cleanup-bogus-region-memberships.ts --apply            # D5 Part A
npx tsx scripts/cleanup-multi-location-group-memberships.ts --apply    # D5 Part B
npx tsx scripts/split-jv-hotel-groups.ts --apply                       # D5 Part C — splits 34 JV groups into N:N
```

Each script writes to `audit_logs` for traceability; default behavior is dry-run, `--apply` commits.

### 1.4 Verification queries

Run after migrations + backfills, confirm:

```sql
-- 1. Booking + Cash Handling fees folded under is_weknow_fee
SELECT COUNT(*) FROM sales_records WHERE is_weknow_fee = true;
-- expect ~47,661

-- 2. Region memberships are 1-per-location
SELECT location_id, COUNT(*) FROM location_region_memberships
GROUP BY 1 HAVING COUNT(*) > 1;
-- expect 0 rows

-- 3. Location-group memberships are 1-per-location
SELECT location_id, COUNT(*) FROM location_group_memberships
GROUP BY 1 HAVING COUNT(*) > 1;
-- expect 0 rows

-- 4. JV hotel groups split (no comma-encoded names left active)
SELECT COUNT(*) FROM hotel_groups WHERE name ~ '.+,.+' AND archived_at IS NULL;
-- expect 0

-- 5. Outlet exclusions are region-scoped
SELECT region_id IS NOT NULL FROM outlet_exclusions LIMIT 5;
-- expect all true

-- 6. IANA timezones backfilled
SELECT iana_timezone, COUNT(*) FROM locations WHERE archived_at IS NULL GROUP BY 1;
-- expect Europe/London (UK), Europe/Madrid (ES), Europe/Berlin (DE), Europe/Prague (CZ),
--        Europe/Dublin (IE), Australia/Sydney (AU); UTC remainder for unassigned

-- 7. D9 internal-account tagged
SELECT location_type, COUNT(*) FROM locations WHERE archived_at IS NULL GROUP BY 1;
-- expect 'internal' = 1 (the BK Customer Service row)
```

### 1.5 Vercel deployment gate

Vercel auto-deploys `main`. **If the deployment landed before the migrations did, prod is currently broken** — every analytics page will throw on the missing `is_weknow_fee` column. Fix order:

- If deployment is still in progress: pause it (Vercel dashboard) and apply migrations first.
- If deployment is done and prod is broken: apply the migrations now; the existing deployment will start working as soon as the columns appear.
- If you need to rollback before migrating: revert PR #27 in GitHub, redeploy.

---

## 2. Phase 4 deferred (3 items)

Captured in `tasks/todo.md` with `(deferred Phase 4 close)` markers. All P2/P3 — none are blocking.

- **4.3** Outlet Tiers cell `LIMIT 200` → "showing 200 of N" indicator. P2 — UI noise, not correctness.
- **4.9** Bottom 20 / Top 20 overlap when 21 ≤ N ≤ 39. P2 — rare edge case in `heat-map.ts:286-293`.
- **4.10** Cohort name uniqueness in Experiments. P3 — UNIQUE constraint + form validation.

Pick up alongside Phase 6 (UX polish) or fold into a "miscellaneous P2/P3 cleanup" PR later.

---

## 3. Phases 5–8 — what's left of the audit fix plan

Source: `tasks/todo.md` (now reflects all Phase 1-4 ticks).

### Phase 5 — Maturity data restoration (~7 tasks)

This is the most data-intensive remaining work. Gating P0: investigate the 2026-04 mass `kiosk_assignments.assignedAt` reseed that wiped every original install date.

- **5.1** Investigate why all 231 outlets have `kiosk_assignments.assignedAt` in 2026-04. Check `audit_logs` for a mass-update event; check git history for the assignment migration. **(P0 — blocks 5.2)**
- **5.2** Backfill historical install dates. Resolved decision **D4**: source = `locations.liveDate`. **(P0)**
- **5.3** Add a safeguard: unique constraint or audit hook that flags/blocks mass-mutation of `kiosk_assignments.assignedAt`. (P1)
- **5.4** Re-validate Maturity dashboard: install cohorts span multiple months; ramp curve shows real growth shape. **(P0 — verification gate)**
- **5.5** D8 multi-POS site merge: probe + propose CSV. **The proposal is already authored** at `tasks/analytics-audit/multi-pos-merge-proposal.csv` (22 clusters / 29 defunct rows / 7,531 sales rows). Awaits human review. (P1)
- **5.6** D8 — apply the merge: rewrite `sales_records.location_id`, `kiosk_assignments.location_id`, and every `location_*_memberships.location_id` from defunct rows to canonical; archive defunct rows; write audit-log entries. **Destructive — needs a clean rollback target before running** (i.e. PR #27's prod deployment must be stable + UATed first). (P1)
- **5.7** D8 + D5 address-data-quality fix: identify outlets whose `name` mismatches their `address` (e.g. Madrid hotel name on Heathrow address). Manual review CSV → corrections via Monday re-pull or hand-edit. (P1)

### Phase 6 — UX / cosmetic (8 tasks)

P2/P3 polish. **6.8 implicitly done** — admin TZ display flag landed in PR-14 alongside D6.

- **6.1** Outlet code region disambiguation across all tables (e.g. `UK / Q5`). (P2)
- **6.2** Threshold magic numbers (`±10%` plateau, `70/40` heat-map, `80/50/20` outlet tiers) → settings table. (P2)
- **6.3** Currency symbol consistency. (P3)
- **6.4** Date format consistency. (P3)
- **6.5** Tooltips on KPI cards explaining math (Avg Basket especially — multiple definitions across dashboards). (P2)
- **6.6** Threshold editor: persist to URL params + write audit log on change. (P2)
- **6.7** Lat/lng population: geocode `locations.address` for the ~392 active locations missing coordinates (Google Maps or OSM Nominatim). Unblocks geo-tz refinement (D6) and any future map view. (P2)
- **6.8** Admin setting `analytics_display_timezone: local | utc` (D6) — **done in PR-14**, just needs a tick in `tasks/todo.md`.

### Phase 7 — Kiosk management gaps (~12 tasks)

**Coordinate with PR-25**: D9's `'internal'` LocationType now exists in the schema CHECK + TS enum, but **the location-detail form (`src/components/locations/location-detail-form.tsx`) does not yet expose it**. Phase 7.1 will. Until then, admins cannot flip a row to `'internal'` via UI — only via direct SQL or another migration.

- **7.1** Add `locationType` editable field to location detail form (currently only on `/settings/outlet-types`). **P0 — analytics filter integrity. Blocks the D9 admin flow.**
- **7.2** Add `primaryRegionId`, `outletCode` to location detail form. (P0)
- **7.2a** Add `iana_timezone` editable picker on location detail form (D6 — admin override for the region-default backfill). (P1)
- **7.2b** Add multi-select hotel-group picker writing directly to `location_hotel_group_memberships` (D5 — JV support). (P1)
- **7.3** Remove `"region"` from `EDITABLE_LOCATION_FIELDS` (column dropped in 0022 — currently 500s if hit). (P0)
- **7.4** Add `status`, `internalPocId`, `customerCode`, `maintenanceFee`, `locationGroup` to location detail form (currently list-only — inconsistent). (P1)
- **7.5** Add `deploymentPhaseTags`, `freeTrialEndDate`, `notes` columns to kiosk list (currently detail-only). (P2)
- **7.6a** Add config-group picker to location detail form — editable by editor-level access, not just admin (D13). (P2)
- **7.6b** Add member-management view to `/settings/kiosk-config-groups/[id]` — list locations assigned to this group + bulk-assign / unassign (D13). (P2)
- **7.6c** Drop `kiosks.kioskConfigGroupId` column — schema migration + delete the 11 code references (D13). (P2)
- **7.6d** Verify `enrich-locations-from-monday.ts` actually populates `locations.kioskConfigGroupId` from Monday column `1466686598`; document override semantics for editor-level local changes vs Monday sync (D13). (P2)
- **7.7** Kiosk archive: cascade-close active `kioskAssignments` rows. (P1)
- **7.8** "Show archived" toggle in location list. (P2)
- **7.9** Banking edits: write field-level audit log entries (currently coarse). (P2)
- **7.10** Trial-ending-soon notification (D11) — surface on kiosk dashboard (or admin home) any locations/kiosks where `freeTrialEndDate` falls within next 30 days. (P1)
- **7.11** Analytics treatment of `freeTrialEndDate` deferred — pick up alongside maintenance-fee recurring-revenue work (P3, blocked on a future maintenance-fee design decision).

### Phase 8 — Process / regression hardening (~6 tasks)

**8.3 + 8.4 done**:
- **8.3** Build-time guard: fail Vercel build if `BETTER_AUTH_SECRET` unset on Production env. ✅
- **8.4** Per **D12**: removed `wkg-kiosk-tool.vercel.app` alias. ✅

Remaining:

- **8.1** CI smoke test: hit every analytics page, assert HTTP 200 + zero browser-console errors + ≥1 numeric KPI present. **Would have caught the Pivot Table 500.** (P0)
- **8.2** Metric-mode invariant test: toggling Sales↔Revenue must change ≥1 number on every dashboard. **Would have caught the Performer Pattern bug (NEW-P0-A).** (P1)
- **8.5** Document analytics metric definitions in-app (KPI tooltips). Reduces future "is this Avg Basket the same Avg Basket?" confusion. (P2)
- **8.6** Document the prod-admin password rotation flow in `CLAUDE.md`. (P3)

---

## 4. Informal follow-ups surfaced during the work (not yet ticketed)

These were spotted during Phase 1-4 but didn't fit any of the official task numbers. Assign them 4.20-4.x (or fold into Phase 6) when picked up:

- **`location-groups.ts` summary `total_kiosks` NULL** — at lines 108-130 (`getLocationGroupsList`) and 158-184 (`getLocationGroupDetail.summaryRows`). PR-24 fixed the per-row breakdown only; summary `total_kiosks` is still always NULL → `txnPerKiosk` always renders "—". Separate audit items at `tasks/analytics-audit/ANALYTICS-ISSUES.md:178, 467`. **Small follow-up PR (~30 LoC).**
- **Compare entity-picker missing archived filter** — `src/lib/analytics/queries/comparison.ts:228-232`. Surfaces archived locations.
- **Experiments peer-matching missing archived filter** — `findSimilarLocations` in `src/lib/analytics/queries/experiments.ts`. Same shape.
- **D2 in-batch partial-refund matcher** — closes the 2% orphan gap visible in `scripts/backfill-reversals.ts` output. Backfill ran without it; can re-run the matcher and update.
- **D2 reversal matcher cross-batch ORDER BY** — non-deterministic match across import batches. Same matcher.
- **D2 reversal matcher cents-math** — float comparisons need canonical equality (use `bigint` cents).
- **N+1 risk on Flag Review inline expansion** — single-row click is fine today; if we add "expand all" it becomes one. Out of scope.
- **`fetchAllFlags` cache key** — currently uses `JSON.stringify(canonicaliseFilterKey(...))` correctly. No issue, just remember the canonicaliser pattern when adding new cached filtered queries.

---

## 5. Open infrastructure issues

- **`claude-review` GitHub Action** failed on PR #27 with *"You've hit your org's monthly usage limit"*. The Anthropic API key configured in the workflow is at its monthly Claude usage cap. Either bump the org plan or rotate to a different key. Not blocking merges (it's an advisory check), but the auto-review feature is currently disabled.
- **`tests/etl/azure-etl-full.integration.test.ts`** fails locally only when the CSV fixture file is present. CI skips via `describe.skipIf(!CSV_PRESENT)`. Pre-existing; not regression. If anyone wants to run it locally with the CSV, the test needs to be aligned with the post-2026-04-24 NetSuite ETL output shape.

---

## 6. Memory updates worth making for next session

The auto-memory `project_next_steps.md` says "Maturity fix + Azure ETL both DONE (2026-04-25). Deferred: M12.3 index-100 view, M12.4 saved comparisons, portal revival (locked behind `archive/portal-lockdown-2026-04-25`)." That's now substantially out of date — the audit-fix work landed via PR #27.

Suggested replacement:

> Audit-fix Phases 1-4 merged via PR #27 (2026-04-27). Migrations 0027-0034 + backfills must be applied to prod. Phase 5 (Maturity data restoration) is next — gated on investigating the mass `kiosk_assignments.assignedAt` reseed of 2026-04. Phases 6-8 in the audit fix plan still TBD; details in `tasks/handoff-2026-04-27-post-merge.md`.

---

## 7. Recommended new-session opening line

> "Read `tasks/handoff-2026-04-27-post-merge.md`. PR #27 is merged. Section 1 (prod migrations + backfills + verification) is URGENT — check whether the prod migrations have been applied yet; if not, apply them. After prod is stable + UATed, pick up Phase 5.1 (investigate the 2026-04 mass `kiosk_assignments.assignedAt` reseed) — that's the gating P0 for the rest of the audit work. Use `superpowers:subagent-driven-development` and `andrej-karpathy-skills:karpathy-guidelines`."

---

## 8. Optional cleanup

- **Local branch `gsd/audit-quick-wins`** — origin's copy may have been auto-deleted by GitHub on merge. Check with `git branch -a | grep audit-quick-wins`. If origin's is gone but local persists, run `git branch -d gsd/audit-quick-wins` (safe — only deletes if merged). Don't `-D` (force) unless you've confirmed prod is healthy.
- **`tasks/HANDOFF.md`** — top-level handoff that may be the "current" doc per project convention. If so, replace its content with this file's content (or a pointer to this file). Otherwise leave alone — the dated handoffs in `tasks/` form a chain and shouldn't be churned.
