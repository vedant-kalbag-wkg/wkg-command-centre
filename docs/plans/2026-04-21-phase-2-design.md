# Phase 2 — Design

Date: 2026-04-21
Parent initiative: `docs/plans/2026-04-21-db-performance-design.md`
Predecessor: Phase 1 diagnosis (`docs/plans/2026-04-21-phase-1-diagnosis.md`, merged as PR #19)
Branch: `perf/phase-2-indexes-and-query-stability`
PR target: `optimisation` (not `main` — final epic merge happens after all phases land)

## Goal

Reduce `/analytics/portfolio` user-visible p95 by lowering the slowest-single-query ceiling in the `fetchPortfolioData` `Promise.all` batch (Phase 1 baseline: ~280 ms on `getTopProducts`). User-visible latency is bounded by the slowest query, not the sum — Phase 1 explicitly identified this as the dominant lever.

## Scope

### In scope (Phase 2)

1. Compound covering index `sales_records (transaction_date, location_id) INCLUDE (gross_amount, quantity, product_id)` — fixes top-10 queries #1, #2, #3, #4, #7.
2. Index `kiosk_assignments (location_id, assigned_at)` — fixes top-10 queries #5, #6 (correlated-subquery N+1 in `kioskLiveDateSubquery`).
3. Replace `IN ${sql.join(tierIds, ...)}` with `= ANY(${tierIds}::uuid[])` at all four call sites in `src/lib/analytics/queries/high-performer-analysis.ts` (lines 177, 193, 210, 227). Plan-cache stability; same query semantics.

### Out of scope (deferred to Phase 3+)

- Item #3 (rewrite `getHotelGroupsList` to eliminate 9 MB external merge sort).
- Item #5 (de-N+1 `locationRevenues` via request-scoped aggregate sharing).
- Item #6 (cross-cutting `active_locations` CTE/cached helper).
- Item #7 (partial index on `sales_records.transaction_time` — needs prod data shape validation first).
- Item #8 (caching layer — `unstable_cache` / `React.cache`).
- Resolving `migrations/meta/` snapshot drift (snapshots stop at 0017, SQL files go to 0019). Pre-existing condition; document and skip `drizzle-kit generate` for this phase.

## Success criteria

Must hit before PR is mergeable:

1. Both indexes exist on Neon dev branch (verified via `pg_indexes`).
2. `EXPLAIN (ANALYZE, BUFFERS)` of queries #1, #2, #4, #5, #6 on dev shows the new index is chosen. `getPortfolioSummary` plan switches from Nested Loop + Memoize to Index (Only) Scan.
3. `scripts/perf-measure.ts` against the Vercel preview, 5 iterations × 10 routes: portfolio batch slowest-query mean drops from baseline ~280 ms to <150 ms (target <100 ms).
4. Vitest passes 318/318 (existing 317 + 1 new bind-shape test).
5. Targeted Playwright passes: `tests/analytics tests/kiosks tests/locations tests/installations tests/smoke.spec.ts`.
6. New unit test asserts each of the four rewritten queries binds `tierIds` as a single array parameter — proves plan-cache surface is constant regardless of tier cardinality.

## Architecture

### New files

- `scripts/phase-2-apply-indexes.ts` — DDL runner. Three modes:
  - `--check` — read-only. Prints `sales_records` and `kiosk_assignments` row counts, current `pg_indexes` for both tables, `EXPLAIN (ANALYZE, BUFFERS)` of two canonical queries (`getPortfolioSummary`-shape and the `kioskLiveDateSubquery` correlated MIN). Saves output to `test-results/phase-2-preflight-<unix-ts>.txt`. Safe on prod.
  - `--apply` — runs `CREATE INDEX CONCURRENTLY IF NOT EXISTS` for both indexes as separate statements outside any transaction. Idempotent, abortable, re-runnable. Logs per-index timing. Safety rail: refuses to run unless `--check` was executed within the last hour against the same DATABASE_URL host (lightweight on-disk timestamp under `test-results/.phase-2-preflight-stamp-<host-hash>`).
  - `--rollback` — `DROP INDEX CONCURRENTLY IF EXISTS` for both index names.
  - Driver: `postgres-js` (long-running, not request-path).
  - Env: `--env-file=` per repo convention.

- `migrations/0020_phase_2_indexes.sql` — marker migration. Plain (non-CONCURRENTLY) `CREATE INDEX IF NOT EXISTS` for both indexes inside drizzle-kit's transaction. On prod, the script ran first → both already exist → marker is a no-op. On a fresh local/CI DB, drizzle-kit applies them under a brief table lock (acceptable, no live traffic). Comment block explains why CONCURRENTLY isn't here.

- `tests/db/high-performer-bind-shape.test.ts` — Vitest unit. Builds the four rewritten queries with a fixture `tierIds` of length 50; uses Drizzle's `.toSQL()` to assert `params.length` does not depend on `tierIds.length`. Proves single-array-bind, not unpacked-N-bind.

### Modified files

- `src/db/schema.ts` — add the two index definitions to `salesRecords` and `kioskAssignments` table builders. Names match the marker SQL exactly. Drizzle is now aware of them; future work can reference them by name.

- `src/lib/analytics/queries/high-performer-analysis.ts` — replace four `IN ${sql\`(${sql.join(tierIds.map(...), sql\`, \`)})\`}` blocks with `= ANY(${tierIds}::uuid[])`. Verify exact SQL emission via `.toSQL()` in the new test (fall back to Drizzle's `inArray()` helper if the raw `sql` template doesn't bind the JS array as a single PG array param).

### Index naming

Long-form descriptive names rather than the existing terse style (`sales_loc_date_idx`):

- `sales_records_txn_loc_covering_idx` — leading column, second column, "covering" tag.
- `kiosk_assignments_loc_assigned_idx` — leading column, second column.

Reason: covering indexes with INCLUDE columns are non-obvious from short names; future maintainers grepping `pg_indexes` should be able to tell at a glance this is a covering index.

## Runtime behaviour (data-flow deltas)

### Compound `sales_records` index

Before: `getPortfolioSummary` (`portfolio.ts:87`) executes Nested Loop driven by `sales_prod_date_idx` (124k rows scanned, 29k buffer hits), heap fetch for `gross_amount`/`quantity`, Memoize→`locations_pkey` (~243 misses, ~729 hits).

After: predicate `WHERE transaction_date BETWEEN $1 AND $2 AND location_id IN (...)` becomes a single index range scan; `gross_amount` and `quantity` come from the INCLUDE list (no heap fetch); `location_id` is in the index key so JOIN with `locations` becomes Hash Join over a streamed input. Same shape benefits queries #2, #3, #4, #7.

Why this index instead of `sales_loc_date_idx` (already exists at `(location_id, transaction_date)`): leading column `transaction_date` matches the most selective predicate, and INCLUDE columns make it covering — eliminates the heap visit the existing index requires.

### `kiosk_assignments` index

Before: correlated subplan in `kioskLiveDateSubquery` (`shared.ts:80`) is `(SELECT MIN(assigned_at) FROM kiosk_assignments WHERE location_id = locations.id)`. 200 loops × seq scan = ~1,800 buffer hits.

After: 200 loops × index lookup of 1–3 pages = ~400–600 buffer hits. `MIN(assigned_at)` reads only the first leaf entry per `location_id` (no aggregate scan) because the composite key is `(location_id, assigned_at)`. Used by `getOutletTiers` (#5) and `getHeatMapData` (#6).

### `= ANY(uuid[])` rewrite

Bind-shape change only. Result sets are byte-identical. Today: `WHERE location_id IN ($1, $2, ..., $77)` produces a separate cached plan per distinct `tierIds.length`. After: `WHERE location_id = ANY($1::uuid[])` produces one cached plan regardless of array size. Plan-time row estimates still vary with array size (planner re-estimates from `pg_statistic`) — the plan cache simply stops fragmenting. Side benefit: shorter wire bytes when `tierIds` is large.

### No data-flow changes elsewhere

Server actions, React components, hydration order, `Promise.all` topology — untouched. The two new indexes are picked up automatically by Postgres's planner for any query whose predicate matches; no application code references them by name.

## Failure modes

| Failure | Detection | Mitigation |
|---|---|---|
| `CREATE INDEX CONCURRENTLY` fails mid-build on prod | Script logs PG error | Postgres leaves an INVALID index visible in `pg_indexes`; `--rollback` drops by name; re-run `--apply` after fix. |
| Planner doesn't choose new index on prod (different stats than dev) | `--check` post-apply EXPLAIN | `ANALYZE sales_records;` to refresh stats. If still not chosen, index is benign overhead — drop via `--rollback` while we plan a different shape. |
| `= ANY(uuid[])` rewrite breaks query semantics | New unit test fails OR analytics Playwright fails | Revert just the `high-performer-analysis.ts` change; keep indexes. |
| `IF NOT EXISTS` race on a fresh CI DB (drizzle-kit applies marker before script runs) | `pg_indexes` shows index already created by drizzle-kit (non-CONCURRENTLY) | Acceptable: marker SQL succeeded; prod path is unaffected. Local devs get the index either way. |
| Snapshot drift causes `drizzle-kit generate` to want to regenerate index DDL after schema.ts edit | `drizzle-kit generate` shows unexpected DDL | Don't run `generate` for this phase. Marker file is hand-written. Revisit snapshot drift post-Phase 2. |
| Preflight stamp safety rail blocks legitimate re-apply > 1h after check | Script error message | Re-run `--check`, then `--apply`. Friction is intentional. |
| Drizzle's `sql\`= ANY(${tierIds}::uuid[])\`` doesn't bind as single param | `.toSQL()` shows N params | Use `inArray()` helper instead. Verified in unit test. |

## Validation & rollout sequence

Deterministic order. Each numbered step must succeed before the next.

1. Branch from latest `optimisation` → `perf/phase-2-indexes-and-query-stability` (already done).
2. Edit `src/db/schema.ts` — add 2 index definitions.
3. Write `migrations/0020_phase_2_indexes.sql` — marker.
4. Write `scripts/phase-2-apply-indexes.ts` — check / apply / rollback.
5. Apply locally on Neon dev: `--check` then `--apply`. Capture preflight + post-apply state.
6. Manually re-EXPLAIN queries #1, #2, #4, #5, #6 against dev. Save to `test-results/phase-2-explain-after.txt`. **Gate 1.**
7. Edit `src/lib/analytics/queries/high-performer-analysis.ts` — 4 sites.
8. Write `tests/db/high-performer-bind-shape.test.ts`.
9. `npx vitest run` — 318/318 must pass.
10. `npx playwright test tests/analytics tests/kiosks tests/locations tests/installations tests/smoke.spec.ts` — must pass.
11. Push branch. Configure Vercel preview env vars (DATABASE_URL=Neon dev, BETTER_AUTH_SECRET) per Phase 1 Task 2 pattern.
12. Wait for preview deployment.
13. Reset `pg_stat_statements` on dev.
14. `scripts/perf-measure.ts --url=<preview-url> --iterations=5 --out=test-results/phase-2-after.json`. Compare against `test-results/phase-1-1776760658/`. **Gate 2.**
15. Run `scripts/phase-1-measure.ts` to confirm pgss top-10 reshuffles as predicted (#1–#5 drop materially; #8 hotel-groups rises in rank since it's untouched).
16. Lockfile sync: `npm install --package-lock-only && npm ci --dry-run` — clean.
17. Open PR onto `optimisation`. Body includes before/after table, EXPLAIN deltas, links to JSON files in `test-results/`.
18. Address CI; user reviews; user merges.
19. **Discrete user action (not part of merge)**: prod apply via `vercel env pull --environment=production /tmp/wkg-prod.env && npx tsx --env-file=/tmp/wkg-prod.env scripts/phase-2-apply-indexes.ts --check && npx tsx --env-file=/tmp/wkg-prod.env scripts/phase-2-apply-indexes.ts --apply`.
20. Post-apply (passive observation): re-run pgss capture against prod after 24h of organic traffic; document deltas in a brief addendum.

### Gate 1 acceptance (local dev)

- New indexes visible in `pg_indexes`.
- EXPLAIN of `getPortfolioSummary` shows `Index (Only) Scan using sales_records_txn_loc_covering_idx`.
- EXPLAIN of `getOutletTiers` shows `Index Scan using kiosk_assignments_loc_assigned_idx` in the correlated subplan.
- No regression on EXPLAIN of #2, #3, #4, #7 (must use new index OR an equally-cheap existing one).

### Gate 2 acceptance (preview)

- Slowest single query in `fetchPortfolioData` `Promise.all` batch < 150 ms (target < 100 ms; baseline 280 ms).
- p95 portfolio page load drops by ≥ 25% vs Phase 1 baseline.
- No new query enters top 5 by `mean × calls` (proves we didn't pessimise something).
- Vitest still 318/318; Playwright analytics subset still passes.

### Gate failure handling

- **Gate 1 fail (planner didn't pick new index on dev)**: STOP. Re-EXPLAIN with `SET enable_seqscan = off` to see why. Possibly need ANALYZE or different INCLUDE columns. Do not proceed to Gate 2.
- **Gate 2 fail (perf didn't move)**: STOP. Either dev's 124k rows is too small for index to win on synthetic load, or the prediction was wrong. Re-evaluate before opening PR.
- **CI fail at step 16 (lockfile drift)**: fix per stored memory pattern (`@emnapi/*` from wasm32-wasi deps); retry.

## Decision log

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Phase 2 width | Items 1, 2, 4 (indexes + ANY-array rewrite) | Largest-impact moves; mechanical rewrite is low-risk and consistent with index work. Defers semantics-changing rewrites (#3, #5, #6) to Phase 3+ for clean attribution. |
| 2 | CONCURRENTLY mechanism | Standalone DDL script outside drizzle-kit + no-op marker migration | Assume sales_records grows to millions of rows → CONCURRENTLY required permanently. Drizzle-kit's transaction wrapper forbids it. Schema.ts stays source of truth; script handles prod safely; marker keeps fresh-DB bootstrap working. |
| 3 | Preflight on prod | `--check` mode prints row counts + EXPLAIN before `--apply` allowed | Dev's 124k-row EXPLAINs cannot predict prod plans at million-row scale. Pre-flight is mandatory; safety rail enforces it. |
| 4 | Item #4 scope | All 4 `sql.join` sites, not just the pgss-flagged one | Mechanical rewrite; consistency prevents future plan-cache drift between sibling queries. |
| 5 | Index naming | Long-form descriptive (`sales_records_txn_loc_covering_idx`) | Covering indexes are non-obvious from terse names; aids future operator grepping `pg_indexes`. |
| 6 | PR target | `optimisation`, not `main` | Per epic topology in Phase 2 handoff; final `optimisation`→`main` merge after all phases. |
| 7 | Prod application | Discrete user-confirmed action after PR merge | Modifies shared production system. Auto-mode rule: prod DDL is not auto. |
| 8 | Validation cadence | Two pre-PR gates (local EXPLAIN, preview perf) + passive post-prod observation | Reuses Phase 0/1 harness; `--check` provides prod readiness signal without DDL. |
| 9 | Test surface | New unit test for bind shape + reuse existing Playwright/Vitest | DDL has no Vitest surface; rewrite is narrow → focused test, not broad refactor. |
| 10 | Snapshot drift handling | Out of scope; document and skip `drizzle-kit generate` | Pre-existing condition. Don't expand Phase 2 scope to fix infra. |

## References

- Phase 1 diagnosis (top-10 ranking, EXPLAIN evidence, waterfall): `docs/plans/2026-04-21-phase-1-diagnosis.md`
- Phase 2 handoff (epic topology, setup state, measurement playbook): `docs/plans/2026-04-21-phase-2-handoff.md`
- Phase 1 baseline measurement artifacts: `test-results/phase-1-1776760658/`
- Source touch points:
  - `src/db/schema.ts` (salesRecords ~590, kioskAssignments ~201)
  - `src/lib/analytics/queries/high-performer-analysis.ts` (177, 193, 210, 227)
  - `src/lib/analytics/queries/portfolio.ts` (no edits; benefits from index)
  - `src/lib/analytics/queries/heat-map.ts` (no edits; benefits from index)
  - `src/lib/analytics/queries/shared.ts:80` (`kioskLiveDateSubquery`; no edits; benefits from index)
