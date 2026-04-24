import { describe, expect, it } from 'vitest';
import { parseAnalyticsFiltersFromSearchParams } from '../parse-filters-from-search-params';

describe('parseAnalyticsFiltersFromSearchParams', () => {
  it('reads from/to as YYYY-MM-DD strings', () => {
    const result = parseAnalyticsFiltersFromSearchParams({
      from: '2026-01-01',
      to: '2026-03-31',
    });
    expect(result.dateFrom).toBe('2026-01-01');
    expect(result.dateTo).toBe('2026-03-31');
  });

  it('parses comma-separated id lists into arrays', () => {
    const result = parseAnalyticsFiltersFromSearchParams({
      from: '2026-01-01',
      to: '2026-03-31',
      hotels: 'h-1,h-2',
      regions: 'r-a',
      products: 'p-1,p-2,p-3',
      hgroups: 'hg-1',
      lgroups: 'lg-1,lg-2',
      maturity: 'mature,emerging',
    });
    expect(result.hotelIds).toEqual(['h-1', 'h-2']);
    expect(result.regionIds).toEqual(['r-a']);
    expect(result.productIds).toEqual(['p-1', 'p-2', 'p-3']);
    expect(result.hotelGroupIds).toEqual(['hg-1']);
    expect(result.locationGroupIds).toEqual(['lg-1', 'lg-2']);
    expect(result.maturityBuckets).toEqual(['mature', 'emerging']);
  });

  it('omits id fields when URL params are absent', () => {
    const result = parseAnalyticsFiltersFromSearchParams({
      from: '2026-01-01',
      to: '2026-03-31',
    });
    expect(result.hotelIds).toBeUndefined();
    expect(result.regionIds).toBeUndefined();
    expect(result.productIds).toBeUndefined();
    expect(result.hotelGroupIds).toBeUndefined();
    expect(result.locationGroupIds).toBeUndefined();
    expect(result.maturityBuckets).toBeUndefined();
  });

  it('omits id fields when URL params are empty strings', () => {
    const result = parseAnalyticsFiltersFromSearchParams({
      from: '2026-01-01',
      to: '2026-03-31',
      hotels: '',
      regions: '',
    });
    expect(result.hotelIds).toBeUndefined();
    expect(result.regionIds).toBeUndefined();
  });

  it('falls back to default date range when from/to absent', () => {
    const result = parseAnalyticsFiltersFromSearchParams({});
    // default is last-year preset: Jan 1 to Dec 31 of previous calendar year
    const lastYear = new Date().getFullYear() - 1;
    expect(result.dateFrom).toBe(`${lastYear}-01-01`);
    expect(result.dateTo).toBe(`${lastYear}-12-31`);
  });

  it('accepts Next.js searchParams shape where values can be string | string[] | undefined', () => {
    // Next.js 15 passes searchParams with possible string[] for repeated keys.
    // We take the first value for scalar params like from/to/hotels/etc.
    const result = parseAnalyticsFiltersFromSearchParams({
      from: ['2026-01-01', '2026-02-01'],
      to: '2026-03-31',
      hotels: ['h-1,h-2'],
    });
    expect(result.dateFrom).toBe('2026-01-01');
    expect(result.dateTo).toBe('2026-03-31');
    expect(result.hotelIds).toEqual(['h-1', 'h-2']);
  });

  it('accepts URLSearchParams instance', () => {
    const sp = new URLSearchParams();
    sp.set('from', '2026-01-01');
    sp.set('to', '2026-03-31');
    sp.set('hotels', 'h-1,h-2');
    const result = parseAnalyticsFiltersFromSearchParams(sp);
    expect(result.dateFrom).toBe('2026-01-01');
    expect(result.dateTo).toBe('2026-03-31');
    expect(result.hotelIds).toEqual(['h-1', 'h-2']);
  });
});
