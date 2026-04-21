# Phase 1 — Measurement & Diagnosis — Design

Date: 2026-04-21
Status: Approved (brainstorm), awaiting implementation plan
Parent initiative: `docs/plans/2026-04-21-db-performance-design.md`
Predecessor phase: Phase 0 (driver swap) merged to `optimisation` as PR #18

## Problem

Phase 0 shipped a driver swap with a measured −18% median p95 improvement on analytics pages. Phases 2–4 need a data-driven target list — but this is a pre-launch test app with no meaningful historical production traffic, so Vercel metrics and Neon query insights are effectively empty for real ranking. Measurement therefore requires synthetic load + short-term stats capture, not historical analysis.

Secondary constraint: `pg_stat_statements` is available on Neon but not installed by default on either the dev branch or prod. `vercel metrics` grouping by route requires Observability Plus (blocked). So the measurement stack has to be built around what's freely accessible: an extension we can enable on our own dev branch + Vercel function duration / count metrics without route grouping + direct EXPLAIN queries.

## Deliverable

One docs-only PR onto `optimisation`:

- `docs/plans/2026-04-21-phase-1-diagnosis.md` — the main output. Contains:
  - Top 10 queries by `mean_exec_time × calls` (from `pg_stat_statements`), each with source location, EXPLAIN (ANALYZE, BUFFERS) plan, proposed fix category (index / rewrite / de-N+1 / cache), and expected impact.
  - Top 10 routes by average function duration (from `vercel metrics`).
  - Full query waterfall for the single worst route, captured by code-tracing the server-component render tree.
  - Cross-reference table: each top query → the routes that call it → Phase 2 suggested order.

## Approach

### Scope (already confirmed with user: Deep — ~1 day)
- Not just "here's a ranked list" but EXPLAIN + code context + one full waterfall trace.
- Phase 2 starts from a concrete attack plan, not a re-discovery pass.

### Data source
- **Query stats:** `pg_stat_statements` enabled on the existing Neon dev branch (`ep-calm-sea-abn2ooob-pooler`). Extension is available; requires one-time `CREATE EXTENSION`.
- **Route stats:** `vercel metrics vercel.function_invocation.function_duration_ms` without grouping (free tier). Since traffic is synthetic and we control it, we can segment by time window instead of route-label grouping.
- **Query plans:** direct `EXPLAIN (ANALYZE, BUFFERS)` against the dev branch, run from a tsx one-shot. Plans written verbatim into the diagnosis doc.

### Load generation
- Vercel preview deploy with `DATABASE_URL` overridden to point at the dev branch (same env-add pattern used in Phase 0 Gate 3).
- Synthetic load: Playwright script that walks every page in `tests/` against the preview URL, with enough repetition per page to fill `pg_stat_statements`. Target: ≥200 executions per unique query, which is enough for stable `mean_exec_time` on n=20-sample fluctuations.
- Reuse of existing auth + navigation patterns; no new test framework.

### Steps (high level; detailed in implementation plan)

1. `CREATE EXTENSION pg_stat_statements` on the dev Neon branch.
2. Verify preview env for Phase 1 branch points at dev Neon; redeploy if needed.
3. Run synthetic load script.
4. Pull `pg_stat_statements` → rank → export top 10 queries.
5. For each top query: grep source → locate call site → `EXPLAIN` → record.
6. Pick the route with the worst aggregate duration. Trace its full server-component tree. Enumerate every query it issues and the order/fan-out.
7. Compose diagnosis doc.
8. Open PR → `optimisation` (docs-only, no code changes in `src/`).

## Non-goals

- No fixes. Diagnosis only. Temptation to implement an obvious one-liner during investigation should be parked in the diagnosis doc for Phase 2 to action.
- No application code changes — the load-test harness is a new `scripts/` entry, not production code.
- No installing `pg_stat_statements` on prod. Only the dev branch is touched.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `pg_stat_statements` captures queries from other dev-branch activity (my earlier test runs, background jobs) | Run `pg_stat_statements_reset()` immediately before the load run to start from a clean slate. |
| Synthetic load doesn't mirror real usage shape | Document the distribution in the diagnosis; flag that Phase 2 priorities are approximations until prod has organic traffic. |
| EXPLAIN on an empty/sparse dev branch gives misleading plans (sequential scan preferred even when index would win in prod) | If `duplicate_dismissals` or any low-cardinality table skews plans, seed a realistic row count on the dev branch first. Check EXPLAIN against the `work_mem` / `shared_buffers` sizing on dev vs prod. |
| `pg_stat_statements` has a query-text length limit (default 1024 bytes) — long analytics queries may be truncated | Set `pg_stat_statements.track = 'all'` at session level; increase `pg_stat_statements.track_activity_query_size` if the extension is newly enabled. |
| Time window between reset and query ranking includes my own tracing queries (EXPLAINs, metadata lookups) | Run load first, capture snapshot, then do EXPLAINs — tracing queries accumulate in a separate measurement window the diagnosis doc ignores. |

## Validation

Phase 1 is complete when:

- Diagnosis doc exists with ≥10 ranked queries, each with EXPLAIN plan + proposed fix category.
- ≥1 full route waterfall traced.
- PR opened onto `optimisation`.
- Independent reviewer can read the diagnosis and start implementing Phase 2 without asking me what "that query" means.

## Out of scope for design doc

- Exact Playwright load-test structure (goes in implementation plan).
- Decision on whether to keep `pg_stat_statements` permanently enabled on dev (park for Phase 2 or later).
- Fix decisions per query (that's Phase 2).

## Next step

Invoke writing-plans skill to produce `docs/plans/2026-04-21-phase-1-measurement-plan.md` — the executable task breakdown.
