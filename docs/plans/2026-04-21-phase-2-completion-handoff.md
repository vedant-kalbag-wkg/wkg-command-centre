# Handoff — Phase 2 Completion

Date: 2026-04-21 (end-of-day session)
From: this session — Phase 2 implementation + scope-expansion + Gate 2 measurement complete
Branch: `perf/phase-2-indexes-and-query-stability` (24 commits, all pushed to origin)
Predecessor handoff: `docs/plans/2026-04-21-phase-2-handoff.md`
Plan: `docs/plans/2026-04-21-phase-2-plan.md` (the 12-task implementation plan)
Design: `docs/plans/2026-04-21-phase-2-design.md` (still has aspirational targets — PR body should reflect measured reality, see Gate 2 below)

## TL;DR for the next session

Phase 2 is **code-complete**. All implementation work done, all backlog items shipped, all measurement evidence captured. **The PR has not been opened yet** — that's the only thing left before the user's prod-apply step.

Three things to do, in order:
1. Wait for the in-flight Playwright triage agent to finish its 17-spec verification run (will have completed by the time you read this — check the most recent commits on the branch).
2. Run `/simplify` per the user's stored CLAUDE.md preference (mandatory before any PR).
3. Open the PR against `optimisation` (NOT `main`) with the honest measurement table in the body.

Then the user runs the prod apply manually:
```
vercel env pull --environment=production /tmp/wkg-prod.env
npx tsx --env-file=/tmp/wkg-prod.env scripts/phase-2-apply-indexes.ts --check
npx tsx --env-file=/tmp/wkg-prod.env scripts/phase-2-apply-indexes.ts --apply
```

## What landed (24 commits, in order)

```
dc4b68b feat(db): declare phase-2 indexes in schema
6277928 refactor(db): align phase-2 index names with repo convention
31dbbfb feat(db): add marker migration 0020 for phase-2 indexes
21aae77 fix(db): make journal entry 20 timestamp monotonic
6a5180a feat(db): add phase-2 DDL runner (check/apply/rollback)
7459e15 fix(db): improve operator error messages in phase-2 DDL runner
419abe0 chore(perf): capture phase-2 preflight on neon dev
8e52839 chore(perf): capture phase-2 post-apply EXPLAINs on neon dev
53bce6a test(perf): pin bind shape for tierIds subqueries
6829fb1 test(perf): assert tierIds bind-count is length-invariant
f1ec944 perf(analytics): use = ANY(uuid[]) for tierIds-filtered subqueries
bf27ffc fix(test): isolate playwright output from perf-evidence dir
64c5da9 test(e2e): add remote playwright config for vercel preview runs
7a3324e feat(db): add second covering index for product-grouped queries
eaaa143 perf(analytics): rewrite getHotelGroupsList to kill 9MB disk spill
dcfd508 perf(analytics): cache active location IDs per request, drop locations JOIN where possible
84e8cd9 test(e2e): align analytics/kiosks/locations specs with current UI copy
8adf58d test(e2e): add stable test-ids for analytics filter bar and kiosk card
5c9d573 test(e2e): harden locations inline-edit specs against filter/blur flakes
73f2338 perf(analytics): share locationRevenues aggregate per request via React.cache
d7b88cb fix(ui): refresh RSC after inline-edit save so value is displayed
f867a48 test(e2e): stabilise inline-edit and sign-in specs against remote preview
27f1750 fix(analytics): wrap active-location IDs in sql.param         ← critical bug fix
6fb3f5e chore(perf): final phase-2 gate 2 measurement after sql.param fix
(any later commits = the Playwright triage agent's final cleanup)
```

## What Phase 2 actually delivers

Three concurrent indexes on Neon (created via `scripts/phase-2-apply-indexes.ts --apply`):
- `sales_records_txn_loc_covering_idx` — `(transaction_date, location_id) INCLUDE (gross_amount, quantity, product_id)`
- `sales_records_txn_prod_covering_idx` — `(transaction_date, product_id) INCLUDE (gross_amount, quantity)`
- `kiosk_assignments_loc_assigned_idx` — `(location_id, assigned_at)`

Three application changes:
- **`= ANY($1::uuid[])` rewrite** in 4 sites of `src/lib/analytics/queries/high-performer-analysis.ts` — stabilises plan cache (was `IN ($1, $2, …, $N)` per distinct tierIds.length).
- **`getHotelGroupsList` CTE rewrite** in `src/lib/analytics/queries/hotel-groups.ts` — pre-aggregates by location before joining memberships. Eliminates 9 MB external merge sort entirely.
- **`active_locations` request-scoped cached helper** in `src/lib/analytics/active-locations.ts` — every analytics query now filters via `location_id = ANY(active_ids)` instead of `INNER JOIN locations` + `outlet_code` exclusion. 8 queries dropped the locations JOIN entirely; 7 kept the JOIN but added the predicate so the planner can pre-filter on the covering index.
- **`getLocationRevenuesForRequest` React.cache helper** in `src/lib/analytics/queries/location-revenues.ts` — defensive de-dup for `computePerformerPatterns` (defense in depth; pgss didn't surface a measurable benefit because the two server actions don't share a React render scope reliably).

Migration `0020_phase_2_indexes.sql` and `0021_phase_2_product_covering_idx.sql` ship the same DDL via standard drizzle-kit (non-CONCURRENTLY) for fresh dev/CI bootstrap. Both are idempotent (`IF NOT EXISTS`); on prod they're no-ops because the apply script ran first.

Test infrastructure additions:
- `playwright.remote.config.ts` + `npm run test:e2e:remote` — runs Playwright against a deployed Vercel preview pointing at Neon dev (rich fixture data) instead of localhost. Set `PREVIEW_URL` env var, source `.env.neon-dev` for `TEST_ADMIN_*`.
- `playwright.config.ts` outputDir moved to `playwright-output/` (was colliding with `test-results/` perf evidence).
- `tests/db/high-performer-bind-shape.test.ts` — contract test pinning the `params.length === 1` invariant for the four tierIds subqueries. Also pinned `sql.param(arrayValue)` as the canonical drizzle-orm 0.45.x pattern; **future query work that interpolates JS arrays MUST use `sql.param`, not bare `${arr}`.**

## Gate 2 — measured outcomes (honest)

Per-query mean_ms vs Phase 1 baseline (Neon dev, 2 full Promise.all fanouts captured in pgss):

| # | Query | Phase 1 baseline | Phase 2 final | Δ |
|---:|---|---:|---:|---:|
| 1 | getPortfolioSummary | 191 ms | **36.59** | **−81%** |
| 2 | getTopProducts | 278 ms | **143.37** | **−48%** |
| 3 | getCategoryPerformance | 267 ms | **154.27** | **−42%** ← slowest in batch |
| 4 | getDailyTrends | 217 ms | **117.37** | **−46%** |
| 5 | getOutletTiers | 214 ms | **61.19** | **−71%** |
| 7 | locationRevenues | 59 ms | 60.41 | flat (cache benefit not in pgss) |
| 8 | getHotelGroupsList | 116 ms | **51.75** | **−55%** |

Acceptance criteria from the design doc:
- **A. Slowest single query in `fetchPortfolioData` Promise.all batch < 150 ms** → **MISSED by 4ms** (154.27 vs 150 target). Effectively a wash perceptually; could chase with more index tuning but diminishing returns.
- **B. p95 `/analytics/portfolio` drops ≥ 25% vs Phase 1 baseline** → **MISSED** — client p95 essentially flat (1318 vs ~1304). Per-query latency is no longer the bottleneck; Vercel cold-start + React hydration + network now dominate page load. Out of Phase 2 scope.
- **C. No new query enters top 5 by mean × calls** → **PASS** (same 5 queries, just dramatically faster).

The PR body should frame Phase 2 around **the per-query wins** (40-81% drops on 5/6 top queries), not the missed client-p95 ceiling. The bar moves to overhead-oriented Phase 3 work (caching layer, RSC streaming).

Measurement artifacts committed:
- `test-results/phase-2-after-final.json` — perf-measure n=20 client-observed
- `test-results/phase-1-1776781106/` — pgss snapshot post-0020+0021 (mid-state reference)
- `test-results/phase-1-1776786749/` — pgss snapshot post-expansion (final state)
- `test-results/phase-2-explain-after.txt` — Gate 1 evidence (post-apply EXPLAINs on Neon dev)
- `test-results/phase-2-preflight-*.txt` — Gate 1 baseline EXPLAINs

## Gotchas discovered this session (worth remembering)

### 1. drizzle-orm 0.45.x bare-array interpolation unpacks to N params

`sql\`WHERE col = ANY(${jsArray}::uuid[])\`` does **NOT** bind the array as one param. It unpacks into `$1, $2, ..., $N`. The canonical fix is `sql\`WHERE col = ANY(${sql.param(jsArray)}::uuid[])\``.

This bug almost broke prod: it shipped in `active-locations.ts` (commit `dcfd508`) and broke the entire portfolio page with 3×500s on every load. Caught by smoke-testing the preview before opening the PR. Fix in `27f1750`.

The bind-shape contract test at `tests/db/high-performer-bind-shape.test.ts` is the regression gate. **Anyone adding a new tierIds-style query MUST add it to that test.**

### 2. Local Postgres DB was in migration drift

`localhost:5432/wkg_kiosk_dev` had only migrations 0–13 recorded in `__drizzle_migrations` but schema effects of 0013–0017 were applied out-of-band. Caused `npx drizzle-kit migrate` to silently fail with "relation already exists." User authorised a `dropdb && createdb && migrate && seed` reset; local is now at head.

After reseed, the seeded admin password defaults to whatever `ADMIN_PASSWORD` is set to (NOT `TestAdmin123!` that tests expect). Run `ADMIN_EMAIL=admin@weknow.co ADMIN_PASSWORD='TestAdmin123!' npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/reset-admin-password.ts` after seed if Playwright local runs are needed.

### 3. Playwright `outputDir` defaults to `test-results/`

Same dir we use for perf evidence. First run wiped our committed preflight files. Now isolated to `playwright-output/` (gitignored). Playwright HTML report goes to `playwright-report/` (also gitignored). See `playwright.config.ts` (commit `bf27ffc`).

### 4. The `_journal.json` `when` field can go backwards

Entry 19 was hand-set to a future timestamp (`1777336800000`). Entry 20 from `Date.now()` ended up earlier. drizzle-kit orders by `idx` not `when`, so runtime is fine, but it's confusing in audits. Phase 2's entries 20 & 21 use `1777336800001` and `1777336800002` for monotonicity. **Future migrations should bump from the previous entry's `when`, not blindly use `Date.now()`.**

### 5. Snapshot drift in `migrations/meta/`

Snapshots stop at `0017_snapshot.json` but SQL files now go to `0021`. Pre-existing condition (entries 18 + 19 added by previous work without snapshots). Phase 2 added 0020 + 0021 the same way. **Don't run `drizzle-kit generate` until this is resolved** — it'll likely emit corrupted output. Phase 3 candidate: regenerate all snapshots from current schema.

## Setup state (current)

- **Neon prod admin password:** unchanged from prior handoff (`Phase0Perf!2026-04-21`). Re-rotate to your preferred value when convenient via `scripts/reset-admin-password.ts`.
- **Neon dev:** schema at head (all 21 migrations applied including the two Phase 2 marker migrations); all 3 Phase 2 indexes present and `indisvalid: true`.
- **Local Postgres dev DB:** reset and re-seeded mid-session. Schema at head. Admin password reset to `TestAdmin123!`.
- **Vercel preview env vars:** configured on `perf/phase-2-indexes-and-query-stability` (DATABASE_URL=Neon dev, BETTER_AUTH_SECRET).
- **Latest Phase 2 preview URL:** `https://wkg-command-centre-8tfwdtwni-vedant-kalbag-wkgs-projects.vercel.app` (saved to `/tmp/phase-2-preview-url.txt` if still present).
- **`pg_stat_statements` on Neon dev:** still installed (extension was set up in Phase 1; carries over).
- **Local repo git config:** `user.email` set to `vedant.kalbag@weknowgroup.com` for this checkout (commit attribution under work account).
- **`.mailmap`** in repo root: maps historical commits authored as `vedant.kalbag@gmail.com` to the work account for `git log`/`git blame`/`git shortlog` display. **Doesn't fix GitHub's contributor graph** — that requires moving the gmail email from personal GitHub account to work GitHub account (manual web-UI shuffle). User explicitly deferred: "Forget the authorship in the past."

## What's left before merging

### Step 1: confirm Playwright triage agent finished

It was still in-flight at session end, running its final verification of 17 originally-failing specs against the Phase 2 preview. Check the most recent commit on the branch:

```bash
git log -3 --oneline
```

If there's a commit beyond `6fb3f5e chore(perf): final phase-2 gate 2 measurement` from the agent (most likely a `test(e2e):` or `chore(test):` commit reporting verification results), the agent finished. If not, monitor a bit longer or check `/private/tmp/claude-501/<session>/tasks/a8d199a2a3d77dc61.output` for status.

### Step 2: run `/simplify`

Per the user's stored CLAUDE.md preference: *"Before creating a PR, run the `/simplify` command to check for any code that can be simplified."* Skip this only if the user explicitly says so.

### Step 3: open the PR

```bash
gh pr create --base optimisation --title "perf(db): Phase 2 — indexes + plan-cache stability + backlog" --body "$(cat <<'EOF'
## Summary

Phase 2 of the DB performance initiative. Three new covering indexes,
plan-cache stability via `sql.param` array binding, plus three Phase 1
backlog items (#3 hotel-groups CTE rewrite, #5 locationRevenues React.cache,
#6 active_locations request-scoped cached helper).

## Changes

**Indexes** (created via `scripts/phase-2-apply-indexes.ts --apply`):
- `sales_records_txn_loc_covering_idx` — `(transaction_date, location_id) INCLUDE (gross_amount, quantity, product_id)`
- `sales_records_txn_prod_covering_idx` — `(transaction_date, product_id) INCLUDE (gross_amount, quantity)`
- `kiosk_assignments_loc_assigned_idx` — `(location_id, assigned_at)`

**Application changes**:
- `IN ${sql.join(tierIds, ...)}` → `= ANY(${sql.param(tierIds)}::uuid[])` in 4 sites of `high-performer-analysis.ts`
- `getHotelGroupsList` CTE rewrite — kills 9 MB external merge sort
- `active_locations` cached helper — request-scoped list of allowed location IDs; replaces or augments INNER JOIN locations + outlet_code exclusion
- `getLocationRevenuesForRequest` React.cache helper for defense-in-depth

**Test infra**:
- `playwright.remote.config.ts` + `npm run test:e2e:remote` for Vercel-preview-based UAT against Neon dev fixture data
- `tests/db/high-performer-bind-shape.test.ts` contract test pinning the `sql.param` requirement
- Playwright `outputDir` moved out of `test-results/` to avoid wiping perf evidence

**UI fix found en-route**: `fix(ui): refresh RSC after inline-edit save so value is displayed` — discovered by the Playwright triage that exposed a real save-but-no-display regression in inline-edit components.

## Measured outcomes

| # | Query | Phase 1 baseline | Phase 2 | Δ |
|---:|---|---:|---:|---:|
| 1 | getPortfolioSummary | 191 ms | **37 ms** | −81% |
| 2 | getTopProducts | 278 | **143** | −48% |
| 3 | getCategoryPerformance | 267 | **154** | −42% (slowest in batch) |
| 4 | getDailyTrends | 217 | **117** | −46% |
| 5 | getOutletTiers | 214 | **61** | −71% |
| 8 | getHotelGroupsList | 116 | **52** | −55% |

Five of six top portfolio queries dropped 40-81%. Original "<150ms slowest single query" gate missed by 4 ms (154 vs 150) — perceptually a wash. p95 `/analytics/portfolio` is essentially flat (1318 vs 1304 baseline) because per-query latency is no longer the bottleneck; Vercel cold-start, React hydration, and network now dominate. **The remaining headroom lives in Phase 3** (caching layer, RSC streaming, materialised views).

Evidence: `test-results/phase-2-after-final.json`, `test-results/phase-1-*/pgss-snapshot.json`.

## Prod rollout (separate, user-driven)

After merge:

```bash
vercel env pull --environment=production /tmp/wkg-prod.env
npx tsx --env-file=/tmp/wkg-prod.env scripts/phase-2-apply-indexes.ts --check
# review preflight: row counts, current indexes, EXPLAIN
npx tsx --env-file=/tmp/wkg-prod.env scripts/phase-2-apply-indexes.ts --apply
```

Three indexes ship via `CREATE INDEX CONCURRENTLY` — no write lock. Rollback: `--rollback` drops all three concurrently.

## Test plan

- [x] Vitest 322/322 pass
- [x] Gate 1 — indexes exist on Neon dev, planner picks them
- [x] Gate 2 — per-query measurement (5/6 wins; ceiling slightly missed)
- [x] Remote Playwright targeted subset on Phase 2 preview (zero Phase 2 paths in any failure)
- [ ] Post-merge: prod `--check` + `--apply` (user)
- [ ] Post-apply: 24h organic traffic observation via pgss
EOF
)"
```

### Step 4: address PR review

Honest framing in the PR body should preempt most of "why did A miss?" / "why didn't p95 move?" questions. If reviewers push back on the missed gate, point them to the per-query table.

## Files to read first in the next session

1. **This file** — context for what was done and why.
2. `docs/plans/2026-04-21-phase-2-design.md` — original scope (note: claims about Gate 2 in here are aspirational, not measured).
3. `docs/plans/2026-04-21-phase-2-plan.md` — the 12-task plan, useful for following the implementation timeline.
4. `src/lib/analytics/active-locations.ts` — the helper that nearly broke prod. Read it AND the `sql.param` fix on line 66.
5. `tests/db/high-performer-bind-shape.test.ts` — the contract test that pins the `sql.param` requirement. Anyone adding a new tierIds-style query must extend this.
6. `scripts/phase-2-apply-indexes.ts` — the prod DDL runner. Read end-to-end before invoking on prod.

## Things that can be cleaned up post-merge

- **Snapshot drift in `migrations/meta/`** (Phase 3 candidate). Regenerate snapshots for 0018-0021.
- **`.mailmap`** stays useful for `git log` display; the GitHub contributor-graph attribution still attributes 351 historical commits to the personal account. Manual GitHub email shuffle (move `vedant.kalbag@gmail.com` from personal account to work account, verify, wait ~10 min for GitHub to re-process). User deferred.
- **Local-DB ↔ Neon-dev sync workflow** — user mentioned a strategic direction: "ensure local DB stays in sync with remote." Phase 3 candidate is per-developer Neon branches forked from a "trunk" dev branch, with `vercel env pull` + `neonctl branches create` automation. Local Postgres becomes optional.
- **`test:e2e:remote` script ergonomics** — currently requires PREVIEW_URL + TEST_ADMIN_* env vars set externally. Could wrap in a script that reads from `.env.neon-dev` automatically.
- **The unused `_adhoc_*` script files** under `scripts/` were cleaned up in this session, but if any leaked through review, delete them.
- **Phase 2 design doc's Gate 2 acceptance criteria** are now stale (claim 25% p95 drop, didn't happen). Update or annotate when starting Phase 3.

## Phase 3 candidates (priority-ordered, from the diagnosis still being relevant)

These were considered for Phase 2 expansion but not done:

1. **Caching layer** (`unstable_cache` for portfolio aggregates, `React.cache` for per-request dedupe across server actions). Highest expected client-p95 win remaining.
2. **RSC streaming** for analytics pages — they're currently `"use client"` with full-blocking hydration; converting to streaming server components would cut perceived load time more than any query optimisation can.
3. **Materialised views** for the most-stable aggregates (e.g., per-day per-location revenue). Manual refresh tied to ETL.
4. **Snapshot drift fix** (one-shot infra cleanup).
5. **Partial index on `sales_records.transaction_time IS NOT NULL`** — was deferred from Phase 2 because dev branch has all-NULL `transaction_time`. Validate prod data shape first.
6. **Local-DB ↔ Neon-dev sync workflow** (per-developer Neon branches).
