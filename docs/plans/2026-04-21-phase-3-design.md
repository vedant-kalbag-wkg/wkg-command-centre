# Phase 3 — Design

Date: 2026-04-21
Parent initiative: `docs/plans/2026-04-21-db-performance-design.md`
Predecessor: Phase 2 (`docs/plans/2026-04-21-phase-2-design.md`, merged as PR #20; prod indexes applied 2026-04-21)
Branch: `perf/phase-3-caching-and-streaming`
PR target: `optimisation` (final epic merge to `main` happens after this phase lands)

## Goal

Collapse the user-perceived latency of `/analytics/*` pages by removing the data-fetch from the critical render path. Phase 2 made queries fast (40-81% drops on five of six top portfolio queries) but left p95 client-load essentially flat at ~1318 ms because Vercel cold-start, React hydration, and network now dominate the page. Phase 3 attacks that dominant overhead via two complementary mechanisms:

1. **Per-day cached query results** — most analytics consumers don't need sub-day freshness; sales data lands once per night via the overnight UK ETL.
2. **Suspense-based RSC streaming** — start painting the page within ~100 ms instead of blocking on data fetches; data islands stream in as they resolve.

Combined, the user sees a populated page within ~300 ms p95 on warm cache (4.4× improvement over the Phase 2 baseline) and a streamed shell within ~100 ms TTFB even on cold cache.

## Scope

### In scope (Phase 3)

Caching plus Suspense streaming applied to all nine heavy analytics pages:

- `/analytics/portfolio` (pilot — proves the pattern)
- `/analytics/hotel-groups`
- `/analytics/regions`
- `/analytics/heatmap`
- `/analytics/location-groups`
- `/analytics/maturity`
- `/analytics/trend-builder`
- `/analytics/pivot`
- `/analytics/compare`

Plus an admin escape hatch (`/admin/cache`) for manual cache purge with audit logging.

### Out of scope (deferred)

- **Approach B — ETL-aligned cron invalidation.** Vercel Cron firing post-ETL to call `revalidateTag('analytics')`, plus optional pre-warming. Defer until the ETL/ingestion pipeline is formalised so cron timing can be tied to a deterministic completion signal.
- **Materialised views** for stable per-day aggregates. Defer until ETL is reliable and we know which aggregates are genuinely stable in prod.
- **Full RSC conversion** of the analytics tree (push `"use client"` to leaf interactives, shrink the JS bundle). Contingent on rebuilding the table/view-engine to be RSC-friendly — multi-week project, not the current bottleneck.
- **Snapshot drift in `migrations/meta/`** — pre-existing, blocks `drizzle-kit generate` until resolved.
- **Partial index on `sales_records.transaction_time IS NOT NULL`** — needs prod data-shape validation first.
- **`buildWhere` helper consolidation** in `location-revenues.ts` and `high-performer-analysis.ts` — currently duplicated to avoid a circular dep.
- **Per-developer Neon branch sync workflow** for local dev.
- **Real-time analytics** (push-based updates) — different problem class.

## Architecture

```
┌─────────────────────────┐
│  /analytics/<page>      │  RSC (Server Component)
│   page.tsx              │
└──────────┬──────────────┘
           │ resolves filters, scopeKey, activeLocationIds
           │ then renders Suspense boundaries around data islands
           ▼
┌─────────────────────────┐
│  Data island (server)   │  KpiTiles, Tables, Chart — server components
│  Promise.all of N        │
└──────────┬──────────────┘
           │ each query is wrapped in unstable_cache
           ▼
┌─────────────────────────────────────────────┐
│  unstable_cache(getQueryUncached, …)(args)  │ ← NEW
│  cache key = {query, filters, scopeKey}     │
│  ttl = 86400s, tags = [analytics, ...]      │
└──────────┬──────────────────────────────────┘
           │ miss → execute, cache result
           ▼
┌─────────────────────────┐
│  Phase 2 query layer    │  sql.param, active_locations, indexes — UNCHANGED
│  → Neon                 │
└─────────────────────────┘
```

**Key choices fixed by the brainstorming Q&A:**

- **Cache layer placement:** wraps individual query functions, not the page or `Promise.all` batch. One slow tile doesn't poison the whole page's cache.
- **Cache backend:** Vercel platform cache (default backing for `unstable_cache`). No Redis, no Vercel KV, no extra infra.
- **TTL:** 86400 s (24 h). Aligned with the once-a-day overnight UK ETL.
- **Scope split:** internal `(app)` users collapse to `'__internal__'` (one shared cache entry per filter combo). External `portal/*` users (when the portal lands) get a sha1 hash of their accessible location IDs.
- **Streaming:** Suspense-only, broad. Page shell + filter bar paint immediately; KPI tiles, tables, charts stream in as their data resolves. No full RSC conversion.

**What does not change:** Phase 2's `sql.param`, `active_locations` helper, hotel-groups CTE, and the covering indexes on prod. They run on cache misses.

## Cache key design

```ts
unstable_cache(
  async (filters: CanonicalFilters, scopeKey: string, activeLocationIds: string[]) => { /* query */ },
  ['analytics', 'getPortfolioSummary', 'v1'], // keyParts
  {
    revalidate: 86400,
    tags: ['analytics', 'analytics:portfolio'],
  },
)(filters, scopeKey, activeLocationIds);
```

Effective cache key: `keyParts + JSON.stringify(args)`.

**`scopeKey` resolution** (`src/lib/analytics/cache-scope.ts`):

```ts
export async function getCacheScopeKey(): Promise<string> {
  const session = await requireRole('admin', 'member', 'external');
  if (session.user.kind === 'external') {
    const ids = await getActiveLocationIds(); // already React.cache'd per-request
    return `ext:${createHash('sha1').update(ids.sort().join(',')).digest('hex').slice(0, 16)}`;
  }
  return '__internal__';
}
```

**Filter canonicalisation** (`src/lib/analytics/canonicalise-filters.ts`) — required because key derivation is purely textual:

```ts
function canonicaliseFilters(f: AnalyticsFilters): CanonicalFilters {
  return {
    dateFrom: f.dateFrom?.toISOString().slice(0, 10) ?? null, // yyyy-mm-dd, drop time
    dateTo:   f.dateTo?.toISOString().slice(0, 10)   ?? null,
    hotelGroups:    [...(f.hotelGroups ?? [])].sort(),
    locationGroups: [...(f.locationGroups ?? [])].sort(),
    regions:        [...(f.regions ?? [])].sort(),
    // ...all other filters, sorted/normalised
  };
}
```

Relative date ranges (e.g. "Last 7 days") canonicalise to absolute dates *as of request time*. The cache key naturally rolls forward at midnight UK because the resolved end-date changes — exactly what we want for per-day TTL alignment.

**Version sentinel (`'v1'`)** — bump to `'v2'` if a query's output shape changes, to force invalidation without waiting for TTL.

## Implementation pattern

For each cached query, two exports from the same file:

```ts
// src/lib/analytics/queries/portfolio.ts (example)

// Uncached body — kept exported for vitest unit tests and direct callers
// (CSV exports, scheduled jobs) that must bypass the cache.
export async function getPortfolioSummaryUncached(
  filters: CanonicalFilters,
  scopeKey: string,
  activeLocationIds: string[], // resolved by caller (NOT inside cache fn)
) {
  // existing Phase 2 query body — unchanged
}

// Cached export — what page.tsx imports.
export const getPortfolioSummary = unstable_cache(
  getPortfolioSummaryUncached,
  ['analytics', 'getPortfolioSummary', 'v1'],
  { revalidate: 86400, tags: ['analytics', 'analytics:portfolio'] },
);
```

**Why explicit threading of `scopeKey` + `activeLocationIds`:** `unstable_cache` runs *outside* the request scope. Inside the cached function, `cookies()`, `headers()`, `auth()` etc. are unavailable. Threading the request-scoped values as explicit arguments is structurally enforced by the function signature — TypeScript won't let you forget. This is verbose at call sites (~45 across the 9 pages) but eliminates the most common caching bug class.

**Call site (the page):**

```tsx
// src/app/(app)/analytics/portfolio/page.tsx
export default async function PortfolioPage({ searchParams }) {
  const rawFilters = parseFiltersFromSearchParams(searchParams);
  const filters = canonicaliseFilters(rawFilters);
  const scopeKey = await getCacheScopeKey();
  const activeLocationIds = await getActiveLocationIds();

  return (
    <PageShell>
      <PageHeader title="Portfolio" />
      <FilterBar filters={rawFilters} />

      <Suspense fallback={<KpiTilesSkeleton />}>
        <ErrorBoundary fallback={<DataIslandError section="KPIs" />}>
          <KpiTiles {...{ filters, scopeKey, activeLocationIds }} />
        </ErrorBoundary>
      </Suspense>

      <Suspense fallback={<HighPerformerTablesSkeleton />}>
        <ErrorBoundary fallback={<DataIslandError section="High performers" />}>
          <HighPerformerTables {...{ filters, scopeKey, activeLocationIds }} />
        </ErrorBoundary>
      </Suspense>

      <Suspense fallback={<TrendChartSkeleton />}>
        <ErrorBoundary fallback={<DataIslandError section="Trends" />}>
          <TrendChart {...{ filters, scopeKey, activeLocationIds }} />
        </ErrorBoundary>
      </Suspense>
    </PageShell>
  );
}

// KpiTiles is a SERVER component — does the await
async function KpiTiles({ filters, scopeKey, activeLocationIds }) {
  const [summary, topProducts, categories] = await Promise.all([
    getPortfolioSummary(filters, scopeKey, activeLocationIds),
    getTopProducts(filters, scopeKey, activeLocationIds),
    getCategoryPerformance(filters, scopeKey, activeLocationIds),
  ]);
  return <KpiTilesUI summary={summary} topProducts={topProducts} categories={categories} />;
}
```

**Cached query coverage** (enumerated by file in the implementation plan):

| Page | Query files |
|------|-------------|
| `/analytics/portfolio` | `portfolio.ts`, subset of `hotel-groups.ts`, `location-revenues.ts` |
| `/analytics/hotel-groups` | `hotel-groups.ts` (full) |
| `/analytics/regions` | `regions.ts` |
| `/analytics/heatmap` | `heatmap.ts` |
| `/analytics/location-groups` | `location-groups.ts` |
| `/analytics/maturity` | `maturity.ts` |
| `/analytics/trend-builder` | `trends.ts` |
| `/analytics/pivot` | `pivot.ts` |
| `/analytics/compare` | `compare.ts` |
| Shared | `high-performer-analysis.ts` (4 internal helpers) |

**Not wrapped:** mutations, audit log writes, CSV export endpoint (always fresh), scheduled-job endpoints, auth/session resolution. The `active_locations` helper itself is left React.cache'd-per-request from Phase 2 — that's the right scope because it's used by both cached and uncached paths.

## Suspense / streaming layout

**Granularity rule:** one `<Suspense>` per visual section (KPI tile row, table, chart). Not per query (chatty), not per page (defeats streaming).

**Skeleton contract:**

- Pixel-faithful — same width and height as resolved content. Zero CLS.
- Reuse the existing `<Skeleton>` shadcn primitive at `src/components/ui/skeleton.tsx`.
- Each skeleton lives next to the data island it wraps (e.g. `src/components/analytics/portfolio/kpi-tiles-skeleton.tsx`).

**Per-island error boundary:** each `<Suspense>` is paired with an `<ErrorBoundary>` whose fallback is `<DataIslandError section={…}>` — a small inline error card with section name, "Retry" button, and a quiet log. One broken section never blanks out the whole page.

**Effort estimate per page** (sequenced light-to-heavy in the rollout):

- Convert `page.tsx` to Suspense islands: ~30 min
- Extract data-island server components (typically 2–4 per page): ~30 min
- Build pixel-faithful skeletons: ~20 min (depends on complexity)
- Update existing client components to receive data via props (vs hook-fetch): variable

## Invalidation & admin escape hatch

**Primary mechanism:** TTL (24 h). Most invalidation needs are met by this.

**Secondary mechanism:** tag-based purge for emergencies (ETL ran with bad data; CSV re-import; deployed schema change).

**Server action** (`src/app/(app)/admin/cache/actions.ts`):

```ts
'use server';
export async function purgeAnalyticsCache(scope: 'all' | AnalyticsPageTag = 'all') {
  const session = await requireRole('admin');
  const tag = scope === 'all' ? 'analytics' : `analytics:${scope}`;
  revalidateTag(tag);
  await writeAuditLog({
    actorId: session.user.id,
    actorName: session.user.name,
    entityType: 'cache',
    entityId: tag,
    action: 'purge',
  });
  return { success: true, tag };
}
```

**Admin UI** (`src/app/(app)/admin/cache/page.tsx`):
- "Refresh all analytics" primary button → `purgeAnalyticsCache('all')`
- Per-page dropdown for finer-grained purge → `purgeAnalyticsCache('portfolio')` etc.
- Last-purged timestamp + actor (read from audit log)
- UI copy: *"Cached analytics refresh automatically every 24 hours. Use this only when ETL data has been corrected or a customer is asking why a number looks stale."*

**Permissions:** `requireRole('admin')` on the server action; `/admin/cache` route gated by existing admin middleware.

**Audit:** every purge writes `entityType: 'cache'`, `action: 'purge'` to the existing `audit_log` table.

**Tags taxonomy:**

| Tag | Invalidates |
|-----|-------------|
| `analytics` | All cached analytics queries on any page |
| `analytics:portfolio` | All queries used by `/analytics/portfolio` |
| `analytics:hotel-groups` | `/analytics/hotel-groups` |
| `analytics:regions` | `/analytics/regions` |
| `analytics:heatmap` | `/analytics/heatmap` |
| `analytics:location-groups` | `/analytics/location-groups` |
| `analytics:maturity` | `/analytics/maturity` |
| `analytics:trend-builder` | `/analytics/trend-builder` |
| `analytics:pivot` | `/analytics/pivot` |
| `analytics:compare` | `/analytics/compare` |

Each cached function declares the `analytics` tag plus its page-specific tag. A query used by multiple pages (e.g. `getHotelGroupsList` used by both portfolio and hotel-groups) declares both page tags so a single-page purge invalidates correctly. UI copy flags this for users ("Refreshing portfolio also refreshes any shared queries used by other pages").

## Error handling

| Class | Mechanism |
|-------|-----------|
| **DB query fails on cache miss** | `unstable_cache` does not cache thrown errors. Per-island `<ErrorBoundary>` catches; `<DataIslandError>` shows inline retry. Other islands keep working. |
| **Stale cache after schema change** | PR template checkbox ("if you changed an analytics query's output shape, bump the version sentinel"). Vitest contract test snapshots each cached query's output keys; fails if shape changes without sentinel bump. |
| **`unstable_cache` infrastructure fails** | Wrap call site in try/catch that falls back to the uncached variant: `try { return await getX(...) } catch (e) { if (isCacheInfraError(e)) return getXUncached(...); throw e; }`. |
| **Streaming connection breaks mid-flight** | Framework concern. User reloads on reconnect. No phase-3-specific handling. |
| **Auth session expires inside `getCacheScopeKey`** | Throws outside the Suspense tree — caught by route-level `error.tsx` / middleware redirect to `/login`. Same as today. |
| **Thundering herd at midnight** | `unstable_cache` deduplicates concurrent calls within a single Vercel instance. Across instances, the first ~N requests after TTL expiry rebuild concurrently. Acceptable: cache-miss cost is 37–150 ms; bounded internal-user concurrency. If real, add an in-process promise-coalescing map. |

**Observability:** structured logs for `analytics_cache_event` covering `infra_failure`, `shape_mismatch`, and `unexpected_miss`. Searchable in Vercel logs.

## Measurement methodology

**Five metrics:**

| # | Metric | Where measured | Phase 2 baseline | Phase 3 target |
|---|--------|----------------|------------------|----------------|
| 1 | Warm-load client p95 (cache hit) | Playwright NavigationTiming | 1318 ms | **≤ 300 ms** |
| 2 | Cold-load client p95 (cache miss) | Playwright NavigationTiming | 1318 ms | **≤ 1400 ms** (no regression) |
| 3 | TTFB | Playwright `responseStart - fetchStart` | ~150 ms | **≤ 100 ms** |
| 4 | Cache hit rate | DB-level via `pg_stat_statements` `calls` deltas | n/a | **≥ 70%** within 1 week |
| 5 | No regression in other pages | Same harness, all 9 pages | per-page baselines (new pre-deploy run) | within 10% of baseline |

**Workflow:**

1. **Baseline pre-Phase-3.** Build a Vercel preview of current `optimisation` HEAD (Phase 2 + handoff, no Phase 3). Point at Neon dev. Run `perf-measure` n=20 per page across all 9. Commit to `test-results/phase-3-baseline-<timestamp>.json`.
2. **Instrument hit/miss in dev.** `withStats(name, fn)` wrapper times each cached call; entries < 10 ms → hit, > 30 ms → miss. Heuristic but adequate for "is the cache hitting?" sanity. Off in production by default.
3. **Post-deploy:**
   - **T+0:** Playwright loops each page twice (cold, then warm) and reports both p95.
   - **T+24h:** `pg_stat_statements` snapshot. Compare `calls` for analytics queries vs the prior week. ~95% drop → ~95% hit rate.
   - **T+1 week:** prod p95 from RUM if available, otherwise pgss `calls` delta as proxy.

**Acceptance gates (PR-blocking):**

- **A.** Warm-load client p95 ≤ 300 ms on `/analytics/portfolio`. Primary commitment.
- **B.** Cold-load client p95 ≤ 1400 ms on `/analytics/portfolio`. Proves we didn't regress the slow path.
- **C.** TTFB ≤ 100 ms on every analytics page. Proves Suspense actually streams.
- **D.** Cache hit rate ≥ 70% in the first week of prod traffic. Proves per-day TTL + scope key choice was right.
- **E.** No analytics page's cold-load p95 increases by more than 10% vs its pre-deploy baseline.

## Testing strategy

| Layer | Where | Catches |
|-------|-------|---------|
| **Unit (vitest)** | `src/lib/analytics/__tests__/canonicalise-filters.test.ts`, `cache-scope.test.ts` | `canonicaliseFilters` stability across timezones / key orders / null handling; `getCacheScopeKey` internal/external split + hash determinism |
| **Output-shape contract (vitest)** | `src/lib/analytics/__tests__/cached-query-shapes.test.ts` | Schema changes that would silently corrupt cached payloads (forces version sentinel bump) |
| **Cache correctness (vitest, hits Neon dev)** | `src/lib/analytics/__tests__/cache-correctness.test.ts` | `getX(args) === getXUncached(args)` on cold call. Catches accidental side effects depending on request context inside cached fns. |
| **E2E streaming (Playwright remote)** | `tests/analytics/phase-3-streaming.spec.ts` | Shell + filter bar visible within 200 ms of navigation, *before* data islands resolve |
| **E2E warm-load (Playwright remote)** | `tests/analytics/phase-3-cache-hit.spec.ts` | After priming load, second load surfaces all data islands within 500 ms |
| **E2E purge (Playwright remote)** | `tests/analytics/phase-3-cache-purge.spec.ts` | Admin → `/admin/cache` → "Refresh portfolio" → audit row appears → next load shows skeleton briefly |
| **Performance** | `scripts/perf-measure-phase-3.ts` (extension of Phase 2's script) | Cold + warm p95 + TTFB per page; produces PR-body markdown table |

**Not tested:** Vercel platform cache internals; `unstable_cache` request-dedup; TTL countdown precision; pixel-diff snapshots of skeleton fidelity (Playwright streaming spec asserts skeleton position matches resolved-content position — adequate proxy for zero-CLS).

**TDD posture:** implementation plan sequences these red-first per task. Order: `canonicaliseFilters` test → impl, `getCacheScopeKey` test → impl, per cached query (shape → correctness → wrap), per page (streaming spec → restructure), purge UI test-first.

## Rollout / migration order

**Branch + PR shape (matches Phase 0/1/2):**

- Branch `perf/phase-3-caching-and-streaming` off current `optimisation`.
- One PR at the end against `optimisation`.
- Once merged, recreate the `optimisation → main` roll-up PR (the one closed when Phase 3 started) with cumulative Phase 0+1+2+3 wins documented.

**Five stages within the branch:**

### Stage 1 — Foundation (no user-visible change)

Single commit:
- `src/lib/analytics/canonicalise-filters.ts` + tests
- `src/lib/analytics/cache-scope.ts` + tests
- `src/lib/analytics/cache-stats.ts` (the `withStats` wrapper)
- `src/components/analytics/data-island-error.tsx`
- `src/components/analytics/skeletons/index.ts`

### Stage 2 — Pilot on `/analytics/portfolio` (the canary)

Single commit:
- Wrap `portfolio.ts` queries (`getPortfolioSummary`, `getTopProducts`, `getCategoryPerformance`, `getDailyTrends`, `getOutletTiers`) in `unstable_cache`
- Restructure `src/app/(app)/analytics/portfolio/page.tsx` into Suspense islands with per-island error boundaries
- Add pixel-faithful skeletons
- Add streaming + warm-load + correctness specs

**Pilot validation gate (BLOCKING):** run `perf-measure` n=20 against preview. If warm p95 > 300 ms on portfolio, **STOP** — diagnose before generalising. Cheaper to rip up the design now than to ship half a Phase 3.

### Stage 3 — Generalise to the other 8 pages

One commit per page, light-to-heavy:

1. `/analytics/regions`
2. `/analytics/maturity`
3. `/analytics/heatmap`
4. `/analytics/location-groups`
5. `/analytics/hotel-groups` (verify cross-purge tag taxonomy with portfolio)
6. `/analytics/compare`
7. `/analytics/pivot`
8. `/analytics/trend-builder`

Each commit follows the portfolio template. Per-page validation: Playwright streaming + warm-load spec.

### Stage 4 — Admin purge UI

Single commit:
- `src/app/(app)/admin/cache/page.tsx` with per-page purge dropdown
- `src/app/(app)/admin/cache/actions.ts` (`purgeAnalyticsCache`)
- `entityType: 'cache'` audit log entry
- Playwright purge spec

### Stage 5 — Final measurement + summary commit

Single commit:
- Run extended `perf-measure-phase-3.ts` n=20 across all 9 pages
- Capture cold + warm p95 + TTFB
- Write to `test-results/phase-3-after-final.json`
- Update this design doc's measurement table with actual numbers (replace TBD placeholders)

**Rollback per stage:**

| Stage | Back-out |
|-------|----------|
| 1 | Revert commit. No user impact. |
| 2 | Revert portfolio commit. Other pages unaffected. |
| 3 | Revert failing page's commit. Other cached pages keep working. |
| 4 | Revert admin route. Cache continues on TTL only. |
| 5 | n/a — measurement only. |

If Phase 3 needs to be ripped wholesale post-merge: revert the squash-merged PR. `unstable_cache` wrappers disappear; queries call uncached paths directly; pages re-await sequentially; performance returns to Phase 2 baseline. No data corruption risk because nothing here writes.

**Prod deployment:**

1. PR merged to `optimisation`
2. Open new `optimisation → main` PR with cumulative Phase 0+1+2+3 wins
3. Merge to `main` → Vercel auto-deploys
4. Cache starts cold, warms within minutes
5. T+24h: pgss snapshot → hit rate
6. T+1 week: gate D decisively assessable

**No additional prod ops needed.** Unlike Phase 2's `--apply` script, there's nothing to run against prod. The cache infra is Vercel-managed and bootstraps on first request.

## Open follow-ups (after Phase 3 ships)

These belong to future phases:

- **Phase 4 — ETL-aware caching.** Wire Vercel Cron post-ETL to call `purgeAnalyticsCache('all')`. Lifts the post-midnight cold-rebuild cost. Requires formalised ETL pipeline.
- **Phase 5 — Pre-warming.** Bot follows the post-ETL purge with hits to common filter combos so first real users hit warm cache.
- **Phase 6 — Materialised views** for genuinely-stable aggregates.
- **Phase 7 — Full RSC conversion.** Push `"use client"` to leaf interactives once view-engine is RSC-friendly. Bundle-size win.

Plus the carry-over Phase-2 follow-ups: `migrations/meta/` snapshot drift, `transaction_time` partial index, `buildWhere` consolidation, per-developer Neon branch sync, Name-column inline-edit UI restructure.
