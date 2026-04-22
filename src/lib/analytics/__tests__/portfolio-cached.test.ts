import { describe, expect, it, vi } from 'vitest';

// unstable_cache requires Next runtime; identity-mock for unit tests.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
}));

import {
  getPortfolioSummaryCached,
  getCategoryPerformanceCached,
  getTopProductsCached,
  getDailyTrendsCached,
  getHourlyDistributionCached,
  getOutletTiersCached,
} from '@/lib/analytics/queries/portfolio';
import { canonicaliseFilters } from '@/lib/analytics/canonicalise-filters';
import { INTERNAL_SCOPE_KEY } from '@/lib/analytics/cached-query';

// Mock the query body imports used by portfolio.ts. Inside the cached wrapper
// they'll be called via the uncached fn reference. We intercept the module
// itself to keep the tests DB-free.
// Return a single zero-filled row so getPortfolioSummary's `rows[0]!` access
// resolves without crashing. Array-returning queries still coerce cleanly:
// they map over the row and emit a one-element array of zeros, which is
// perfectly valid for shape assertions.
vi.mock('@/db/execute-rows', () => ({
  executeRows: vi.fn(async () => [
    {
      total_revenue: '0',
      total_transactions: '0',
      total_quantity: '0',
      unique_products: '0',
      unique_outlets: '0',
      category_name: '',
      revenue: '0',
      transactions: '0',
      quantity: '0',
      avg_value: '0',
      product_name: '',
      date: '2026-01-01',
      hour: '0',
      location_id: '',
      outlet_code: '',
      hotel_name: '',
      live_date: null,
    },
  ]),
}));
vi.mock('@/lib/scoping/scoped-query', async () => {
  const actual = await vi.importActual<typeof import('@/lib/scoping/scoped-query')>(
    '@/lib/scoping/scoped-query',
  );
  return {
    ...actual,
    scopedSalesCondition: vi.fn(async () => undefined),
  };
});
vi.mock('@/lib/analytics/active-locations', () => ({
  getActiveLocationIds: vi.fn(async () => []),
  buildActiveLocationCondition: vi.fn(async () => undefined),
}));

const canonical = canonicaliseFilters({
  dateFrom: '2026-01-01',
  dateTo: '2026-03-31',
});

describe('portfolio cached exports are callable with (canonicalFilters, scopeKey)', () => {
  it('getPortfolioSummaryCached returns a PortfolioSummary shape', async () => {
    const r = await getPortfolioSummaryCached(canonical, INTERNAL_SCOPE_KEY);
    expect(r).toMatchObject({
      totalRevenue: expect.any(Number),
      totalTransactions: expect.any(Number),
      totalQuantity: expect.any(Number),
      avgBasketValue: expect.any(Number),
      uniqueProducts: expect.any(Number),
      uniqueOutlets: expect.any(Number),
    });
  });

  it('getCategoryPerformanceCached returns an array', async () => {
    const r = await getCategoryPerformanceCached(canonical, INTERNAL_SCOPE_KEY);
    expect(Array.isArray(r)).toBe(true);
  });

  it('getTopProductsCached accepts an optional limit via rest args', async () => {
    const r = await getTopProductsCached(canonical, INTERNAL_SCOPE_KEY, 10);
    expect(Array.isArray(r)).toBe(true);
  });

  it('getDailyTrendsCached returns an array', async () => {
    const r = await getDailyTrendsCached(canonical, INTERNAL_SCOPE_KEY);
    expect(Array.isArray(r)).toBe(true);
  });

  it('getHourlyDistributionCached returns an array', async () => {
    const r = await getHourlyDistributionCached(canonical, INTERNAL_SCOPE_KEY);
    expect(Array.isArray(r)).toBe(true);
  });

  it('getOutletTiersCached returns an array', async () => {
    const r = await getOutletTiersCached(canonical, INTERNAL_SCOPE_KEY);
    expect(Array.isArray(r)).toBe(true);
  });

  it('cached variants throw when given an external scope key', async () => {
    await expect(
      getPortfolioSummaryCached(canonical, 'ext:abc' as typeof INTERNAL_SCOPE_KEY),
    ).rejects.toThrow(/external scope/i);
  });
});
