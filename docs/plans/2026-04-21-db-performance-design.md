# DB Performance Optimization — Design

Date: 2026-04-21
Status: Approved (brainstorm), awaiting implementation plan

## Problem

App feels sluggish. No concrete incident, but `src/db/index.ts` uses `postgres-js` with `max=10` in production against Neon on Vercel serverless — a known anti-pattern that causes connection exhaustion under burst and adds TCP/TLS handshake cost to cold starts. Beyond the driver, we have 46 pages of server components with no profiling pass applied; likely N+1s, missing indexes, and ad-hoc caching opportunities exist but are unmeasured.

## Approach

Profile first, then hardening pass. Five phases, each independently shippable. Phase 0 is structural (driver); Phases 1+ are data-driven, shaped by Neon query insights and Vercel observability.

### Phase 0 — DB driver swap (this plan)
Replace `postgres-js` with `@neondatabase/serverless` (WebSocket Pool) via `drizzle-orm/neon-serverless` on the request path. Retain `postgres-js` for scripts, migrations, and seed runners.

### Phase 1 — Measure
No code changes. Rank top 10 offenders from Neon query insights × Vercel function durations (`p95 × call count`). Output: a ranked backlog.

### Phase 2 — Fix the top 10
Per offender: EXPLAIN → pick the fix (index, query rewrite, de-N+1 via Drizzle `with`, batched loader). Each change verified before/after.

### Phase 3 — Opportunistic caching
`React.cache` per-request for stable reads (markets, pipeline stages, kiosk lists). `unstable_cache` cross-request for truly static lookups. Vercel KV only if a specific hot endpoint justifies it.

### Phase 4 — Materialized views
Only if dashboard aggregates remain slow after Phase 2.

---

## Phase 0 — Detailed Design

### Architecture

- **Before:** `drizzle-orm/postgres-js` + `postgres` client, `max=10` pool per lambda instance.
- **After:** `drizzle-orm/neon-serverless` + `@neondatabase/serverless` `Pool` (WebSocket).

WebSocket Pool is chosen over the HTTP driver because the codebase uses `db.transaction(...)` at 4 call sites (3 in `src/app/(app)/settings/data-import/sales/pipeline.ts`, 1 in `src/lib/commission/processor.ts`) and many server components issue multiple serial queries per render. HTTP driver forbids transactions and pays a round-trip per query; Pool multiplexes over persistent WebSocket connections with full Drizzle transaction support.

### File-level changes

**Changed:**
- `src/db/index.ts` — driver swap + env-driven fork (see "Dev environment" below).

**Unchanged (zero call-site edits):**
- 55 files importing `{ db }` from `@/db`. Drizzle query/transaction API is identical across drivers.
- `src/db/schema.ts`.
- Seed scripts (`src/db/seed*.ts`), import scripts (`scripts/import-*.ts`), `drizzle.config.ts` — these keep `postgres-js`.

**New:**
- `package.json` — add `@neondatabase/serverless`, add `ws` (dev). Retain `postgres` (still required by scripts).

**Type note:** `AnyDb` alias at `src/app/(app)/settings/data-import/sales/pipeline.ts:108` may need a one-line union update. Verified during implementation; if no change needed, no edit.

### Dev environment strategy

Option A (chosen): env-driven driver switch inside `src/db/index.ts`.

- `DATABASE_URL` contains `neon.tech` → `neon-serverless` Pool.
- Otherwise → `postgres-js` (local Postgres, CI testcontainers).

Single file, one conditional. Exported `db` typed as the union of both driver instances so the 55 consumers compile unchanged. CI's existing `@testcontainers/postgresql` setup is untouched.

### Verification gates

Merge is blocked until all three gates pass.

**Gate 1 — Functional parity (local):**
- `npm run build` clean, no type drift.
- Vitest suite passes.
- Playwright headless against local Postgres (proves the `postgres-js` branch still works).
- Playwright headless against a Neon dev branch (proves the new driver works including transactions).

**Gate 2 — Transaction-specific smoke:**
- Trigger a commission run (`src/lib/commission/processor.ts:281`).
- Run a small sales CSV import end-to-end (`src/app/(app)/settings/data-import/sales/pipeline.ts:108,245,348`).
- Assert: data lands correctly; a forced mid-transaction error rolls back cleanly (throwaway test case added and removed).

**Gate 3 — Performance (preview deploy vs `main`):**
- Vercel preview branch points at a Neon branch seeded from prod.
- Playwright hits the six smoke-tested pages (heatmap, hotel-groups, installations-calendar, kiosks, locations, portfolio) 20× each, records function duration from Vercel response headers.
- Acceptance:
  - p95 function duration does not regress by more than 5% on any page.
  - p95 improves on at least 3 of 6 pages.
  - Neon active connection count under synthetic load stays well below the prior `max=10 × lambda` ceiling.
- If the workload regresses on most pages, halt and re-evaluate — WebSocket Pool may not fit this workload shape.

### Rollback

Single-commit revert. No migrations, no schema changes, no data changes.

### Out of scope (Phase 0)

- Query rewrites, index additions, N+1 fixes — Phase 2.
- Caching — Phase 3.
- Edge runtime / materialized views — Phase 4.
- Touching seed/import scripts — they keep `postgres-js`.

### Open questions

None blocking. `ws` shim necessity on Vercel's current Node runtime will be confirmed during Gate 1 (if the global `WebSocket` is present, the shim is dead code and removed).
