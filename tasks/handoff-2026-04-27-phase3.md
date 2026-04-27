# Session Handoff — wkg-kiosk-tool Analytics Audit Fix Plan, Phase 3+

**Date**: 2026-04-27
**Branch**: `gsd/audit-quick-wins` (off `main` at `c2a5cfe`)
**Working tree**: clean
**HEAD**: `40791d7` (36 commits past `main`)
**Phase progress**: Phases 1 + 2 complete (22 of 22 tasks). **Phase 3 is next** (10 tasks across ~6 PRs).

> New session: start by reading **this file**, then `tasks/todo.md` (Resolved Decisions section + Phase 3 task list) and the prior handoff at `tasks/handoff-2026-04-26-phase1-pr6.md` for the deep history. Then execute PR-15 per the spec at the bottom of this doc.

---

## What this work is

A deep audit of the wkg-kiosk-tool analytics system was completed 2026-04-25 → 2026-04-26 across 12 dashboards plus a live UAT against production. It found ~70 issues across systemic patterns, math correctness, filter wiring, dashboard-specific bugs, and kiosk-management UI gaps. A structured 8-phase fix plan was created.

**Phases 1 + 2 are done as of 2026-04-27** — all 9 systemic root causes (Phase 1) and all 13 math-correctness bugs (Phase 2). Phase 3 is "filter wiring + scoping" — 10 tasks. Phases 4–8 are smaller, more independent units (per-dashboard surface bugs, data restoration, UX polish, kiosk management, process hardening).

**Authoritative artefacts:**
- `tasks/analytics-audit/ANALYTICS-LOGIC.md` — per-dashboard metric definitions (1156 lines)
- `tasks/analytics-audit/ANALYTICS-ISSUES.md` — prioritised P0/P1/P2/P3 findings (939 lines)
- `tasks/analytics-audit/KIOSK-MANAGEMENT-AUDIT.md` — UI gap analysis (770 lines)
- `tasks/analytics-audit/LIVE-UAT.md` — live UAT against production (298 lines)
- `tasks/analytics-audit/parts/01–07-*.md` — per-cluster raw audits
- `tasks/analytics-audit/multi-pos-merge-proposal.csv` — 22 clusters / 29 defunct rows / 7,531 sales rows for human review (Phase 5.5/5.6)
- `tasks/analytics-audit/multi-kiosk-locations.csv` — 51 active locations × 2 kiosks each for ops review

**Plan artefacts:**
- `tasks/todo.md` — 8-phase fix plan with status checkboxes per task + Resolved Decisions D1–D13
- `tasks/phase-1-pr-plan.md` — Phase 1's PR-level decomposition (historical reference; mostly superseded by handoffs now that Phase 1 is closed)

---

## Project context

| Field | Value |
|---|---|
| Repo | wkg-kiosk-tool (Next.js 16, React 19, Drizzle, Postgres, Better Auth) |
| Production URL | `https://wkg-command-centre.vercel.app/` (NOT `wkg-kiosk-tool.vercel.app` — that alias was removed 2026-04-26) |
| Prod admin | `vedant.kalbag@weknowgroup.com` / password `Admin123!` (rotated 2026-04-26 via `scripts/reset-admin-password.ts`) |
| Prod Neon project | `wkg-command-centre` (id `snowy-brook-77762738`), production branch `br-soft-block-abbitfyw` |
| Prod DATABASE_URL (read-only safe) | `postgresql://neondb_owner:npg_DpVZPe52KWLY@ep-blue-bonus-abey47wj-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require` |
| Neon dev DATABASE_URL | in `.env.neon-dev` (or via `scripts/migrate-neon-dev.ts`); host is `ep-calm-sea-abn2ooob-pooler` |
| Active dataset | January 2026 only (Feb–Apr empty). UK + ES + DE regions populated; AU exists but no sales. Commission/Experiments/Actions tables are empty. |

**User preferences** (project memory):
- Parallel subagents wherever possible (`superpowers:subagent-driven-development` + `andrej-karpathy-skills:karpathy-guidelines` are the working skills).
- Surgical changes only. No "while I'm here" refactors. No comments unless non-obvious.
- Use `playwright-cli` (CLI tool, NOT the library) with `--browser=chromium` for any browser work.
- Plan first, write to `tasks/todo.md`, commit with summary commits per logical chunk.
- GSD branching: phase branches (`gsd/<phase>-<slug>`).
- npm-ci-lockfile-sync is a real ongoing pain — see `CLAUDE.md` and `~/.claude/CLAUDE.md` before touching deps.

---

## What's landed on `gsd/audit-quick-wins` (36 commits past `main`)

### Phase 1 (PR-1 through PR-6) — systemic root causes, all 9 tasks complete

| PR | Tasks | Commits | Notes |
|---|---|---|---|
| Quick wins | 8.3 | `7c63745` | Fail Vercel Production build if `BETTER_AUTH_SECRET` unset |
| PR-1 | 1.6 + 1.7 | `a6ac782`, `eaca7d1`, `d37a929`, `fb99936`, `34d88b0` | Pivot schema-drift sweep + zero-scope safety + ETL `system` role |
| PR-2 | 1.1 | `81659f7` | `getActiveLocationIds` excludes archived locations |
| PR-3 | 1.2 (D2) | `a58320e`, `a839cb9`, `bf70915`, `a175515` | Reversal columns + ingest matching + helpers + backfill (migration 0027 on neon-dev only; backfill ran on dev showing 1701 full / 33 partial / 36 orphan) |
| PR-4 | 1.3 (D1+D10) | `38754d1`, `156bdb4`, `59992d1`, `c0647da` | `is_booking_fee` → `is_weknow_fee` + `buildSalesTxnCondition` + COUNT sweep (migration 0028 on neon-dev only; Transactions dropped 95k → 45k as predicted) |
| PR-5 | 1.4 + 1.8 | `34ac5de`, `a7c90c0` | 5-bucket maturity (D3) + Zod URL filter validation (OQ5) |
| PR-6 Part A | 1.5 D5 | `d2d0aa9` | Region 1-per-location: UNIQUE + bogus-UK cleanup (migration 0029 on neon-dev only; 18 rows cleaned) |
| PR-6 Part B | 1.5 D5 | `1387e31` | Location-group 1-per-location: UNIQUE + multi-LG cleanup via modal-region rule (migration 0030 on neon-dev only; 19 rows cleaned) |
| PR-6 Part C | 1.5 D5 | `7623642` | 34 JV-encoded hotel_groups split into N:N + archived (migration 0031 adds `hotel_groups.archived_at`; 21 standalones auto-created on neon-dev) |
| PR-6 Part D | 1.5 D5 | `ef58378` | Monday-import: drop UK fallback in `BOARD_REGION`; skip + log placeholders without region |
| PR-6 Part E | 1.5 D5 | `1f31a3f` | Hotel-group queries use `EXISTS` (not `INNER JOIN ... IN ...`) to avoid multi-group fan-out |
| PR-6 Part F | 1.9 | `93a98d0` | `outlet_exclusions.region_id` NOT NULL (migration 0032 on neon-dev only; admin UI gets region picker) |
| Bookkeeping | — | `4c45bf2` | Mark Phase 1 tasks 1.1–1.9 complete in `tasks/todo.md` |

### Phase 2 (PR-7 through PR-14) — math correctness, all 13 tasks complete

| PR | Tasks | Commit | Notes |
|---|---|---|---|
| PR-7 | 2.1 + 2.2 | `84f76c8` | `num_rooms` aggregation via scalar subquery (Heathrow no longer shows 1.79M rooms; helper `locationGroupRoomsSubquery` in shared.ts) |
| (inline) | 2.3 | `a02e2cb` | Install Cohorts `avgMonthlyRevenue` divides by months in window |
| PR-9 | 2.7 | `12ab1c8` | Trend Builder Avg Basket weighted bucketing — query returns numerator+denominator, merge accumulates per bucket and divides at output |
| PR-10 | 2.4 + 2.5 + 2.6 | `3daa002` | Pivot grand-totals AVG (Simpson's paradox via sum/count companions), column-pivot key alignment, comparison key-match |
| PR-11 | 2.8 + 2.9 | `2170e98` | Heat Map per-metric `PERCENT_RANK` + traffic light on composite score (default thresholds 33/66) |
| PR-12 | 2.11 + 2.13 | `3ca289b` | Performer-pattern region-distribution clamp + Untagged row; YoY Feb 29 → Feb 28 fallback |
| PR-13 | 2.10 | `aaa0735` | Maturity plateau detection uses same-cohort ramp curve + tunable `PLATEAU_THRESHOLD_PCT` constant |
| PR-14 | 2.12 (D6) | `cf5fd17` | Per-location IANA timezone for Hourly Distribution (migration 0033 on neon-dev only; admin display flag `analytics_display_timezone: local|utc`; pivot's `sale_hour` derived column also TZ-aware) |
| Bookkeeping | — | `40791d7` | Mark Phase 2 tasks 2.1–2.13 complete in `tasks/todo.md` |

**Test state** (HEAD `40791d7`):
- `npx tsc --noEmit` → clean
- `npx vitest run --project unit` → 402 passed + 14 todo + 1 skipped (was 359 at session start)
- `npx vitest run --project integration` → pre-existing failures in `tests/commission/processor.integration.test.ts` and `tests/etl/azure-etl-full.integration.test.ts` reproduce on `4c45bf2` (Phase 1 close) — flagged as unrelated, untouched

---

## Resolved decisions snapshot (full text in `tasks/todo.md`)

| # | Topic | Resolution headline | Status |
|---|---|---|---|
| D1 | Booking fee in COUNT(*) | Counts mode-invariant; SUMs mode-dependent. `buildSalesTxnCondition` filters fees + reversals from every count. | **Implemented PR-4** |
| D2 | Reversal handling | New columns `is_reversal`, `original_record_id`, `processed_at_location_id`, `is_partial_reversal`. Refunds matched by `(ref_no, opposite sign, equal magnitude)`; refund's `location_id` rewritten to original's. | **Implemented PR-3** |
| D3 | Maturity buckets | 5 buckets in months: `0-1`, `1-3`, `3-6`, `6-9`, `9+`. Reference date is `filters.dateTo`. Left-inclusive / right-exclusive. | **Implemented PR-5** |
| D4 | Maturity install-date backfill | Source = `locations.liveDate` (Monday). Per-kiosk granularity unrecoverable historically. 23 active outlets stay NULL. | **Phase 5 (5.2 outstanding)** |
| D5 | Membership dedupe | Region/location-group: 1-per-loc + UNIQUE. Hotel groups: keep N:N; split 34 JV rows; archive. Per-loc dedup at query layer for hotel groups via EXISTS. | **Implemented PR-6 Parts A–E** |
| D6 | Hourly TZ | New `locations.iana_timezone` (NOT NULL DEFAULT 'UTC'). Region-default backfill. Editable on detail form. Admin setting `analytics_display_timezone: local | utc`. | **Implemented PR-14** |
| D7 | Heat Map normalisation | Postgres `PERCENT_RANK()` per metric (optimistic ties). Composite over global-filter-bar population. | **Implemented PR-11** |
| D8 | Multi-POS sites | Locations = sites; kiosks = POS units. 18+ sites split across multiple location rows. CSV proposal in `tasks/analytics-audit/multi-pos-merge-proposal.csv`. | **Phase 5 (5.5/5.6 outstanding)** |
| D9 | Internal-account exclusion | Add `'internal'` to `locations.locationType`. Tag `BK` (Customer Service). Default-exclude with opt-in toggle. | **Phase 4 (4.6 outstanding)** |
| D10 | Fee column rename | `is_booking_fee` → `is_weknow_fee`. Parser sets TRUE for 9991 + 9992. | **Implemented PR-4** |
| D11 | freeTrialEndDate | Analytics handling parked. Trial-ending-soon notification on kiosk-management UI. | **Phase 7 (7.10 outstanding)** |
| D12 | Vercel alias | `wkg-kiosk-tool.vercel.app` removed. Canonical = `wkg-command-centre.vercel.app`. | **Done (operational)** |
| D13 | Kiosk config group UI | Picker on location detail. Drop dead `kiosks.kioskConfigGroupId`. Member-management view. | **Phase 7 (7.6a-d outstanding)** |

---

## What's left

### Phase 3 — Filter wiring + scoping (next session starts here)

10 tasks. Mix of P0 security/correctness and P1 UX consistency. PR breakdown at the bottom of this doc.

### Phase 4 — Per-dashboard surface bugs (~19 tasks)

Mix of P0 (1.4-related cascade fixes — `outlet-tiers.tsx`, `performance-table.tsx`), P1 (Category Performance grouping, Cash Handling Fee leak, BK internal-tag, hotels-in-group `quantity`/`kiosks` columns, Compare card dedupe, Trend Builder `metric=booking_fee`, Actions Dashboard UX, Flag→Action workflow, Event annotations, Region count divergence) and P2 (Outlet Tiers cell limit, Bottom-20 overlap, Trend rolling-avg combo, Trend granularity cliffs, Weather lat/lng deterministic ORDER BY).

Plus follow-ups surfaced during Phase 1 execution (already in todo.md):
- 4.20 — Compare dashboard's location entity-picker missing archived filter
- 4.21 — Experiments peer-matching missing archived filter
- 4.22 — D2 in-batch partial-refund matcher (closes 2% orphan gap)
- 4.23 — D2 reversal matcher cross-batch ORDER BY for determinism
- 4.24 — D2 reversal matcher cents-math for canonical equality

### Phase 5 — NEW-P0-B Maturity data restoration (~7 tasks)

P0 — investigation + backfill of historical install dates (per D4); D8 multi-POS site merge runbook (CSV is already authored — 5.5 done modulo human review).
P1 — safeguard against mass `assignedAt` mutation; address-data-quality fix (D5+D8 same-root-cause).

### Phase 6 — UX / cosmetic (8 tasks)

P1 — admin TZ display flag (now done in PR-14, can mark complete), lat/lng population for 392 locations.
P2/P3 — outlet-code region disambiguation, threshold magic numbers → settings, currency/date format consistency, KPI tooltips, threshold editor URL persistence.

### Phase 7 — Kiosk management gaps (~12 tasks)

P0 — `locationType` editable, `primaryRegionId`/`outletCode` editable on form, remove dropped `region` from `EDITABLE_LOCATION_FIELDS`.
P1 — `iana_timezone` picker (D6), multi-select hotel-group picker (D5 JV), additional fields (`status`, `internalPocId`, `customerCode`, `maintenanceFee`, `locationGroup`), kiosk archive cascade, trial-ending-soon notification (D11).
P2/P3 — config-group picker (D13 a–d), archived toggle, banking field-level audit, freeTrialEndDate analytics deferred.

### Phase 8 — Process / regression hardening (~6 tasks)

P0 — CI smoke test (would have caught Pivot 500); build-time `BETTER_AUTH_SECRET` guard (already done).
P1 — Metric-mode invariant test (would have caught Performer Pattern bug 3.10); Vercel alias cleanup (already done).
P2/P3 — KPI tooltip docs; admin password rotation flow doc.

### Pre-prod migration runbook (when ready to deploy)

Migrations applied to **neon-dev only** by phase:
- **Phase 1**: 0027 (reversal cols), 0028 (`is_weknow_fee` rename), 0029 (region UNIQUE + UK cleanup), 0030 (location-group UNIQUE + dedup), 0031 (`hotel_groups.archived_at`), 0032 (`outlet_exclusions.region_id` NOT NULL).
- **Phase 2**: 0033 (`locations.iana_timezone` + `app_settings('analytics_display_timezone')`).

Backfill scripts (run **after** the migration but **before** flipping prod traffic):
- `scripts/backfill-reversals.ts` (D2; idempotent)
- `scripts/cleanup-bogus-region-memberships.ts --apply` (PR-6 Part A; idempotent — 0029's inline cleanup handles a fresh DB but this is the audit-logged variant)
- `scripts/cleanup-multi-location-group-memberships.ts --apply` (PR-6 Part B; idempotent)
- `scripts/split-jv-hotel-groups.ts --apply` (PR-6 Part C; idempotent)

Pre-deployment verification queries (run against the prod Neon branch after apply):
1. `SELECT COUNT(*) FROM sales_records WHERE is_weknow_fee = true;` → ~47,661 (matches live-UAT count).
2. `SELECT location_id, COUNT(*) FROM location_region_memberships GROUP BY 1 HAVING COUNT(*) > 1;` → 0 rows.
3. `SELECT location_id, COUNT(*) FROM location_group_memberships GROUP BY 1 HAVING COUNT(*) > 1;` → 0 rows.
4. `SELECT COUNT(*) FROM hotel_groups WHERE name ~ '.+,.+' AND archived_at IS NULL;` → 0.
5. `SELECT region_id IS NOT NULL FROM outlet_exclusions LIMIT 5;` → all true.
6. `SELECT iana_timezone, COUNT(*) FROM locations WHERE archived_at IS NULL GROUP BY 1;` → distribution matches the region backfill.

---

## Critical context for the next session

### Skills to invoke at session start
1. `superpowers:subagent-driven-development` — executing implementation plans with subagents
2. `andrej-karpathy-skills:karpathy-guidelines` — surgical, simple, goal-driven
3. (If doing browser UAT) `playwright-cli` per user's strict preference (CLI not library, `--browser=chromium`)

### Probing prod (read-only)
```bash
DATABASE_URL='postgresql://neondb_owner:npg_DpVZPe52KWLY@ep-blue-bonus-abey47wj-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require' \
  npx tsx -e "
import { sql } from 'drizzle-orm';
import { db } from '/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/src/db';
async function main() {
  const r = await db.execute(sql\`SELECT 1 AS ok\`);
  console.log(r);
}
main().catch(e => { console.error(e); process.exit(1); });
"
```

The project's `@/db` reads `process.env.DATABASE_URL` directly and doesn't auto-load `.env.local`, so you can override safely. Templates in `scripts/probe-install-dates.ts`, `scripts/propose-multi-pos-merge.ts`, `scripts/list-multi-kiosk-locations.ts`, `scripts/list-users.ts`.

### Verification commands
```bash
npx tsc --noEmit                              # typecheck
npx vitest run --project unit                 # unit suite (402 tests at HEAD)
npx vitest run --project integration          # integration (Testcontainers Postgres)
git log --oneline c2a5cfe..HEAD               # commits since main
```

### Patterns established across Phase 1 + 2

- **One implementer subagent per task.** NEVER parallel implementer subagents (file conflicts).
- **Two-stage review per task** (per `superpowers:subagent-driven-development` skill): spec compliance first, code quality second. In practice on this project, the controller has been doing eyeball review of each implementer's diff + tests + verification output, dispatching a fixer only when something looks off.
- **Commit per logical sub-part.** PR-3 had 4 commits (one per Part); PR-6 had 6 commits (one per Part). For inline implementations, single commit is fine.
- **Apply migrations to neon-dev for verification; never to prod from a working branch.** Use `scripts/migrate-neon-dev.ts`.
- **For trivial tasks (under ~30 LoC), inline-implement after the user's signal — don't dispatch agents for tiny edits.** Tasks 2.3, 2.11, 2.13 were inlined; everything bigger went via subagent.
- **Drizzle SQL chunk inspection** is the project's preferred unit-test pattern for query files. See `src/lib/analytics/queries/__tests__/sales-txn-count-sweep.test.ts` for the canonical scaffold (mock `executeRows`, capture the SQL fragment via Drizzle's `toSQL()`, assert on the rendered SQL string).
- **Integration tests use Testcontainers Postgres** under `tests/db/` and `tests/analytics/`. They're slower but the right tool for behavioural assertions on multi-table joins.
- **Audit-log pattern for cleanup scripts**: direct INSERT into `audit_logs` (not `writeAuditLog`) because scripts use raw `pg.Pool`, not the Drizzle singleton. Mirror the column shape in `src/db/schema.ts:248`. Actor = `00000000-0000-0000-0000-000000000001` (ETL system user). See PR-6 Parts A/B/C for examples.
- **Cleanup scripts default to dry-run; require `--apply`** to commit + write audit log. Always idempotent — re-runs produce 0 changes.
- **Skip the `node_modules` regen on macOS** — use `npm ci` (not `npm install`) to avoid lockfile drift. See `CLAUDE.md` for the full Docker-based regen runbook if CI ever complains about `@emnapi/*`.

### Things that might trip up a new session

1. **HEAD detachment risk** observed during PR-6: an agent operating on a worktree-isolated branch detached HEAD; recovered with `git update-ref refs/heads/gsd/audit-quick-wins <sha> && git checkout gsd/audit-quick-wins`. Watch for "disappearing" commits — they're likely in detached HEAD.
2. **`tsx` is a transitive dep** (via `drizzle-kit` and `vitest`). All `scripts/*.ts` invocations rely on this. Don't drop those packages without adding `tsx` directly first.
3. **Sonner is the toast library**, mounted in `src/app/layout.tsx`. PR-5 wired URL-validation warning toasts through it. PR-14 didn't need a toast.
4. **`wkg-kiosk-tool.vercel.app` is removed**. Canonical URL is `wkg-command-centre.vercel.app`. Update any tool / doc that references the old alias.
5. **Admin password** was rotated to `Admin123!` against prod 2026-04-26. Use `scripts/reset-admin-password.ts` for further rotations.
6. **Pre-existing integration-test failures** in `tests/commission/processor.integration.test.ts` and `tests/etl/azure-etl-full.integration.test.ts` reproduce on `4c45bf2` (Phase 1 close) — they were already broken before PR-7 onward. **Don't try to fix them as part of Phase 3 work**; flag separately if the user wants them addressed.
7. **`tasks/todo.md` is mutated by implementer subagents** — they often tick off their own task. If your bookkeeping commit conflicts with their edit, just pull and re-apply (their version is usually correct).
8. **Migration 0033 created an `app_settings` row** — the table itself was added back in migration 0014 (already used by Performance Thresholds). The `analytics_display_timezone` key default is `'local'`.
9. **The post-PR-6 region/group/JV data is now 1:N + EXISTS-safe**. Many query files were rewritten to assume this. If you encounter an analytics file that still uses an `INNER JOIN ... membership_table ... IN (idList)` pattern with fan-out concerns, it was missed by Part E — flag and fix as part of the relevant Phase 3 PR.

---

## Phase 3 PR plan — what to do next

10 tasks decomposed into 6 PRs. The rationale: P0 security/correctness fixes ship alone (so they can be cherry-picked to a hotfix branch if needed); the filter-bar refactor (3.1+3.2+3.3) is a single coherent UX change; smaller pairs are bundled by file proximity.

### PR-15 — Commission scoping (Task 3.4) — **P0, ship first**

**Bug**: `src/app/(app)/analytics/commission/actions.ts:70-82` `buildCommissionWhere` doesn't apply `scopedSalesCondition`. An external-region user can see another region's commission numbers — **data leak**.

**Fix**:
- Mirror the pattern from `src/lib/analytics/queries/portfolio.ts` `buildPortfolioWhere`: `await scopedSalesCondition(dbAny, userCtx)` and combine via `combineConditions`.
- Audit other entry points in `src/app/(app)/analytics/commission/` for the same omission.
- Add a unit test: `buildCommissionWhere({ userType: 'external', scopes: [region_uk] }, ...)` produces SQL containing `region_id = ANY($1::uuid[])` (or whatever shape `scopedSalesCondition` emits).

**Acceptance**: `grep` confirms `scopedSalesCondition` is called in every commission query; new test passes; `npx vitest run --project unit` clean.

**Estimated size**: S (under 100 LoC including tests).

**Branch suggestion**: stay on `gsd/audit-quick-wins`; commit `fix(commission): apply scopedSalesCondition to commission analytics (Task 3.4)`.

---

### PR-16 — Performer Pattern metricMode (Task 3.10) — **P0**

**Bug**: `src/lib/analytics/queries/high-performer-analysis.ts` (the same file PR-12 touched for region distribution) doesn't pass `metricMode` through to its SQL aggregates. Toggling Sales↔Revenue at the global filter doesn't change the displayed numbers — the dashboard is mode-blind.

**Fix**:
- Look at how `portfolio.ts` and `hotel-groups.ts` use `buildAmountModeCondition(filters)` as a `FILTER (WHERE ...)` arm on `SUM(net_amount)`.
- Apply the same pattern in every aggregate inside `getLocationRevenuesForRequest` and downstream computation.
- Make sure `salesTxn` (`buildSalesTxnCondition`) is also wired so transaction counts are mode-invariant per D1.
- Add a unit test using the existing capture-SQL pattern (`src/lib/analytics/queries/__tests__/sales-txn-count-sweep.test.ts` is the template) asserting that `revenue` SQL contains the mode-conditional FILTER.

**Acceptance**: SQL emits `FILTER (WHERE is_weknow_fee = ...)` per the resolved metric mode; new test passes; existing tests still pass.

**Estimated size**: S (under 100 LoC).

**Branch suggestion**: commit `fix(performer-patterns): pass metricMode through aggregates (Task 3.10)`.

---

### PR-17 — Experiments Temporal full filters (Task 3.5) — **P0**

**Bug**: `src/lib/analytics/queries/experiments.ts:262-265` Temporal Analysis query receives only `dateFrom`/`dateTo`, dropping the rest of `AnalyticsFilters` (region/hotel/maturity/location-group filters). The Experiments Temporal chart shows global numbers regardless of filter selection.

**Fix**:
- Change the function signature from `(dateFrom, dateTo, ...)` to `(filters: AnalyticsFilters, ...)`.
- Wire `buildDateCondition`, `buildDimensionFilters`, `buildMaturityCondition`, `scopedSalesCondition`, `buildActiveLocationCondition` — all the standard analytics helpers — through `combineConditions`.
- Update callers at the page-level (`src/app/(app)/analytics/experiments/...`) to pass full `filters`.
- Add a test that filtering to one region produces a smaller `whereClause` than the unfiltered case.

**Acceptance**: Temporal chart respects the global filter bar; new test passes.

**Estimated size**: M (100–200 LoC including caller updates and a test).

**Branch suggestion**: commit `fix(experiments): temporal analysis consumes full AnalyticsFilters (Task 3.5)`.

---

### PR-18 — Filter-bar wiring bundle (Tasks 3.1 + 3.2 + 3.3) — **mixed P0/P1**

**Bug**: Trend Builder, Pivot Table, and Compare each have their own filter store / hand-quoted SQL. The global `FilterBar` component isn't mounted on those routes. Users selecting "UK only" on Portfolio see the same UK-only data on Heat Map, but switching to Trend Builder shows global data — divergent UX, error-prone.

**Fix**:
- **3.1** — `src/app/(app)/analytics/trend-builder/page.tsx:39-46` and `trend-series.ts:96-138`: mount `<FilterBar />` (the component used on Portfolio); replace the local store with the global `useAnalyticsFilters()` hook. Keep the per-series filters (productIds, locationIds, etc.) — those are series-specific, not bar-level.
- **3.2** — `src/app/(app)/analytics/pivot-table/...`: same pattern. Pivot has a local `pivot-store.ts` that's been the source of much grief — see PR-1 schema-drift sweep that touched it. Mount the global FilterBar; route the bar's filters into `executePivot`'s WHERE clause.
- **3.3** — `src/lib/analytics/queries/comparison.ts:70`: replace `sql.raw` hand-quoted string interpolation with parameterised Drizzle `inArray` (matches the rest of the codebase). Also wire the global filter bar into Compare consistently.

**Acceptance**: The global filter bar visually appears + functionally filters Trend Builder, Pivot Table, and Compare. URL params persist filter state across route changes. `comparison.ts` no longer uses `sql.raw` for ID interpolation. New tests assert the bar's filters appear in the SQL of each dashboard.

**Estimated size**: L (300+ LoC across 5 files + tests).

**Branch suggestion**: commit per task (3.1, 3.2, 3.3) on a single PR; or three separate commits within one PR for atomic-revert safety.

---

### PR-19 — Cohort picker + delta normalisation (Tasks 3.6 + 3.7) — **P1**

Both touch the Experiments dashboard's cohort selection logic.

**3.6** — `listLocationsForPicker` (find via grep): currently returns every active location regardless of the user's scope, and doesn't respect `outlet_exclusions`. Apply both — wire `scopedSalesCondition` AND `getActiveLocationIds` into the picker query so external-region users only see their own region's locations.

**3.7** — Cohort vs Control delta: when `controlType='rest_of_portfolio'`, the delta is currently computed as raw `cohort_revenue - control_revenue`. This is comparing groups of different sizes — a 10-hotel cohort vs 200-hotel control delta is meaningless. Normalise per-location: `delta = (cohort_revenue / cohort_size) - (control_revenue / control_size)`.

**Acceptance**: Picker respects scope + exclusions (test it with an external-region user fixture). Delta is normalised per location (test with a 1-hotel cohort vs 99-hotel control showing the correct per-location delta).

**Estimated size**: M (100–200 LoC).

**Branch suggestion**: commit `fix(experiments): scope cohort picker + normalise control delta per-location (Tasks 3.6 + 3.7)`.

---

### PR-20 — Region Selector counts + listRegionOptions scoping (Tasks 3.8 + 3.9) — **P1**

Both touch region-related queries and surfaces.

**3.8** — `src/lib/analytics/queries/regions.ts:107-118` Region Selector counts (the second parallel query inside `getRegionsList`): doesn't apply `whereClause` to its sub-aggregate, so the badge count diverges from the detail-panel KPI under filters. Wire `whereClause` into Query 2.

**3.9** — `listRegionOptions` (find via grep): used by the location detail form's region picker. Currently any internal user can assign a location to any region. Apply user scope so external-region users can only see/assign their own region.

**Acceptance**: Region badge count matches detail KPI under filter; external user's region picker only shows their region.

**Estimated size**: M (100–200 LoC including tests).

**Branch suggestion**: commit `fix(regions): wire filters into selector counts + scope listRegionOptions (Tasks 3.8 + 3.9)`.

---

### Phase 3 acceptance gates (close-the-phase commit)

After all 6 PRs land:
1. Mark 3.1–3.10 complete in `tasks/todo.md` with PR/commit refs.
2. Run full unit + integration suites — should be 410+ unit tests passing.
3. Single bookkeeping commit `docs(audit): mark Phase 3 tasks 3.1–3.10 complete`.
4. Decide whether to merge `gsd/audit-quick-wins` to `main` at this point or continue through Phase 4.

---

## Recommended new-session opening line

> "Read `tasks/handoff-2026-04-27-phase3.md`, then continue with PR-15 per the spec at the bottom. Use `superpowers:subagent-driven-development` and `andrej-karpathy-skills:karpathy-guidelines`."

That should land the next session straight into productive work on the commission scoping data-leak fix.
