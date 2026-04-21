# Phase 1 — Measurement & Diagnosis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Apply `superpowers:test-driven-development` for the new scripts. Apply `superpowers:verification-before-completion` on every output gate (load results, pgss snapshot, EXPLAIN plans, final diagnosis doc).

**Goal:** Produce a ranked top-10 slow-query diagnosis doc (with EXPLAIN plans, source locations, and proposed fix categories) plus one full route waterfall trace, so Phase 2 has a concrete attack plan.

**Architecture:** Two small scripts (load generator + measurement orchestrator) drive synthetic Playwright traffic against a Vercel preview pointing at the existing Neon dev branch with `pg_stat_statements` enabled. The orchestrator resets stats, invokes the load, snapshots `pg_stat_statements`, then auto-runs `EXPLAIN (ANALYZE, BUFFERS)` on the top 10 queries. Human-readable diagnosis composed from the raw output.

**Tech Stack:** Playwright, `@neondatabase/serverless` (already configured by Phase 0's env fork), `postgres-js` (for EXPLAIN queries outside request path), `tsx`, Vercel CLI, `pg_stat_statements` extension on Neon.

**Related design doc:** `docs/plans/2026-04-21-phase-1-measurement-design.md`
**Predecessor phase:** Phase 0 (merged to `optimisation` as PR #18)
**Branch:** `perf/phase-1-measurement` (created from `optimisation`)

---

### Task 1: Enable `pg_stat_statements` on the Neon dev branch

**Files:** none (DB state change, not in repo)

**Step 1: Verify extension is available but not installed**

Run:
```
set -a; source .env.neon-dev; set +a
npx tsx -e "import postgres from 'postgres'; const c = postgres(process.env.DATABASE_URL, {max:1}); (async()=>{try{const r=await c\`SELECT name, installed_version FROM pg_available_extensions WHERE name='pg_stat_statements'\`;console.log(r);}finally{await c.end();}})();"
```
Expected: one row, `installed_version: null`.

**Step 2: Create the extension**

Run:
```
npx tsx -e "import postgres from 'postgres'; const c = postgres(process.env.DATABASE_URL, {max:1}); (async()=>{try{await c\`CREATE EXTENSION IF NOT EXISTS pg_stat_statements\`;console.log('extension created');}finally{await c.end();}})();"
```
Expected: `extension created`. No error.

**Step 3: Verify it collects by running a trivial query**

Run:
```
npx tsx -e "import postgres from 'postgres'; const c = postgres(process.env.DATABASE_URL, {max:1}); (async()=>{try{await c\`SELECT 1 as probe\`;const r=await c\`SELECT calls, query FROM pg_stat_statements WHERE query ILIKE '%probe%'\`;console.log(r);}finally{await c.end();}})();"
```
Expected: at least one row with the probe query, `calls` ≥ 1.

**No commit.** DB state only.

---

### Task 2: Point Phase 1 preview at Neon dev branch

**Files:** none (Vercel env config)

Phase 0's preview env had `DATABASE_URL` set to prod Neon. For Phase 1, we want the preview to hit the dev branch so load traffic accumulates in the just-enabled `pg_stat_statements`.

**Step 1: Confirm existing Vercel env state for perf/phase-1-measurement**

Run: `vercel env ls preview perf/phase-1-measurement`
Expected: either no branch-specific vars, or some inherited. Record what's there.

**Step 2: Set `DATABASE_URL` for Phase 1 branch to dev Neon**

Copy the `DATABASE_URL` from `.env.neon-dev`:
```
set -a; source .env.neon-dev; set +a
vercel env add DATABASE_URL preview perf/phase-1-measurement --value "$DATABASE_URL" --sensitive --yes
```

**Step 3: Set `BETTER_AUTH_SECRET` for Phase 1 branch**

Pull from prod, then set (same pattern as Phase 0 Gate 3):
```
vercel env pull --environment=production --yes /tmp/wkg-prod.env
set -a; source /tmp/wkg-prod.env; set +a
vercel env add BETTER_AUTH_SECRET preview perf/phase-1-measurement --value "$BETTER_AUTH_SECRET" --sensitive --yes
rm /tmp/wkg-prod.env
```

Do NOT set `BETTER_AUTH_URL` — leave empty so Better Auth auto-detects the preview host.

**Step 4: Verify**

Run: `vercel env ls preview perf/phase-1-measurement`
Expected: `DATABASE_URL` and `BETTER_AUTH_SECRET` present.

**No commit.**

---

### Task 3: Push branch + wait for Vercel preview Ready

**Files:** none directly (git push only).

**Step 1: Push**

Run: `git push -u origin perf/phase-1-measurement`

**Step 2: Wait for preview Ready**

Poll `vercel ls | awk '/phase-1/ || /<newest 10m>/'` until the Phase 1 preview appears with Status=Ready.

**Step 3: Capture preview URL**

Record the URL (format: `https://wkg-command-centre-<hash>-vedant-kalbag-wkgs-projects.vercel.app`).

**Step 4: Smoke-test the preview login**

Run (substitute URL):
```
curl -sI <preview-url>/login | head -5
```
Expected: HTTP 200. No ECONNREFUSED in Vercel logs.

If HTTP 500 or Better Auth errors appear in `vercel logs <url>`, pause and report — env vars may be mis-wired.

---

### Task 4: Write load-generator script (TDD + verification)

**Files:**
- Create: `scripts/phase-1-load.ts`

**Step 1: Decide script shape**

Load generator CLI:
- `--url=<preview-url>` (required)
- `--iterations=N` per route (default: 5)
- Reads `TEST_ADMIN_EMAIL`, `TEST_ADMIN_PASSWORD` from env.
- Logs in via headless Chromium (same pattern as `scripts/perf-measure.ts`).
- Walks every route in the 6-page set used in Phase 0:
  `/analytics/heat-map`, `/analytics/hotel-groups`, `/installations`, `/kiosks`, `/locations`, `/analytics/portfolio`.
  Plus: `/analytics/commission`, `/analytics/trend-builder`, `/analytics/experiments`, `/analytics/flags`, `/analytics/actions-dashboard` (the full analytics surface — these drive most of the migrated `executeRows` paths).
- For each route: `iterations` serial GETs, body-drain, discard timings.
- No JSON output — this script's contract is "generate traffic", not "report".

**Step 2: Write the script**

Structure:
```ts
// scripts/phase-1-load.ts
import { chromium } from "@playwright/test";

const ROUTES = [
  "/analytics/heat-map",
  "/analytics/hotel-groups",
  "/installations",
  "/kiosks",
  "/locations",
  "/analytics/portfolio",
  "/analytics/commission",
  "/analytics/trend-builder",
  "/analytics/experiments",
  "/analytics/flags",
  "/analytics/actions-dashboard",
];

// ...argparse for --url, --iterations...
// ...login via chromium, capture cookie...
// ...for each route, fetch `iterations` times, drain body, log progress...
```

Refer to `scripts/perf-measure.ts` (created in Phase 0) for the login flow — re-use the exact selectors.

**Step 3: Verify compile**

Run: `npx tsc --noEmit`
Expected: clean.

**Step 4: Smoke-run against localhost**

Start local dev (with `.env.local`, localhost DB), then:
```
npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/phase-1-load.ts --url=http://localhost:3003 --iterations=1
```
Expected: all 11 routes fetched without errors. Verify by checking dev-server logs for 200 responses on each route.

**Step 5: Commit**

```
git add scripts/phase-1-load.ts
git commit -m "test(perf): add Phase 1 load generator"
```

---

### Task 5: Write measurement orchestrator

**Files:**
- Create: `scripts/phase-1-measure.ts`

**Step 1: Define behavior**

Orchestrator CLI:
- `--url=<preview-url>` (required, passed through to loader)
- `--iterations=N` (passed to loader, default: 10 for statistical mass)
- `--out=<dir>` (default: `test-results/phase-1-<unix-ts>/`)
- Uses `.env.neon-dev` via `--env-file=` for `DATABASE_URL` (dev branch, for pgss + EXPLAIN queries).
- Uses `TEST_ADMIN_EMAIL`/`TEST_ADMIN_PASSWORD` from env for Playwright auth.

Workflow:
1. Connect to dev Neon via `postgres-js` (not our `@/db` — we want an independent client separate from the preview's driver).
2. `SELECT pg_stat_statements_reset()` — clean slate.
3. Spawn the load generator (`node scripts/phase-1-load.ts --url=... --iterations=...`) and wait for it to finish.
4. Snapshot `pg_stat_statements`:
   ```sql
   SELECT
     queryid,
     substring(query, 1, 400) AS query,
     calls,
     total_exec_time,
     mean_exec_time,
     stddev_exec_time,
     (mean_exec_time * calls) AS impact,
     rows
   FROM pg_stat_statements
   WHERE query NOT ILIKE '%pg_stat_statements%'
     AND query NOT ILIKE 'BEGIN%'
     AND query NOT ILIKE 'COMMIT%'
     AND query NOT ILIKE 'SELECT pg_catalog.%'
   ORDER BY (mean_exec_time * calls) DESC
   LIMIT 25;
   ```
5. Write JSON snapshot to `<out>/pgss-snapshot.json`.
6. For each of the top 10: run `EXPLAIN (ANALYZE, BUFFERS) <query>` with the exact params from `pg_stat_statements` (param placeholders `$1, $2, …` are replaced with literal defaults: use the mean values of the first few result rows for range params, or NULL for unknowns — document the substitution in the output).
   - Actually: `EXPLAIN (ANALYZE, BUFFERS) EXECUTE <prepared_statement_with_params>` works if we use prepared statements. Simpler: use `PREPARE` + `EXPLAIN EXECUTE` with literal value substitution noted alongside.
   - For this plan, write EXPLAIN output verbatim. If a query has bind params we can't guess, record it as "needs manual EXPLAIN" and move on.
7. Write each plan to `<out>/explain-<queryid>.txt`.
8. Write a rollup markdown to `<out>/raw-findings.md` with the top 10 table + relative links to the explain files.
9. Optionally: `vercel metrics vercel.function_invocation.function_duration_ms --since <window>` to supplement (ungrouped only).

**Step 2: Implement**

Same TDD pattern: tsc clean first, then smoke against local. But local Postgres doesn't have `pg_stat_statements` — so skip the smoke; instead verify by running the full flow against dev in Task 6.

**Step 3: Commit**

```
git add scripts/phase-1-measure.ts
git commit -m "test(perf): add Phase 1 measurement orchestrator"
```

---

### Task 6: Run measurement against Phase 1 preview

**Files:** `test-results/phase-1-<ts>/*` (gitignored)

**Step 1: Execute**

```
npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json scripts/phase-1-measure.ts --url=<phase-1-preview-url> --iterations=10
```
Expected: console progress shows reset → load (11 routes × 10 iterations = 110 page renders) → snapshot → 10 EXPLAIN plans written. Final console message: "raw findings at `test-results/phase-1-<ts>/raw-findings.md`".

**Step 2: Sanity-check the snapshot**

Open `test-results/phase-1-<ts>/pgss-snapshot.json` — expect ~25 distinct queries, highest-impact row has `calls >= 50`, `mean_exec_time` in milliseconds.

**Step 3: Sanity-check the EXPLAIN plans**

Open 2-3 of the `explain-*.txt` files. Expect:
- `Planning Time`, `Execution Time` lines at the end.
- `Seq Scan` or `Index Scan` node hierarchy.

If any EXPLAIN file contains an error (e.g. "cannot run EXPLAIN with params"), note which queryid and move on — that one becomes a manual EXPLAIN step in Task 7.

---

### Task 7: Locate call sites + manual EXPLAIN if needed

**Files:** none yet (notes).

**Step 1: For each of the top 10 queries from the snapshot**

Grep source for an identifiable fragment:
```
rg -n 'distinctive-fragment-from-query' src/
```

Record the file:line for each. If the query text is so generic that grep returns 10+ hits (e.g., `SELECT ... FROM sales_records WHERE ...`), use a more distinctive substring (join structure, specific column ordering).

**Step 2: Re-run EXPLAIN manually for any failed auto-EXPLAIN**

For queries where the orchestrator couldn't substitute params, construct a representative param set and run:
```
npx tsx --env-file=.env.neon-dev -e "import postgres from 'postgres'; const c = postgres(process.env.DATABASE_URL, {max:1}); (async()=>{try{const r=await c\`EXPLAIN (ANALYZE, BUFFERS) <query with params>\`;console.log(r.map(x=>x['QUERY PLAN']).join('\\n'));}finally{await c.end();}})();"
```

---

### Task 8: Pick worst route + trace full waterfall

**Files:** `test-results/phase-1-<ts>/waterfall-<route>.md` (gitignored scratch)

**Step 1: Identify the worst route**

From Task 6 output, find the route whose queries sum the highest `total_exec_time`. Proxy: the route whose call-site files appear most among the top 10.

**Step 2: Static-trace**

- Open the route's `page.tsx`.
- Follow every `async` server-component down the render tree.
- List every `db.select`, `executeRows`, `db.insert`, `db.update` call.
- Record: query identifier, awaited serially or via `Promise.all`, any dependency on prior query results.

**Step 3: Draft the waterfall diagram**

Markdown table or indented list:
```
page.tsx
  await loadMarkets()              → SELECT * FROM markets
  await loadDashboard()
    ├─ await loadHotelGroups()     → SELECT ... hotel_groups JOIN ...
    ├─ await loadMaturity()        → executeRows(maturity-analysis.ts:42) — serial with prev
    └─ await loadCommission()      → db.transaction ... (not a read, excluded)
```

Flag serial chains that could parallelize.

---

### Task 9: Write the diagnosis doc

**Files:**
- Create: `docs/plans/2026-04-21-phase-1-diagnosis.md`

**Step 1: Draft structure**

```markdown
# Phase 1 — Diagnosis

## Top 10 Queries (ranked by mean_exec_time × calls)

| # | Query (truncated) | Call site | Calls | Mean ms | Total ms | Proposed fix |
|---|---|---|---:|---:|---:|---|
| 1 | ... | src/lib/analytics/queries/hotel-groups.ts:42 | 110 | 180 | 19,800 | Add covering index on (market_id, date) |
| 2 | ... | ... | ... | ... | ... | ... |
...

## EXPLAIN plans

(link to each `test-results/phase-1-<ts>/explain-*.txt` OR paste inline if we want the PR to be self-contained — decide when writing)

## Worst route waterfall: `<route>`

(paste the Task 8 diagram)

## Proposed Phase 2 order

1. Fix query #1 — index. Expected impact: lowest-risk, biggest lever.
2. Fix query #2 — de-N+1 via Drizzle `with`. Medium risk, medium impact.
...

## Constraints on the numbers

- Synthetic load, 110 page renders. Distribution is uniform across routes, which does NOT match real usage.
- Neon dev branch has smaller row counts than prod; plans on prod may differ (esp. cost-based choices of seq-scan vs index).
- `pg_stat_statements_reset()` was called immediately before load; post-snapshot data is load-only.
```

**Step 2: Fill in the table + plans + waterfall**

Use the auto-generated `raw-findings.md` from Task 6 as the starting scaffolding. Elevate the raw data to narrative — each row in the top 10 gets a one-line explanation of why it's slow + what the fix category means in context.

**Step 3: Include a "Phase 2 cross-reference" section**

For each top query, list the routes that invoke it (from the waterfall + from any spot-check greps on other routes). Phase 2 should sequence fixes by "fixes the most expensive route first."

**Step 4: Commit**

```
git add docs/plans/2026-04-21-phase-1-diagnosis.md
git commit -m "docs(plans): Phase 1 diagnosis — top 10 queries + route waterfall"
```

---

### Task 10: Pre-PR hygiene

**Files:** none (checks).

**Step 1: Lock-file sanity (per the saved feedback memory)**

```
npm install --package-lock-only
git diff package-lock.json
```
If any change, commit. Then:
```
npm ci --dry-run
```
Expected: exit 0.

**Step 2: Type check**

Run: `npx tsc --noEmit`
Expected: clean.

**Step 3: Vitest (against local Postgres to avoid Neon round-trips)**

Run: `npx vitest run`
Expected: all green (no test changes expected, just regression check).

---

### Task 11: Open PR onto `optimisation`

**Step 1: Push**

Run: `git push`

**Step 2: Open PR**

```
gh pr create --base optimisation --head perf/phase-1-measurement \
  --title "perf(db): Phase 1 — measurement & diagnosis" \
  --body "<per template in Phase 0 PR, adapted to Phase 1 scope — docs-only, points at diagnosis doc>"
```

Body sections to include:
- Summary (synthetic-load-driven measurement produced ranked top 10 + full waterfall for the worst route)
- Link to `docs/plans/2026-04-21-phase-1-diagnosis.md`
- Statement that no application code changed; only `scripts/` + `docs/plans/`
- Test plan (tsc + vitest + npm ci dry-run all green)

---

## Rollback

All changes land in `scripts/` (new) and `docs/plans/` (new). Single-commit revert of any task's commit cleanly removes that task's artifact. The `pg_stat_statements` extension install on the dev branch is harmless and can remain; to revert, `DROP EXTENSION pg_stat_statements`.

## Out of scope

- No fixes to any query or call site. All fixes land in Phase 2+.
- No changes to `src/`.
- No prod DB changes. The extension install touches the **dev branch only**.
- No Observability Plus upgrade.
