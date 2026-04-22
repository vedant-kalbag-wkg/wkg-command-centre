# Phase 3 addendum — RSC migration scope expansion

**Date:** 2026-04-22
**Supersedes:** Stage 2 and Stage 3 of `docs/plans/2026-04-21-phase-3-plan.md`
**Triggered by:** orientation in Task 2.1 revealed the original plan assumed all 9 analytics pages were already RSC. They aren't — every `/analytics/*/page.tsx` is a client component fetching via server actions. A Suspense-streaming architecture requires converting each page from client → RSC first. User chose Path B (do the RSC migration now) over Path A (cache-only) and Path C (cache + defer RSC).

## What stays from the original plan

- **Stage 1 primitives (already shipped):** `canonicaliseFilters`, `getCacheScopeKey`, `withStats`, `DataIslandError`, skeletons barrel — all five commits stand, all usable as-is.
- **Stage 4:** admin purge UI at `/admin/cache` — unchanged scope.
- **Stage 5:** perf-measure extension + final measurement + PR — unchanged.

## What changes

### Filter state — no change needed

The existing filter bar at `src/components/analytics/filter-bar.tsx` already:
- Hydrates Zustand store from URL `searchParams` on mount
- Writes `searchParams` back on state change

So URL is already a source of truth for filters. RSC pages can read `searchParams` directly via the `{ searchParams }` prop. Zustand store stays for the filter bar's own interactive state.

### Per-page template (replaces original Stage 2 + Stage 3)

For each of the 9 analytics pages:

1. **Split** `page.tsx` into:
   - A server component (default export) that receives `{ searchParams }`, parses filters, and renders Suspense-wrapped data islands
   - Client islands for interactive pieces: comparison-mode toggle, flags drawer, threshold editor, event-category toggles. Each reads/writes URL params via the existing `useRouter`/`useSearchParams` pattern.

2. **Parse filters** from `searchParams` via a new helper `parseAnalyticsFiltersFromSearchParams(sp)` — returns a full `AnalyticsFilters` with sensible defaults when params are absent (default date preset: `last-year`, empty arrays for dimensions).

3. **Per data island server component** — e.g. `KpiStrip`, `HighPerformerPatternsCard`, `DailyTrendsCard`. Each awaits its own cached query directly. No more `fetchPortfolioData` orchestrator on the critical path — the orchestrator's silent-catch wrapping is replaced by per-island `<ErrorBoundary fallback={<DataIslandError section="..." />}>`.

4. **Cache layer**: wrap each query function in `src/lib/analytics/queries/*.ts` with `unstable_cache(withStats(queryFn), [...keyParts], { revalidate: 86400, tags: ['analytics', 'analytics:<page>'] })`. Key parts are the canonicalised filters + scope key (from `getCacheScopeKey`) + active location IDs (from `getActiveLocationIds`).

5. **Query signatures.** Current queries take `(filters: AnalyticsFilters, userCtx: UserCtx, ...)`. We wrap them so the cache-key derivation uses the canonical filters + scope key, but the underlying DB query body continues to receive `userCtx` for RBAC. The wrapper is responsible for deriving those from the canonical pieces. Net change per query fn: rename existing export to `*Uncached`, add new wrapped export with the same name as before.

6. **Skeletons**: pixel-faithful per-island fallbacks in `src/components/analytics/<page>/skeletons/` re-exported from the barrel. Dimensions match the real components to prevent CLS.

7. **Playwright specs per page**: one streaming spec (filter bar paints before data), one warm-load spec (second nav < 1500 ms). Run against the Vercel preview.

### Page order (light → heavy)

Same as the original plan, modulo naming:

1. `/analytics/portfolio` — pilot. BLOCKING gate after this page: warm p95 ≤ 300 ms.
2. `/analytics/regions`
3. `/analytics/maturity`
4. `/analytics/heat-map` (original plan said `heatmap` — real path has a hyphen)
5. `/analytics/location-groups`
6. `/analytics/hotel-groups`
7. `/analytics/compare`
8. `/analytics/pivot-table` (original plan said `pivot`)
9. `/analytics/trend-builder`

### Scope-out (deferred past Phase 3)

- **Server action retirement**: existing `actions.ts` files per page can remain for mutations (flag creation, threshold writes, action-item CRUD). Data-fetching server actions (`fetchPortfolioData`, `fetchHighPerformerPatterns`, etc.) become dead code once pages migrate — delete in a follow-up sweep, not in-line per page, to keep diffs small.
- **`comparisonMode`, `thresholdConfig`, active event categories**: promote to URL params in-line per page. If promotion turns out to be invasive for a given page, keep that toggle client-side with a `router.refresh()` on change — still benefits from the cache.

## Gates

- **After portfolio (pilot)**: vitest green, Playwright streaming+warm-load pass, perf-measure warm p95 on `/analytics/portfolio` ≤ 300 ms. If miss → stop, diagnose, don't generalise.
- **After all 9 pages**: same as original plan.
- **Stage 4 (admin purge)**: unchanged.
- **Stage 5 (measurement + PR)**: unchanged.

## Risk register

- **URL-param bloat**: filter set is already ~6 dimensions × n-ids; adding comparison mode, event categories etc. could push URL past practical limits. Mitigation: if a page's URL grows unreasonable, keep that specific knob client-side with `router.refresh()` after change — same cache benefit, slight UX hit on reload.
- **Client-component regression**: interactive features (ThresholdEditor, flags drawer, abortable fetches) could break subtly when carved out of the monolithic page. Mitigation: each page's extracted client island gets its own unit test + Playwright smoke.
- **Filter-bar/store divergence**: if the filter bar writes a filter shape the server's search-params parser doesn't recognise (e.g. a new dimension is added to the bar but not the parser), pages silently drop that filter. Mitigation: shared `parseAnalyticsFiltersFromSearchParams` helper imported both by the filter bar's `searchParamsToFilters` and the server pages — single source of truth.

## Commit convention

Same as the original plan — per-task commits, no Co-Authored-By trailer.
