# Session Handoff — wkg-kiosk-tool Analytics Audit Fix Plan, Phase 4+

**Date**: 2026-04-27 (continuation of same day)
**Branch**: `gsd/audit-quick-wins` (off `main` at `c2a5cfe`)
**Working tree**: clean
**HEAD**: `f6de340` (46 commits past `main`; +10 this session past the prior handoff `c82f04c`)
**Phase progress**: Phases 1 + 2 + 3 complete (32 of 32 tasks). **Phase 4 is next** (19 tasks across ~10 PRs). Phases 5–8 follow.

> New session: start by reading **this file**, then `tasks/todo.md` (Phase 4 task list + Resolved Decisions D1–D13) and the prior handoffs at `tasks/handoff-2026-04-27-phase3.md` and `tasks/handoff-2026-04-26-phase1-pr6.md` for the deep history. Then execute PR-21 per the spec at the bottom of this doc.

---

## What this work is

A deep audit of the wkg-kiosk-tool analytics system was completed 2026-04-25 → 2026-04-26 across 12 dashboards plus a live UAT against production. It found ~70 issues across systemic patterns, math correctness, filter wiring, dashboard-specific bugs, and kiosk-management UI gaps. A structured 8-phase fix plan was created.

**Phases 1 + 2 + 3 are done as of 2026-04-27** — all 9 systemic root causes (Phase 1), all 13 math-correctness bugs (Phase 2), and all 10 filter-wiring + scoping bugs (Phase 3). Phase 4 is "per-dashboard surface bugs" — 19 tasks. Phases 5–8 are smaller, more independent units (data restoration, UX polish, kiosk management, process hardening).

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
- `tasks/phase-1-pr-plan.md` — Phase 1's PR-level decomposition (historical reference)

---

## Project context

| Field | Value |
|---|---|
| Repo | wkg-kiosk-tool (Next.js 16, React 19, Drizzle, Postgres, Better Auth) |
| Production URL | `https://wkg-command-centre.vercel.app/` (NOT `wkg-kiosk-tool.vercel.app` — alias removed 2026-04-26) |
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

## What landed in this session — Phase 3 (10 commits past the prior handoff)

| PR | Tasks | Commits | Notes |
|---|---|---|---|
| PR-15 | 3.4 | `bb37bb7`, `158086e` | Commission scoping data leak — `buildCommissionWhere` now applies `scopedSalesCondition`. The bare extraction commit moves the helper out of `"use server"` so it isn't registered as an RPC endpoint. |
| PR-16 | 3.10 | `0167f74` | Performer-pattern metricMode — `getLocationRevenuesForRequest`'s SUM FILTER swapped from hardcoded `buildNonFeeCondition()` to `buildAmountModeCondition(filters)`. Top-Products non-fee filter intentionally preserved. |
| PR-17 | 3.5 | `2b4e41f` | Experiments Temporal Analysis consumes full `AnalyticsFilters`. Three-layer ripple (query → server action → page useCallback). |
| PR-18a | 3.3 | `1138b75` | `comparison.ts` `sql.raw` → parameterised `inArray` per-sub-getter. |
| PR-18b | 3.2 | `6aa0979` | Drop the duplicate `usePivotFilterStore` slice; `usePivotFilters` now reads from the global `useAnalyticsFilterStore`. |
| PR-18c | 3.1 | `1933e6a` | Trend Builder threads `globalFilters: AnalyticsFilters` through `fetchTrendSeriesData`/`fetchTrendSeriesDataYoY` → `getTrendSeriesData`. Cache key bumped v1→v2. `metricMode` intentionally NOT wired (trend metrics are explicit). |
| PR-19 | 3.6 + 3.7 | `69e0c12` | Cohort picker scoping (new `scopedLocationsCondition` helper) + per-location delta normalisation (CohortComparison gains `cohortSize`/`controlSize`). |
| PR-20 | 3.8 + 3.9 | `9b2511c` | Region selector Query 2 wired to `whereClause` via DISTINCT subquery; `listRegionOptions` scoped via membership subquery. Lifted `getScopedActiveLocationIds` to `src/lib/scoping/scoped-active-locations.ts`. |
| Bookkeeping | — | `f6de340` | Mark Phase 3 tasks 3.1–3.10 complete in `tasks/todo.md`. |

**Architectural additions this session** (both live in `src/lib/scoping/`):
- `scopedLocationsCondition(db, ctx)` — sibling to `scopedSalesCondition`, emits `locations.id`-relative scope predicates. Throws on `product`/`provider` (don't apply to locations-only queries).
- `getScopedActiveLocationIds(ctx)` — React.cache-wrapped helper returning the user's scoped + active location IDs. Used by the cohort picker, cohort comparison rest-of-portfolio sizing, and `listRegionOptions`.

**Test state at HEAD `f6de340`:**
- `npx tsc --noEmit` → clean
- `npx vitest run --project unit` → **425 passed | 14 todo | 1 skipped** (was 402 at session start; **+23**)
- `npx vitest run --project integration` → 119 passed / 4 failed across the 2 pre-existing failing files (`tests/etl/azure-etl-full.integration.test.ts`, `tests/commission/processor.integration.test.ts`) — **same as the prior handoff baseline; no new regressions**.

---

## Resolved decisions snapshot (full text in `tasks/todo.md`)

| # | Topic | Resolution headline | Status |
|---|---|---|---|
| D1 | Booking fee in COUNT(*) | Counts mode-invariant; SUMs mode-dependent. | **Implemented PR-4** |
| D2 | Reversal handling | New columns `is_reversal`, `original_record_id`, `processed_at_location_id`. | **Implemented PR-3** |
| D3 | Maturity buckets | 5 buckets in months: `0-1`, `1-3`, `3-6`, `6-9`, `9+`. | **Implemented PR-5** |
| D4 | Maturity install-date backfill | Source = `locations.liveDate`. | **Phase 5 (5.2 outstanding)** |
| D5 | Membership dedupe | Region/location-group: 1-per-loc + UNIQUE. Hotel groups: N:N + JV split. | **Implemented PR-6 Parts A–E** |
| D6 | Hourly TZ | New `locations.iana_timezone`. Admin display flag. | **Implemented PR-14** |
| D7 | Heat Map normalisation | Postgres `PERCENT_RANK()` per metric. | **Implemented PR-11** |
| D8 | Multi-POS sites | Locations = sites; kiosks = POS. CSV proposal in `multi-pos-merge-proposal.csv`. | **Phase 5 (5.5/5.6 outstanding)** + **Phase 4 (4.7 first surface)** |
| D9 | Internal-account exclusion | Add `'internal'` to `locations.locationType` enum. | **Phase 4 (4.6 outstanding)** |
| D10 | Fee column rename | `is_booking_fee` → `is_weknow_fee`. | **Implemented PR-4** |
| D11 | freeTrialEndDate | Analytics deferred. Trial-ending-soon notification on UI. | **Phase 7 (7.10 outstanding)** |
| D12 | Vercel alias | Removed. Canonical = `wkg-command-centre.vercel.app`. | **Done (operational)** |
| D13 | Kiosk config group UI | Picker on location detail. Drop dead `kiosks.kioskConfigGroupId`. | **Phase 7 (7.6a-d outstanding)** |

---

## What's left

### Phase 4 — Per-dashboard surface bugs (19 tasks)

Mix of P0 (1.4-related cascade fixes — `outlet-tiers.tsx`, `performance-table.tsx`), P1 (Category Performance grouping, Cash Handling Fee leak in Performer Top Products, BK internal-tag, Heathrow T4 normalisation, hotels-in-group `quantity`/`kiosks` columns, Compare card dedupe, Trend Builder `metric=booking_fee`, Actions Dashboard UX, Flag→Action workflow, Event annotations, Region count divergence) and P2 (Outlet Tiers cell limit, Bottom-20 overlap, Trend rolling-avg combo, Trend granularity cliffs, Weather lat/lng deterministic ORDER BY).

PR breakdown at the bottom of this doc.

### Phase 5 — NEW-P0-B Maturity data restoration (~7 tasks)

P0 — investigation + backfill of historical install dates (per D4).
P1 — safeguard against mass `assignedAt` mutation; address-data-quality fix (D5+D8 same-root-cause).
The D8 multi-POS site merge runbook (5.5) is already authored — `tasks/analytics-audit/multi-pos-merge-proposal.csv` (22 clusters / 29 defunct rows / 7,531 sales rows). Awaits human review before 5.6 applies the merge.

### Phase 6 — UX / cosmetic (8 tasks)

- **6.8** is implicitly done (admin TZ display flag was implemented in PR-14 alongside D6) — needs a cleanup tick.
- 6.7 (lat/lng population for 392 locations) — moderate, requires geocoding API.
- The rest are P2/P3 polish: outlet-code region disambiguation, threshold magic numbers → settings, currency/date format consistency, KPI tooltips, threshold editor URL persistence.

### Phase 7 — Kiosk management gaps (~12 tasks)

P0 — `locationType` editable on form (7.1), `primaryRegionId`/`outletCode` editable (7.2), remove dropped `region` from `EDITABLE_LOCATION_FIELDS` (7.3 — currently 500s if hit).
P1 — `iana_timezone` picker (7.2a, D6), multi-select hotel-group picker (7.2b, D5 JV), additional fields (`status`, `internalPocId`, `customerCode`, `maintenanceFee`, `locationGroup`) (7.4), kiosk archive cascade (7.7), trial-ending-soon notification (7.10, D11).
P2/P3 — config-group picker (7.6a–d, D13), archived toggle (7.8), banking field-level audit (7.9), `freeTrialEndDate` analytics deferred (7.11).

### Phase 8 — Process / regression hardening (~6 tasks)

- **8.3** done (build-time `BETTER_AUTH_SECRET` guard).
- **8.4** done (Vercel alias cleanup).
- Remaining: P0 — CI smoke test (8.1, would have caught Pivot 500). P1 — Metric-mode invariant test (8.2, would have caught Performer Pattern bug 3.10). P2/P3 — KPI tooltip docs (8.5), admin password rotation flow doc (8.6).

### Informal follow-ups surfaced during Phase 1+3 execution

These don't yet have task numbers in `tasks/todo.md` but should be assigned 4.20-4.24 (or similar) when picked up:
- Compare dashboard's location entity-picker missing archived filter.
- Experiments peer-matching (`findSimilarLocations`) missing archived filter.
- D2 in-batch partial-refund matcher (closes the 2% orphan gap visible in `scripts/backfill-reversals.ts` output).
- D2 reversal matcher cross-batch ORDER BY for determinism.
- D2 reversal matcher cents-math for canonical equality.

### Pre-prod migration runbook (when ready to deploy)

Migrations applied to **neon-dev only** by phase:
- **Phase 1**: 0027 (reversal cols), 0028 (`is_weknow_fee` rename), 0029 (region UNIQUE + UK cleanup), 0030 (location-group UNIQUE + dedup), 0031 (`hotel_groups.archived_at`), 0032 (`outlet_exclusions.region_id` NOT NULL).
- **Phase 2**: 0033 (`locations.iana_timezone` + `app_settings('analytics_display_timezone')`).
- **Phase 3**: no schema migrations — every fix was code-only.

Backfill scripts (run **after** the migration but **before** flipping prod traffic):
- `scripts/backfill-reversals.ts` (D2; idempotent)
- `scripts/cleanup-bogus-region-memberships.ts --apply` (PR-6 Part A; idempotent)
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
npx vitest run --project unit                 # unit suite (425 tests at HEAD)
npx vitest run --project integration          # integration (Testcontainers Postgres; 2 known-failing files)
git log --oneline c2a5cfe..HEAD               # commits since main
```

### Patterns established across Phases 1 + 2 + 3

- **One implementer subagent per task.** NEVER parallel implementer subagents (file conflicts).
- **Two-stage review per task** (per `superpowers:subagent-driven-development`): spec compliance first, then code quality. Review can be combined per-PR for tightly-related sub-commits (PR-18 used this pattern — three commits, one combined spec review + one combined quality review).
- **Commit per logical sub-part.** PR-3 had 4 commits, PR-6 had 6 commits, PR-15 had 2, PR-18 had 3. For inline implementations, single commit is fine.
- **Apply migrations to neon-dev for verification; never to prod from a working branch.** Use `scripts/migrate-neon-dev.ts`.
- **For trivial tasks (under ~30 LoC), inline-implement after the user's signal — don't dispatch agents for tiny edits.** Tasks 2.3, 2.11, 2.13 were inlined; everything bigger went via subagent.
- **Drizzle SQL chunk inspection** is the project's preferred unit-test pattern for query files. The canonical scaffold is `src/lib/analytics/queries/__tests__/sales-txn-count-sweep.test.ts` (mock `executeRows`, capture the SQL fragment via Drizzle's `toSQL()`, assert on the rendered SQL string). For non-`executeRows` callers (e.g. Drizzle's `db.select(...).from(...).where(...)` chain), use the inline-thenable `db` mock pattern from `src/lib/analytics/queries/__tests__/experiments-temporal-filters.test.ts` or `src/app/(app)/locations/__tests__/list-region-options-scoping.test.ts`.
- **Integration tests use Testcontainers Postgres** under `tests/db/` and `tests/analytics/`. They're slower but the right tool for behavioural assertions on multi-table joins.
- **Audit-log pattern for cleanup scripts**: direct INSERT into `audit_logs` (not `writeAuditLog`) because scripts use raw `pg.Pool`, not the Drizzle singleton. Mirror the column shape in `src/db/schema.ts`. Actor = `00000000-0000-0000-0000-000000000001` (ETL system user).
- **Cleanup scripts default to dry-run; require `--apply`** to commit + write audit log. Always idempotent — re-runs produce 0 changes.
- **Skip the `node_modules` regen on macOS** — use `npm ci` (not `npm install`) to avoid lockfile drift. See `CLAUDE.md` for the full Docker-based regen runbook if CI ever complains about `@emnapi/*`.
- **`"use server"` files register every export as a server-action endpoint.** Internal helpers that return non-serializable objects (e.g. Drizzle `SQL` fragments) should live in a sibling non-server module — see `src/app/(app)/analytics/commission/where-builder.ts` for the canonical pattern (extracted in PR-15 follow-up commit `158086e`).
- **`unstable_cache` keys on call args.** When you add a new parameter to a cached function, bump the keyParts version (e.g. `'v1'` → `'v2'`) so existing TTL'd entries are invalidated. PR-18c did this on `getTrendSeriesDataCached`.
- **Scope helpers come in two flavours**: `scopedSalesCondition` for queries against `sales_records`, `scopedLocationsCondition` for queries against `locations`. Both wrap `buildScopeFilter` (pure helper) — the only difference is the SQL translator. Add a third sibling if you need scope predicates against another table (e.g. `regions`).

### Things that might trip up a new session

1. **HEAD detachment risk** observed during PR-6: an agent operating on a worktree-isolated branch detached HEAD; recovered with `git update-ref refs/heads/gsd/audit-quick-wins <sha> && git checkout gsd/audit-quick-wins`. Watch for "disappearing" commits — they're likely in detached HEAD.
2. **`tsx` is a transitive dep** (via `drizzle-kit` and `vitest`). All `scripts/*.ts` invocations rely on this. Don't drop those packages without adding `tsx` directly first.
3. **Sonner is the toast library**, mounted in `src/app/layout.tsx`. PR-5 wired URL-validation warning toasts through it.
4. **`wkg-kiosk-tool.vercel.app` is removed**. Canonical URL is `wkg-command-centre.vercel.app`.
5. **Admin password** was rotated to `Admin123!` against prod 2026-04-26.
6. **Pre-existing integration-test failures** in `tests/commission/processor.integration.test.ts` and `tests/etl/azure-etl-full.integration.test.ts` reproduce on `4c45bf2` (Phase 1 close) — they were already broken before PR-7 onward. **Don't try to fix them as part of Phase 4 work**; flag separately if the user wants them addressed.
7. **`tasks/todo.md` may be mutated by implementer subagents** — they sometimes tick off their own task. If your bookkeeping commit conflicts with their edit, just pull and re-apply (their version is usually correct).
8. **Migration 0033 created an `app_settings` row** — the table itself was added back in migration 0014. The `analytics_display_timezone` key default is `'local'`.
9. **Post-PR-6 region/group/JV data is now 1:N + EXISTS-safe**. Many query files were rewritten to assume this. If you encounter an analytics file that still uses an `INNER JOIN ... membership_table ... IN (idList)` pattern with fan-out concerns, it was missed by Part E — flag and fix.
10. **PR-15 tested + carried a "use server" extraction pattern**. If you find another `"use server"` file exporting a non-serializable internal helper, follow the same pattern — extract to a sibling non-server module rather than leaving it as a server-action endpoint that would fail at the wire.
11. **`getScopedActiveLocationIds`'s React.cache key is the `ctx` reference** (per PR-19/PR-20 reviewer note). Within a single request, repeated calls with the same `ctx` reference dedupe; if a future caller constructs a fresh ctx per call, the helper re-runs. Currently fine because all callers go via `getUserCtx()` (also React.cache'd).

---

## Phase 4 PR plan — what to do next

19 tasks decomposed into 10 PRs. Rationale: P0 mop-up (1.4 cascade fixes) ships first; small bugfixes bundled by file proximity; Actions Dashboard + D9 internal-account fix get their own PRs because they're substantively bigger. Several P2/P3 tasks bundled at the end.

### PR-21 — Outlet Tiers + Heat Map maturity dateTo (Tasks 4.4 + 4.5) — **P0 mop-up**

**Bug**: PR-5 (Phase 1 task 1.4) wired the 5-bucket maturity convention with `filters.dateTo` as the reference date — but two call sites still call `calculateMaturityBucket(date)` without it.

**Fix**:
- `src/lib/analytics/queries/outlet-tiers.tsx:91-93` — pass `filters.dateTo`.
- `src/components/analytics/performance-table.tsx:114-117` — pass `filters.dateTo` (the Heat Map maturity badge consumer).
- Confirm via grep there are no other `calculateMaturityBucket` call sites missing the arg: `grep -rn "calculateMaturityBucket(" src/`.

**Acceptance**: `grep -rn "calculateMaturityBucket(" src/` shows every call passes 2 args; existing maturity tests still pass.

**Estimated size**: S (under 30 LoC).

**Branch suggestion**: stay on `gsd/audit-quick-wins`; commit `fix(analytics): pass filters.dateTo to maturity bucket call sites (Tasks 4.4 + 4.5)`.

---

### PR-22 — Fee predicate cleanup (Tasks 4.2 + 4.13) — **P1**

Both tasks swap a hardcoded boolean fee predicate for the canonical helper.

**4.2** — `src/lib/analytics/queries/high-performer-analysis.ts:194` (the Top-Products tier query that PR-16 explicitly didn't touch). Currently uses `isBookingFee=false`. The Cash Handling Fee (NetSuite 9992) leaks into the rankings because `is_booking_fee` only excluded 9991. Replace with `buildNonFeeCondition()` (which post-D10 covers both 9991 + 9992 via the renamed `is_weknow_fee` column).

**4.13** — `src/lib/analytics/queries/trend-series.ts:85-91` `metricExpression(metric)` for `metric=booking_fee` currently emits `is_booking_fee=true`. Should emit `buildIsFeeCondition()` so 9992 is included alongside 9991.

Wait — read the file before changing. Per the PR-16 review, `metricExpression(metric)` already uses `buildIsFeeCondition()` for `booking_fee` (line 106 of trend-series.ts as of `f6de340`). Verify by reading; if already correct, mark 4.13 done in the PR description and only ship 4.2.

**Acceptance**: Performer Top Products rendered SQL contains `is_weknow_fee = false` (not the legacy `is_booking_fee`). Test extension to the existing `sales-txn-count-sweep.test.ts` style would catch a regression.

**Estimated size**: S (under 50 LoC including tests).

**Branch suggestion**: commit `fix(analytics): use canonical fee predicates in performer-pattern + trend (Tasks 4.2 + 4.13)`.

---

### PR-23 — Category Performance grouping (Task 4.1) — **P1**

**Bug**: The Category Performance widget groups by `products.name` (not `products.categoryName`) and includes fee rows. Two distinct bugs in the same file.

**Fix**:
- Find the query (likely in `src/lib/analytics/queries/portfolio.ts` or `category-performance.ts`).
- Group by `products.categoryName`.
- Add `buildNonFeeCondition()` to the WHERE.
- Keep `metricMode`-aware SUM via `buildAmountModeCondition(filters)` if the dashboard exposes the mode.

**Acceptance**: Rendered SQL groups by `category_name`; new test asserts non-fee filter is applied.

**Estimated size**: M (100–150 LoC).

**Branch suggestion**: commit `fix(category-performance): group by categoryName, exclude fees (Task 4.1)`.

---

### PR-24 — Hotels-in-Group / Hotels-in-Region table cleanup (Task 4.8) — **P1**

**Bug**: Both tables have a `quantity` column that equals `transactions` (redundant) and a `kiosks` column hardcoded to NULL. Visible to users in `hotel-groups.ts` + `location-groups.ts` consumer tables.

**Fix**:
- Drop the `quantity` field from the SQL projection + the type + the table.
- Compute real `kiosks` value: count of active `kiosk_assignments` per location, summed across the group's locations. Add as a scalar subquery or a sibling aggregate per row.
- Update the rendering component(s).

**Acceptance**: UI columns are `[Hotel] [Rooms] [Kiosks] [Transactions] [Revenue]` (no quantity); `kiosks` shows real counts.

**Estimated size**: M (100–200 LoC).

**Branch suggestion**: commit `fix(hotels-table): drop redundant quantity, populate kiosks count (Task 4.8)`.

---

### PR-25 — D9 Internal-account exclusion (Task 4.6) — **P1, schema change**

**Bug**: BK (Customer Service) and similar internal-account rows leak into leaderboards. Per D9, add `'internal'` to the `locations.locationType` enum and default-exclude analytics queries from this type, with an opt-in toggle on the global FilterBar.

**Fix**:
1. **Schema migration** `0034_add_internal_location_type.sql`: alter the enum to include `'internal'`. Apply to neon-dev only.
2. **Data migration**: tag the BK row (probe to confirm any others first).
3. **Query layer**: every analytics query's `WHERE` defaults to `locations.location_type != 'internal'`. Add a `buildInternalExclusionCondition()` helper in `shared.ts`. Wire into `buildPortfolioWhere` / `buildRegionWhere` / etc.
4. **FilterBar**: add a "Show internal accounts" toggle (default off) that suppresses the exclusion when on. Persist in `useAnalyticsFilterStore`. URL-param `internal=1` to share/bookmark.
5. **Tests**: assert the exclusion appears in rendered SQL when the toggle is off; absent when on.

**Acceptance**: BK no longer appears in any leaderboard by default; admin can toggle to see it for audit.

**Estimated size**: L (200–300 LoC + migration). **Coordinate with PR-31** (Phase 7's `locationType` editable field) — may make sense to bundle if you want to cut one larger UI PR.

**Branch suggestion**: commit `feat(analytics): exclude internal-type locations from leaderboards by default (Task 4.6, D9)`. **Migration 0034 applied to neon-dev only.**

---

### PR-26 — D8 Heathrow T4 normalisation (Task 4.7) — **P1**

**Bug**: Outlet `4T` "Heathrow Terminal 4 b" is the visible tip of the multi-POS-cluster iceberg (full audit at `tasks/analytics-audit/multi-pos-merge-proposal.csv`). Phase 4 takes the surface fix; Phase 5.5/5.6 takes the bulk merge.

**Fix options**:
- **(a) Display-only fix**: strip the trailing " b" from the rendered name. Cosmetic, doesn't touch data.
- **(b) Import-time normalisation**: make the Monday import collapse the " b" suffix or block it from creating a duplicate row in the first place.
- **(c) Defer to 5.6**: skip 4.7, address as part of the multi-POS bulk merge.

**Recommendation**: (a) for this PR (display-only fix in the table render component) + a `// TODO 5.6` comment pointing to the bulk merge for the underlying data fix. Avoids duplicate work with 5.6 while removing the user-visible anomaly.

**Acceptance**: Outlet `4T` renders as "Heathrow Terminal 4" everywhere; the `4T` row in `locations` is unchanged (5.6 handles the merge).

**Estimated size**: S (under 50 LoC if (a) only).

**Branch suggestion**: commit `fix(locations): strip trailing ' b' suffix from display name (Task 4.7, defer data merge to 5.6)`.

---

### PR-27 — Region selector vs detail divergence (Task 4.19) — **P1**

**Bug**: Region selector shows "UK: 79 hotels", but clicking through to the detail panel shows 63. Source: the selector and detail use different counting queries.

**Fix**:
- Locate the selector count source (likely `regions.ts:getRegionsList` Query 2 — but that was fixed for badge counts in PR-20; the divergence here may be a separate count entirely).
- Locate the detail panel count (likely `getRegionDetail` in same file).
- Unify: both should count `DISTINCT location_id` from the same base query (sales_records-derived after `whereClause` and active-locations filter).
- Test: assert both queries' SQL produces the same numeric count for a fixed fixture.

**Acceptance**: UK count matches between selector (post-PR-20) and detail; new test pinned.

**Estimated size**: M (100 LoC + test).

**Branch suggestion**: commit `fix(regions): unify hotel-count between selector and detail panel (Task 4.19)`.

---

### PR-28 — Compare hotel-group/region card dedup (Task 4.14) — **P1, mostly verification**

**Bug**: Compare cards may double-count locations that are in multiple selected hotel-groups (e.g. JV hotel-groups). Per the spec note, "covered by 1.5" — meaning Phase 1's PR-6 should have made this safe via the EXISTS / 1-per-loc pattern. This PR is a verification + regression test.

**Fix**:
- Construct a fixture where a location is in two hotel-groups, both selected.
- Assert the Compare card revenue/transactions reflect that location once, not twice.
- If the assertion fails, identify the leak and fix (likely an unmigrated INNER JOIN somewhere in `comparison.ts`).

**Acceptance**: New test pins the dedup invariant; no production code change if PR-6 covered it correctly. Mark 4.14 done either way.

**Estimated size**: S (test + maybe SQL touch).

**Branch suggestion**: commit `test(compare): pin shared-location dedup across hotel-group multi-selection (Task 4.14)`.

---

### PR-29 — Trend Builder polish bundle (Tasks 4.15 + 4.16 + 4.17 + 4.18) — **mixed P1/P2**

Four small Trend Builder tweaks shipped together because they all touch the same area:

- **4.17** — `src/lib/analytics/queries/trend-series.ts:189` `getBusinessEvents`: filter by event scope, not just category. Currently the events overlay shows all-region events even when the global filter scopes to one region. (P1)
- **4.18** — `src/app/(app)/analytics/trend-builder/actions.ts:59-73` `fetchWeatherForLocationGroup`: add a deterministic `ORDER BY` (e.g. `locations.id`) so the lat/lng pick is stable across runs. Currently picks "first row with both coords" non-deterministically. (P2)
- **4.15** — Trend Builder rolling-avg + weekly/monthly granularity combo: either disable the combo via UI gate or switch the rolling window to be granularity-aware (7d × weekly = 7-week window, etc.). User decision required — flag at the start of the implementer dispatch. (P2)
- **4.16** — Trend Builder auto-granularity: replace the hard 31/90-day cliffs (`granularity-selector.tsx`) with continuous logic. Currently a 30-day window jumps from daily to weekly at the boundary, producing cliff effects. (P2)

**Acceptance**: Each sub-fix has a regression test or manual verification note. 4.15 + 4.16 may need a brief design discussion before the implementer dispatch — present options in the PR opening message.

**Estimated size**: M (150–250 LoC across 3-4 commits).

**Branch suggestion**: commit per task; or one combined commit if all four are small.

---

### PR-30 — Actions Dashboard + Flag→Action workflow (Tasks 4.11 + 4.12) — **P1**

The two largest single-feature improvements in Phase 4. Bundled because both touch the Actions plumbing.

**4.11** — Actions Dashboard UX:
- Add an "overdue" indicator (red badge when due date < today and status != resolved).
- Add "Mine only" filter (filters by `assignee_id = currentUser.id`).
- Add location filter (multi-select).
- Sort by due-date as default.
- Display `resolvedAt` in the resolved view.

**4.12** — Flag → Action workflow: currently `createFlag` and `createActionItem` are XOR (`sourceId=NULL` for manual actions). Wire the flag-creation path to optionally create a corresponding action item — keep them linked via `sourceId`/`sourceType='flag'`.

**Acceptance**: Actions dashboard visibly reflects all five UX additions; creating a flag with the new option also creates an action item; the linked-action shows on the flag detail.

**Estimated size**: L (300+ LoC across 4-5 commits).

**Branch suggestion**: commit per logical sub-feature.

---

### Deferred from Phase 4

- **4.3** Outlet Tiers cell `LIMIT 200` → "showing 200 of N" indicator. (P2 — defer; UI noise, not correctness)
- **4.9** Bottom 20 / Top 20 overlap when 21 ≤ N ≤ 39. (P2 — defer; rare edge case)
- **4.10** Cohort name uniqueness in Experiments. (P3 — defer; UNIQUE constraint + form validation; not blocking)

---

### Phase 4 acceptance gates (close-the-phase commit)

After all 7 active PRs land (PR-21 through PR-30; deferred 4.3/4.9/4.10):
1. Mark 4.1, 4.2, 4.4–4.8, 4.11–4.19 complete in `tasks/todo.md` with PR/commit refs.
2. Mark 4.3, 4.9, 4.10 with `(deferred — see Phase 4 close handoff)` so future agents don't re-discover them.
3. Run full unit + integration suites — should be ~440+ unit tests passing.
4. Single bookkeeping commit `docs(audit): mark Phase 4 tasks complete + flag deferrals`.
5. Decide whether to merge `gsd/audit-quick-wins` to `main` at this point or continue through Phase 5.

---

## Recommended new-session opening line

> "Read `tasks/handoff-2026-04-27-phase4.md`, then continue with PR-21 per the spec at the bottom. Use `superpowers:subagent-driven-development` and `andrej-karpathy-skills:karpathy-guidelines`."

That should land the next session straight into productive work on the P0 maturity-cascade mop-up (Outlet Tiers + Heat Map dateTo wiring).
