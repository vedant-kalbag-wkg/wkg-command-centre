import { describe, expect, it } from 'vitest';
import { canonicaliseFilters } from '../canonicalise-filters';

describe('canonicaliseFilters', () => {
  it('passes YYYY-MM-DD dates through unchanged', () => {
    const result = canonicaliseFilters({
      dateFrom: '2026-04-21',
      dateTo: '2026-04-22',
    });
    expect(result.dateFrom).toBe('2026-04-21');
    expect(result.dateTo).toBe('2026-04-22');
  });

  it('returns null for missing (undefined) dates', () => {
    const result = canonicaliseFilters({});
    expect(result.dateFrom).toBeNull();
    expect(result.dateTo).toBeNull();
  });

  it('sorts array filters so equivalent inputs produce identical canonical forms', () => {
    const a = canonicaliseFilters({ regionIds: ['B', 'A', 'C'] });
    const b = canonicaliseFilters({ regionIds: ['A', 'B', 'C'] });
    const c = canonicaliseFilters({ regionIds: ['C', 'A', 'B'] });
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('treats undefined and empty array filters identically', () => {
    expect(canonicaliseFilters({ regionIds: undefined }))
      .toEqual(canonicaliseFilters({ regionIds: [] }));
  });

  it('de-duplicates array entries so redundant selections do not fragment the cache', () => {
    expect(canonicaliseFilters({ regionIds: ['A', 'B', 'A'] }).regionIds).toEqual(['A', 'B']);
  });

  it('canonicalises all six filter dimensions independently', () => {
    const result = canonicaliseFilters({
      hotelIds: ['h-2', 'h-1'],
      regionIds: ['r-b', 'r-a'],
      productIds: ['p-3', 'p-1', 'p-2'],
      hotelGroupIds: ['hg-2', 'hg-1'],
      locationGroupIds: ['lg-3', 'lg-1', 'lg-2'],
      maturityBuckets: ['mature', 'emerging'],
    });
    expect(result.hotelIds).toEqual(['h-1', 'h-2']);
    expect(result.regionIds).toEqual(['r-a', 'r-b']);
    expect(result.productIds).toEqual(['p-1', 'p-2', 'p-3']);
    expect(result.hotelGroupIds).toEqual(['hg-1', 'hg-2']);
    expect(result.locationGroupIds).toEqual(['lg-1', 'lg-2', 'lg-3']);
    expect(result.maturityBuckets).toEqual(['emerging', 'mature']);
  });

  it('accepts the full existing AnalyticsFilters shape from types.ts', () => {
    // structural compatibility check: passing a real AnalyticsFilters must type-check and canonicalise all fields
    const input = {
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
      hotelIds: ['h1'],
      regionIds: ['r1'],
      productIds: ['p1'],
      hotelGroupIds: ['hg1'],
      locationGroupIds: ['lg1'],
      maturityBuckets: ['mature'],
    };
    const result = canonicaliseFilters(input);
    expect(result).toEqual({
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
      hotelIds: ['h1'],
      regionIds: ['r1'],
      productIds: ['p1'],
      hotelGroupIds: ['hg1'],
      locationGroupIds: ['lg1'],
      maturityBuckets: ['mature'],
      locationTypes: [],
      metricMode: 'sales',
    });
  });
});
