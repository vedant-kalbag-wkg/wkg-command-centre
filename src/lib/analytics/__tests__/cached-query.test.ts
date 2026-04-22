import { describe, expect, it, vi } from 'vitest';

// unstable_cache requires a Next.js request/incremental-cache context that
// vitest doesn't provide ("Invariant: incrementalCache missing in
// unstable_cache"). We mock it to identity so these unit tests cover the
// denormalisation / scope-gating / args-forwarding logic without exercising
// the cache layer itself — which requires a Next runtime and is covered by
// integration tests later.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
}));

import { wrapAnalyticsQuery, INTERNAL_SCOPE_KEY } from '../cached-query';
import { canonicaliseFilters } from '../canonicalise-filters';
import type { AnalyticsFilters } from '@/lib/analytics/types';
import type { UserCtx } from '@/lib/scoping/scoped-query';

const canonical = canonicaliseFilters({
  dateFrom: '2026-01-01',
  dateTo: '2026-03-31',
});

describe('wrapAnalyticsQuery', () => {
  it('denormalises canonical filters back into AnalyticsFilters shape and passes them to the underlying query', async () => {
    const uncached = vi.fn(async (filters: AnalyticsFilters, _ctx: UserCtx) => {
      return { dateFrom: filters.dateFrom, dateTo: filters.dateTo };
    });
    const cached = wrapAnalyticsQuery(uncached, {
      name: 'testQuery1',
      tags: ['analytics', 'analytics:test'],
    });

    const result = await cached(canonical, INTERNAL_SCOPE_KEY);

    expect(uncached).toHaveBeenCalledOnce();
    const [filtersArg, ctxArg] = uncached.mock.calls[0];
    expect(filtersArg.dateFrom).toBe('2026-01-01');
    expect(filtersArg.dateTo).toBe('2026-03-31');
    expect(ctxArg).toMatchObject({
      id: '__internal__',
      userType: 'internal',
      role: 'admin',
    });
    expect(result).toEqual({ dateFrom: '2026-01-01', dateTo: '2026-03-31' });
  });

  it('drops empty id arrays back to undefined when denormalising', async () => {
    const uncached = vi.fn(async (filters: AnalyticsFilters) => filters);
    const cached = wrapAnalyticsQuery(uncached, {
      name: 'testQuery2',
      tags: ['analytics', 'analytics:test'],
    });

    const filtersWithEmptyArrays = canonicaliseFilters({
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
      hotelIds: [],
      regionIds: undefined,
    });

    await cached(filtersWithEmptyArrays, INTERNAL_SCOPE_KEY);
    const [arg] = uncached.mock.calls[0];
    expect(arg.hotelIds).toBeUndefined();
    expect(arg.regionIds).toBeUndefined();
  });

  it('preserves populated id arrays through denormalisation', async () => {
    const uncached = vi.fn(async (filters: AnalyticsFilters) => filters);
    const cached = wrapAnalyticsQuery(uncached, {
      name: 'testQuery3',
      tags: ['analytics', 'analytics:test'],
    });

    const filters = canonicaliseFilters({
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
      hotelIds: ['h-1', 'h-2'],
      productIds: ['p-1'],
    });

    await cached(filters, INTERNAL_SCOPE_KEY);
    const [arg] = uncached.mock.calls[0];
    expect(arg.hotelIds).toEqual(['h-1', 'h-2']);
    expect(arg.productIds).toEqual(['p-1']);
  });

  it('throws if scopeKey is not __internal__ (external scope not yet supported)', async () => {
    const uncached = vi.fn();
    const cached = wrapAnalyticsQuery(uncached, {
      name: 'testQuery4',
      tags: ['analytics', 'analytics:test'],
    });

    await expect(cached(canonical, 'ext:abc123' as typeof INTERNAL_SCOPE_KEY))
      .rejects.toThrow(/testQuery4.*external scope/i);
    expect(uncached).not.toHaveBeenCalled();
  });

  it('throws if canonical filters have null dates (cached queries require concrete dates)', async () => {
    const uncached = vi.fn();
    const cached = wrapAnalyticsQuery(uncached, {
      name: 'testQuery5',
      tags: ['analytics', 'analytics:test'],
    });

    const filtersWithNullDate = canonicaliseFilters({});
    await expect(cached(filtersWithNullDate, INTERNAL_SCOPE_KEY))
      .rejects.toThrow(/concrete dateFrom/i);
    expect(uncached).not.toHaveBeenCalled();
  });

  it('forwards extra positional arguments (e.g. limit, comparisonMode) to the underlying query', async () => {
    const uncached = vi.fn(async (_filters: AnalyticsFilters, _ctx: UserCtx, limit: number, mode: string) => {
      return { limit, mode };
    });
    const cached = wrapAnalyticsQuery(uncached, {
      name: 'testQuery6',
      tags: ['analytics', 'analytics:test'],
    });

    const result = await cached(canonical, INTERNAL_SCOPE_KEY, 20, 'yoy');

    expect(result).toEqual({ limit: 20, mode: 'yoy' });
    const [, , limitArg, modeArg] = uncached.mock.calls[0];
    expect(limitArg).toBe(20);
    expect(modeArg).toBe('yoy');
  });

  it('exports INTERNAL_SCOPE_KEY as the exact literal __internal__', () => {
    expect(INTERNAL_SCOPE_KEY).toBe('__internal__');
  });
});

describe('wrapAnalyticsQuery scope invariant lockstep with buildScopeFilter', () => {
  // The sentinel INTERNAL_USER_CTX inside cached-query.ts is hard-coded to
  // { userType: 'internal', role: 'admin' } because buildScopeFilter() returns
  // null (unrestricted) for that exact shape. If that invariant ever drifts,
  // this test fails — preventing a silent cache leak where scoped internal
  // users would share an admin-visibility entry.
  it('buildScopeFilter(INTERNAL_USER_CTX_SHAPE, []) must return null', async () => {
    const { buildScopeFilter } = await import('@/lib/scoping/scoped-query');
    const sentinel = { id: '__internal__', userType: 'internal', role: 'admin' } as const;
    expect(buildScopeFilter(sentinel, [])).toBeNull();
  });
});
