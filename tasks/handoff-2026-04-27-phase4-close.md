# Session Handoff — Phase 4 close

**Date**: 2026-04-27 (continuation of same day — second session)
**Branch**: `gsd/audit-quick-wins` (off `main` at `c2a5cfe`)
**Working tree**: clean
**HEAD**: `c21f378` (70 commits past `main`; +24 this session past the prior handoff `353aca6`)
**Phase progress**: Phases 1 + 2 + 3 + 4 complete (16 of 19 Phase 4 tasks done; 3 deferred). **Phases 5–8 remain.**

> New session: read **this file** + `tasks/todo.md` (now reflects Phase 4 close + deferrals) + the prior handoff `tasks/handoff-2026-04-27-phase4.md` for the deeper history.

---

## What landed this session — Phase 4 close (24 commits past prior handoff)

| PR | Tasks | Outcome | Commits |
|---|---|---|---|
| PR-21 | 4.4 + 4.5 | **No-op** — already shipped in PR-5 (`34ac5de`); bookkeeping closure | `9d1f956` |
| PR-22 | 4.2 + 4.13 | **No-op** — already shipped in `156bdb4` (Task 1.3 Part B); bookkeeping closure | `fd1950f` |
| PR-23 | 4.1 | **Real fix** — Category Performance groups by `categoryName` (with `'— Uncategorised'` COALESCE bucket) + adds `buildNonFeeCondition()` to WHERE | `afbe8d1` + `7f416d6` (test tighten) + `cfa1d4e` |
| PR-24 | 4.8 | **Real fix** — Hotels-in-Group/Location-Group detail tables drop redundant `Quantity`, populate real `Kiosks` count via `activeKioskCountFragment()`. UI columns now `[Hotel] [Metric] [Transactions] [Rooms] [Kiosks] [Stars] [Metric/Room]`. New `kiosks-subquery.test.ts`. | `7aa37d7` + `a726b60` |
| PR-25 | 4.6 | **Real fix** — D9 internal-account exclusion via `buildDimensionFilters` single-funnel propagation. New `'internal'` LocationType, `includeInternalAccounts?: boolean` on `AnalyticsFilters`, FilterBar `Switch` + `internal=1` URL param, `migration 0034` (CHECK rebuild + BK row tag, neon-dev only). | `19d8697` + `b610dce` |
| PR-26 | 4.7 | **Real fix** — Hotel name display normalisation. `formatHotelDisplayName()` strips `\s[bB]$` suffix; applied at 4 hotel-name render sites. Underlying data preserved for Phase 5.6 multi-POS bulk merge. | `7f97f5d` + `4b1fe4b` |
| PR-27 | 4.19 | **Real fix** — Region selector hotel-group count (was 79) now agrees with detail panel (63). Selector Query 2 rewritten to drive off `sales_records` matching the detail's logic. Structural-unification test. | `393466f` + `1cac00b` |
| PR-28 | 4.14 | **Test only** — Compare hotel-group dedup invariant pinned (EXISTS gate via `location_hotel_group_memberships`, no top-level membership JOIN). Production fix already in PR-6 Part E. | `7647f38` + `f885413` |
| PR-29 | 4.15 + 4.16 + 4.17 + 4.18 | **Real fix bundle** — Trend Builder polish. (4.15) Rolling-avg toggle disabled with tooltip when granularity ≠ daily; auto-clears stale state. (4.16) `autoGranularity` thresholds 31→60 / 90→200. (4.17) Server-side hierarchical event scope filter via `buildEffectiveLocationsPredicate` + per-request CTE in `getBusinessEvents`. Cache key bumped v1→v2. Portfolio caller plumbed too. (4.18) Deterministic `.orderBy(locations.id)` for weather lat/lng. | `9661a60` + `98f62d9` (follow-up) + `ff182ab` |
| PR-30 | 4.11 + 4.12 | **Largest piece** — Actions Dashboard UX (overdue badge, Mine-only Switch, location multi-select, due-date sort, resolvedAt display). NEW Flag Review page (`/analytics/flags`) with status tabs, type + location filters, inline-expand to linked actions, Create Action + Resolve actions per row. FlagDialog reshaped from XOR to single-submit + "Also create a linked action item" checkbox via tested `flag-dialog-submit.ts` helper. Linked-action count rendered server-side via correlated subquery (avoids N+1). New nav entry. | `7b68395` + `31e8581` + `c3c3836` (follow-up) + `c21f378` |

---

## Architectural additions this session

All in `src/lib/analytics/`:

- **`formatters.ts:formatHotelDisplayName(name)`** — display-only multi-POS suffix strip (`\s[bB]$`). TODO 5.6 reference in comment.
- **`queries/shared.ts:buildDimensionFilters`** — extended with default-exclude clause for internal locations (NOT IN subquery against `locations.locationType = 'internal'`). Toggled off by `filters.includeInternalAccounts === true`. **Single funnel** — every dashboard's WHERE picks this up automatically.
- **`queries/trend-series.ts:buildEffectiveLocationsPredicate(filters)`** — locations.id-anchored sibling of `buildDimensionFilters`. Used to compute the user's effective location set for hierarchical event-scope visibility.
- **`queries/trend-series.ts:getBusinessEvents`** — signature now `(dateFrom, dateTo, filters, userCtx)`. Per-request CTE `effective_locations` + 4-branch `scope_type` visibility predicate (global / hotel / region / hotel_group). Cache key `'v1'` → `'v2'`.
- **`queries/regions.ts:getRegionsList` Query 2** — rewritten to drive off `sales_records` (matches detail's `hotelGroupBreakdown` logic). Structural unification.
- **`queries/portfolio.ts:getCategoryPerformance`** — GROUP BY `COALESCE(products.categoryName, '— Uncategorised')` + WHERE excludes fees.
- **`queries/hotel-groups.ts` + `queries/location-groups.ts`** — per-row `kiosks` populated via `activeKioskCountFragment()`; redundant `quantity` field dropped.
- **`stores/analytics-filter-store.ts`** — `includeInternalAccounts` slice + URL serialisation as `internal=1` (omitted when default).
- **`url-filters.ts`** — `internal` param parser.
- **`components/analytics/filter-bar.tsx`** — admin "Show internal accounts" Switch.
- **`components/analytics/flag-dialog.tsx`** — XOR→checkbox refactor delegating to `flag-dialog-submit.ts` helper.
- **`components/analytics/flag-dialog-submit.ts`** — pure-function submit orchestrator (testable via injected createFlag/createActionItem fns).
- **`app/(app)/analytics/flags/page.tsx`** — NEW Flag Review page (~370 LoC).
- **`app/(app)/analytics/flags/actions.ts`** — `fetchAllFlags` (resolved/locationIds/flagTypes filters; correlated `linkedActionCount` subquery; canonical cache key) + `fetchFlaggedLocations`.
- **`app/(app)/analytics/actions-dashboard/actions.ts`** — `listActionItems` extended with `locationIds`, default sort `due_date ASC NULLS LAST, created_at ASC`. New `getCurrentUserId`, `listLocationsForActionsPicker`, `fetchActionItemsForFlag`.
- **`migrations/0034_locations_location_type_internal.sql`** — CHECK constraint rebuild + BK row tag. **Applied to neon-dev only.**

---

## Test state at HEAD `c21f378`

- `npx tsc --noEmit` → clean
- `npx vitest run --project unit` → **464 passed | 14 todo | 1 skipped** (was 425 at session start; **+39**)
- `npx vitest run --project integration` → unchanged from prior baseline (2 pre-existing failing files: `tests/etl/azure-etl-full.integration.test.ts` and `tests/commission/processor.integration.test.ts`; **no new regressions** introduced this session)

---

## Resolved-decisions snapshot — same as prior handoff

D1–D13 status unchanged except:
- **D9** (internal-account exclusion) — **Implemented PR-25**.

---

## What's left

### Phase 4 deferred (3 tasks)
- **4.3** Outlet Tiers cell `LIMIT 200` → "showing 200 of N" indicator. (P2 — UI noise, not correctness)
- **4.9** Bottom-20 / Top-20 overlap when 21 ≤ N ≤ 39. (P2 — rare edge case)
- **4.10** Cohort name uniqueness in Experiments. (P3 — UNIQUE constraint + form validation; not blocking)

These are explicitly flagged in `tasks/todo.md` as "**deferred Phase 4 close**" so future agents don't re-discover them as fresh.

### Phase 5 — NEW-P0-B Maturity data restoration (~7 tasks)
- **5.1** Investigate why all 231 outlets have `kiosk_assignments.assignedAt` in 2026-04. (P0)
- **5.2** Backfill historical install dates per **D4**. (P0)
- **5.3** Safeguard against mass `assignedAt` mutation. (P1)
- **5.4** Re-validate Maturity dashboard. (P0 verification gate)
- **5.5** D8 multi-POS site merge: probe + propose CSV (proposal already written at `tasks/analytics-audit/multi-pos-merge-proposal.csv`). (P1)
- **5.6** D8 apply the merge: rewrite sales_records / kiosk_assignments / membership tables; archive defunct rows; audit log. (P1)
- **5.7** D8 + D5 address-data-quality fix: identify outlets whose name mismatches address. (P1)

### Phase 6 — UX / cosmetic (8 tasks)
P2/P3 polish — outlet-code region disambiguation, threshold magic numbers → settings, currency/date format consistency, KPI tooltips, threshold editor URL persistence, lat/lng population for ~392 locations (Google Maps geocode). 6.8 is implicitly done (admin TZ flag landed in PR-14).

### Phase 7 — Kiosk management gaps (~12 tasks)
P0: locationType editable on form (7.1), primaryRegionId/outletCode editable (7.2), remove dropped `region` from EDITABLE_LOCATION_FIELDS (7.3 — currently 500s if hit). **Coordinate with PR-25** — D9 internal LocationType is now a real value but the form doesn't yet expose it.

P1: iana_timezone picker (7.2a), multi-select hotel-group picker (7.2b), additional fields (7.4), kiosk archive cascade (7.7), trial-ending-soon notification (7.10).

P2/P3: config-group picker (7.6a-d), archived toggle (7.8), banking field-level audit (7.9), `freeTrialEndDate` analytics deferred (7.11).

### Phase 8 — Process / regression hardening (~6 tasks)
- **8.3** done (build-time `BETTER_AUTH_SECRET` guard).
- **8.4** done (Vercel alias cleanup).
- Remaining: **8.1** CI smoke test (P0, would have caught Pivot 500). **8.2** Metric-mode invariant test (P1, would have caught Performer Pattern bug). **8.5** KPI tooltip docs (P2). **8.6** Admin password rotation flow doc (P3).

### Informal follow-ups surfaced this session

These don't yet have task numbers but should be assigned 4.20-4.24 (or similar) when picked up:

- **N+1 risk on Flag Review inline expansion** — when expanding a row, `fetchActionItemsForFlag(flagId)` is fired; not N+1 today (single row at a time) but if "expand all" is added it becomes one. Out of scope for now.
- **Compare entity picker missing archived filter** — flagged in prior handoffs.
- **`location-groups.ts` summary `total_kiosks` NULL** — at `:108-130` and `:158-184`. Separate audit items (`ANALYTICS-ISSUES.md:178, 467`). PR-24 was scoped to the per-row breakdown only; summary `total_kiosks` still always NULL → `txnPerKiosk` always renders "—". Worth a small follow-up PR.
- **D2 in-batch partial-refund matcher** — closes the 2% orphan gap.
- **D2 reversal matcher cross-batch ORDER BY for determinism.**
- **D2 reversal matcher cents-math for canonical equality.**

### Pre-prod migration runbook (when ready to deploy)

Migrations applied to **neon-dev only** by phase:
- **Phase 1**: 0027–0032.
- **Phase 2**: 0033 (`locations.iana_timezone` + `app_settings('analytics_display_timezone')`).
- **Phase 3**: no schema migrations.
- **Phase 4**: **0034** (`locations.location_type` CHECK rebuild + BK row → 'internal').

Backfill scripts:
- `scripts/backfill-reversals.ts` (D2; idempotent)
- `scripts/cleanup-bogus-region-memberships.ts --apply` (PR-6 Part A; idempotent)
- `scripts/cleanup-multi-location-group-memberships.ts --apply` (PR-6 Part B; idempotent)
- `scripts/split-jv-hotel-groups.ts --apply` (PR-6 Part C; idempotent)

Pre-deployment verification queries (run against the prod Neon branch after apply):
1. `SELECT COUNT(*) FROM sales_records WHERE is_weknow_fee = true;` → ~47,661.
2. `SELECT location_id, COUNT(*) FROM location_region_memberships GROUP BY 1 HAVING COUNT(*) > 1;` → 0 rows.
3. `SELECT location_id, COUNT(*) FROM location_group_memberships GROUP BY 1 HAVING COUNT(*) > 1;` → 0 rows.
4. `SELECT COUNT(*) FROM hotel_groups WHERE name ~ '.+,.+' AND archived_at IS NULL;` → 0.
5. `SELECT region_id IS NOT NULL FROM outlet_exclusions LIMIT 5;` → all true.
6. `SELECT iana_timezone, COUNT(*) FROM locations WHERE archived_at IS NULL GROUP BY 1;` → distribution matches the region backfill.
7. **NEW (PR-25):** `SELECT location_type, COUNT(*) FROM locations WHERE archived_at IS NULL GROUP BY 1;` → expect a row with `location_type='internal'`, count 1 (BK Customer Service). Other rows: hotel/airport/hex_kiosk/online/retail_desk + NULL.

---

## Critical context for the next session

### Skills to invoke at session start
1. `superpowers:subagent-driven-development` — executing implementation plans with subagents.
2. `andrej-karpathy-skills:karpathy-guidelines` — surgical, simple, goal-driven.
3. (If doing browser UAT) `playwright-cli` per user's strict preference (CLI not library, `--browser=chromium`).

### Verification commands
```bash
npx tsc --noEmit                              # typecheck
npx vitest run --project unit                 # unit suite (464 tests at HEAD)
npx vitest run --project integration          # integration (Testcontainers Postgres; 2 known-failing files)
git log --oneline c2a5cfe..HEAD               # commits since main
```

### Patterns established / reinforced this session

(All carry over from prior handoffs. New / reinforced patterns:)

- **`buildDimensionFilters` is the single funnel.** Every analytics WHERE builder calls it. Anything that needs to apply portfolio-wide (like the D9 internal exclusion) goes here — propagates everywhere automatically.
- **Two-flavoured scope predicate helpers**: `buildDimensionFilters` (sales_records-anchored) + `buildEffectiveLocationsPredicate` (locations.id-anchored). Use the right flavour for the table you're filtering.
- **`unstable_cache` key hygiene**: when changing the cached function's signature OR semantics, bump keyParts version (`'v1' → 'v2'`). When folding filters into the key, build a canonical key (sorted arrays + explicit field order) so caller-side variation doesn't fragment.
- **`"use server"` discipline**: pure helpers must live in sibling non-server modules (e.g. `flag-dialog-submit.ts`). Server-action files register every export as RPC. The PR-25 follow-up (extracted `where-builder.ts`) and PR-30 (extracted `flag-dialog-submit.ts`) both follow this.
- **Test discrimination over false-positive traps**: use occurrence counts (`/is_weknow_fee = false/g.length >= 3`) or position-anchored regex (`/from[\s\S]+where[\s\S]*?X[\s\S]+group by/`), NOT bare `toContain("X")` for assertions on shape that share tokens with surrounding code. PR-23 follow-up + PR-29 follow-up both tightened this.
- **Drizzle SQL chunk inspection** for query files: mock `executeRows`, capture rendered SQL via `toSQL()`, assert on the rendered string. Canonical: `sales-txn-count-sweep.test.ts`. For `db.select().from().where()` chains: inline-thenable mock pattern from `experiments-temporal-filters.test.ts`.

### Things that might trip up a new session

1. **Migration 0034 added a CHECK constraint REBUILD** (not just a data update). The original CHECK from migration 0024 enumerates allowed location_type values and must be dropped+re-added to accept `'internal'`. Idempotent via `DROP CONSTRAINT IF EXISTS` — but worth knowing if the migration runner ever re-runs.
2. **Prod's `is_booking_fee` vs neon-dev's `is_weknow_fee`**: migration 0028 only on neon-dev. Probes against prod must use the legacy column name; source code uses the new name. Documented in CLAUDE.md.
3. **Flag Review page exists at `/analytics/flags`** — new sidebar entry. `FlagDialog`'s "Create Action Instead" XOR is GONE; checkbox + paired-action workflow replaces it.
4. **D9 internal-type LocationType** is in the TS enum + LOCATION_TYPES + LOCATION_TYPE_LABELS. The location-detail form does NOT yet expose it — Phase 7.1 will. Until then, only the data migration tags rows; admins can't yet flip a row to 'internal' via UI.
5. **`getBusinessEvents` cache key bumped v1→v2 with filter signature folded in**. Existing entries invalidated. Next deploy will see a brief cache-miss spike for trend-builder + portfolio events overlay; benign.
6. **`getCategoryPerformance` SUM no longer carries `FILTER (WHERE ${amountMode})`** — revenue mode now shows non-fee revenue per category instead of fees-as-categories. Trade-off documented in commit message + inline comment. Top Products' LATERAL self-join handles fee attribution in revenue mode.

---

## Recommended new-session opening line

> "Read `tasks/handoff-2026-04-27-phase4-close.md` for the Phase 4 wrap-up. Phase 4 is closed (16 of 19 done; 3 deferred). Pick up Phase 5 next — the Maturity data restoration block. Use `superpowers:subagent-driven-development` and `andrej-karpathy-skills:karpathy-guidelines`."

This should land the next session straight into Phase 5.1 (investigation of the mass `assignedAt` reseed in 2026-04) — the gating P0 for the rest of Phase 5.

---

## Decision: merge to main now, or continue through Phase 5?

**Suggestion**: this is a clean stopping point to merge `gsd/audit-quick-wins` to `main` and start Phase 5 from a new branch.

Reasons:
- 70 commits past `main` is starting to be a lot for a single PR / branch.
- Phase 4's behavioural changes (especially PR-25 default-exclude internal locations + PR-29 hierarchical event scope + PR-30 Flag Review) deserve UAT before Phase 5 stacks on top.
- Migration 0034 needs to land on prod at some point — earlier is better.

Alternative: keep going through Phase 5/6/7/8 on the same branch. Acceptable but riskier; Phase 5 includes a destructive merge runbook (5.6) that benefits from a clean rollback target.

If merging now: cut a release branch (`release/audit-quick-wins-phase4`), open a PR, run UAT, apply migration 0034 to prod alongside the merge, ship.
