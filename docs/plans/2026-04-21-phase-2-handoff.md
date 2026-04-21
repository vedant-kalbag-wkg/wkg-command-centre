# Handoff — Phase 2 Start

Date: 2026-04-21
From: previous session, Phase 1 just merged into `optimisation`
Target branch for Phase 2 work: new branch off `optimisation`

## TL;DR for the next session

You are joining a multi-phase performance-optimisation initiative. **Phases 0 and 1 are merged into the `optimisation` epic branch.** Phase 2 is next. When all phases land on `optimisation`, one final PR merges `optimisation` → `main`.

Everything you need is already in the repo — read the files listed below. Auto-memory at `~/.claude/projects/-Users-vedant-Work-WeKnowGroup-wkg-kiosk-tool/memory/MEMORY.md` carries user preferences forward automatically.

## Initiative topology

```
main ─┐
      ├── optimisation ─┬── Phase 0 (driver swap) ──── merged as #18
      │                 ├── Phase 1 (measurement)  ──── merged as #19
      │                 ├── Phase 2 ← you start here
      │                 ├── Phase 3 (caching)      planned
      │                 └── Phase 4 (materialised views) planned
      └── (final PR: optimisation → main, after all phases)
```

Parent design doc: `docs/plans/2026-04-21-db-performance-design.md`.

## What shipped in Phase 0

- Swapped request-path DB driver from `postgres-js` (max=10 per lambda) to `@neondatabase/serverless` WebSocket Pool via `drizzle-orm/neon-serverless`.
- `src/db/index.ts` is an env-driven fork: `.neon.tech` URL → neon-serverless; otherwise → postgres-js (local dev, CI testcontainers). `src/db/is-neon-url.ts` is the helper.
- Migrated 39 raw `db.execute()` call sites across 10 analytics query files to `executeRows()` (`src/db/execute-rows.ts`). Typed Drizzle query builder + `.returning()` unchanged — shape-compatible across both drivers.
- Seed and import scripts (`src/db/seed*.ts`, `scripts/import-*.ts`) stay on `postgres-js` (long transactions, not in request path).
- Measured −18% median p95 on analytics pages (Phase 0 Gate 3).
- Transaction parity test: `tests/db/driver-transaction-parity.integration.test.ts`.

## What shipped in Phase 1

Docs-only PR. Produced the diagnosis that feeds Phase 2.

- `docs/plans/2026-04-21-phase-1-diagnosis.md` — **read this first for Phase 2.** Top 10 slow queries, source pointers, EXPLAIN plans, proposed fixes, full waterfall of `/analytics/portfolio`.
- `scripts/phase-1-load.ts`, `scripts/phase-1-measure.ts` — reusable measurement tooling. Playwright-driven load (not `fetch()` — analytics pages are `"use client"`, hydration is required to trigger queries).
- `pg_stat_statements` extension is installed on the Neon **dev** branch (not prod). Safe to leave.

## Phase 2 starting point

From the diagnosis, prioritised Phase 2 backlog:

1. **Compound covering index on `sales_records(transaction_date, location_id) INCLUDE (gross_amount, quantity, product_id)`** — one DDL, materially improves 5 of top 10. Biggest bang/buck.
2. **Index on `kiosk_assignments(location_id, assigned_at)`** — removes correlated-subquery N+1 in `getOutletTiers` and `getHeatMapData`.
3. **Rewrite `getHotelGroupsList`** (`src/lib/analytics/queries/hotel-groups.ts:80`) — only top-10 query that spills 9 MB to disk. COUNT(DISTINCT location_id) over exploded join → pre-aggregation subquery.
4. **`sql.join(tierIds)` → `ANY($1::uuid[])`** in `src/lib/analytics/queries/high-performer-analysis.ts:113,220` — stabilises plan cache, shrinks bind count.
5. **Cross-cutting `active_locations` CTE / cached view** — every top-10 query JOINs `locations` solely to filter `outlet_code != 'TEST'`. ~2–4k buffer hits across the set.
6. **Partial index on `sales_records.transaction_time` IS NOT NULL** — only if prod data matches dev shape; validate first.

**Important user-visible-latency note:** all 6 portfolio server actions run via `Promise.all`. User-visible portfolio latency is bounded by the **slowest single query** (~280 ms), not the sum (~7.1 s). Phase 2 wins come from lowering the ceiling, not the total. Fix #1 collapses 4 of the 5 heaviest queries simultaneously — that's why it's ranked first.

## Setup state (current)

- Neon **prod** admin password is `Phase0Perf!2026-04-21` (rotated during Phase 0 Gate 3). **User should re-rotate to their preferred value whenever convenient.** Script: `scripts/reset-admin-password.ts`. Prod env via `vercel env pull --environment=production`.
- Neon **dev** admin password is `NeonDevPhase0!Test` (rotated during Phase 1). Credentials live in `.env.neon-dev` (gitignored, working-dir-local).
- Neon dev branch has `pg_stat_statements` installed (v1.10). Reset before each measurement with `SELECT pg_stat_statements_reset();`.
- Vercel preview env vars configured per-branch:
  - `perf/phase-0-neon-driver-swap` — DATABASE_URL (prod), BETTER_AUTH_SECRET (both remain set — OK to leave or remove via `vercel env rm`).
  - `perf/phase-1-measurement` — DATABASE_URL (dev), BETTER_AUTH_SECRET.
- No Vercel preview env vars are default for new branches. If Phase 2 needs a Vercel preview to test, you will need to configure DATABASE_URL + BETTER_AUTH_SECRET on the new branch after pushing (see Phase 0 Gate 3 flow for the pattern).

## User preferences (auto-loaded via memory)

These are stored in auto-memory and automatically loaded into new sessions. Key points you will already know:

- **Subagent-driven-development preferred**, paired with superpowers + karpathy-guidelines skills. Default to option 1 in this session (not parallel executing-plans).
- **CI lockfile drift is a repeat offender** — before opening any PR, run `npm install --package-lock-only` and `npm ci --dry-run`. `@emnapi/*` nested deps of `@tailwindcss/oxide-wasm32-wasi` and `@rolldown/binding-wasm32-wasi` get dropped on arm64 macOS `npm install` but are required on Linux CI.
- **Prod admin account:** `vedant.kalbag@weknowgroup.com` (not the seeded `admin@weknow.co`). Password rotation via `scripts/reset-admin-password.ts`.

CARL rules (always-on, dynamically injected each prompt):
- NEVER use relative paths in code — use absolute.
- NEVER use absolute paths when referencing files to user — use relative.
- NEVER run independent tool calls sequentially — batch them in parallel.
- NEVER mark tasks complete without validation — test everything, require proof.

## Branch strategy for Phase 2

Follow the same pattern as Phases 0 and 1:

1. From `optimisation` (updated): `git checkout optimisation && git pull`.
2. Create a Phase 2 branch: `git checkout -b perf/phase-2-indexes-and-rewrites` (or split into multiple narrower branches if you want smaller PRs — e.g. one PR per backlog item).
3. Use the brainstorming + writing-plans + subagent-driven-development flow per the user's preference memory.
4. Open PR onto `optimisation`, not `main`.
5. After all phases merged into `optimisation`, open final PR `optimisation` → `main`.

## Testing inventory on `optimisation`

- Vitest: 317 tests, 32 files, passes clean. Run: `npx vitest run`.
- Playwright: 91 spec files. Admin-prefixed tests have documented pre-existing flakiness (`0e999f9`); targeted subset excluding admin/* passes clean — run `npx playwright test tests/analytics tests/kiosks tests/locations tests/installations tests/smoke.spec.ts`.
- Transaction parity: `npx vitest run tests/db/driver-transaction-parity.integration.test.ts` — works against both `postgres-js` (local) and `neon-serverless` (Neon dev, via `set -a; source .env.neon-dev; set +a;` first).

## Measurement playbook (reusable for Phase 2 validation)

Same tooling from Phase 1:

```
# Ensure pg_stat_statements is reset + empty
set -a; source .env.neon-dev; set +a
npx tsx --env-file=.env.neon-dev -e "import postgres from 'postgres'; const c=postgres(process.env.DATABASE_URL,{max:1}); (async()=>{try{await c\`SELECT pg_stat_statements_reset()\`}finally{await c.end()}})();"

# Push feature branch → wait for Vercel preview → configure DATABASE_URL + BETTER_AUTH_SECRET
# (pattern in Phase 0 Gate 3 and Phase 1 Task 2)

# Run measurement
npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
  scripts/phase-1-measure.ts --url=<preview-url> --iterations=5

# For pure perf comparison (not query-shape diagnosis), use the Phase 0 harness:
npx tsx --env-file=/tmp/wkg-prod-minimal.env --tsconfig tsconfig.json \
  scripts/perf-measure.ts --url=<preview-url> --out=test-results/perf-<tag>.json
```

## Caveats specific to Phase 2

- **DDL on prod vs dev.** Index creation on prod Neon takes real time (minutes–hours on large tables). Phase 2 should almost certainly use `CREATE INDEX CONCURRENTLY` and schedule it explicitly. Migrations in this project land via `drizzle-kit`; check `drizzle.config.ts` and `migrations/` for the existing pattern. Do NOT use `CREATE INDEX CONCURRENTLY` inside a transaction — drizzle-kit's default migration wraps statements in `BEGIN/COMMIT`. Either use raw SQL files or ensure the transaction wrapper is disabled for the index migration.
- **Dev branch plans may differ from prod.** The diagnosis ran EXPLAINs against dev. Before shipping a fix, re-EXPLAIN against prod-shaped data to confirm the index is actually chosen. Neon supports schema-only branches and `neon_copy_data`-style approaches if a prod-seeded dev is needed.
- **Parallelism ceiling.** Because analytics fetches parallelise, don't expect each Phase 2 fix to give the headline percentage improvement on user-visible p95. The ceiling drops only when the slowest query drops. Test Phase 2 with the Phase 0 harness (client-observed p95) rather than only via `pg_stat_statements` (per-query mean).
- **Query #10 (`getHourlyDistribution`)** returned 0 rows on dev because `sales_records.transaction_time` is entirely NULL there. Validate prod data shape before applying the partial-index recommendation.

## Files to read first in the next session

1. `docs/plans/2026-04-21-phase-1-diagnosis.md` — Phase 2 starting point.
2. `docs/plans/2026-04-21-db-performance-design.md` — overall initiative framing.
3. `docs/plans/2026-04-21-phase-0-results.md` — Phase 0 measurement and caveats.
4. `src/db/index.ts` — the env-driven driver fork (small, understand it).
5. `src/db/execute-rows.ts` — helper used throughout analytics queries.

## Things that can be cleaned up post-epic

- `.env.neon-dev` in working dir (gitignored) — delete when work done.
- Vercel preview env vars on `perf/phase-0-neon-driver-swap` and `perf/phase-1-measurement` branches — remove via `vercel env rm` if previews won't be revisited.
- `pg_stat_statements` extension on dev branch — harmless to leave; `DROP EXTENSION pg_stat_statements` if a clean state is preferred.
- Old `test-results/phase-1-*/` dirs on disk (gitignored).
