import { describe, expect, it } from 'vitest';
import { parseAnalyticsFiltersFromSearchParams } from '../parse-filters-from-search-params';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

describe('parseAnalyticsFiltersFromSearchParams', () => {
  it('reads from/to as YYYY-MM-DD strings', () => {
    const result = parseAnalyticsFiltersFromSearchParams({
      from: '2026-01-01',
      to: '2026-03-31',
    });
    expect(result.dateFrom).toBe('2026-01-01');
    expect(result.dateTo).toBe('2026-03-31');
  });

  it('parses comma-separated UUID lists into arrays', () => {
    const result = parseAnalyticsFiltersFromSearchParams({
      from: '2026-01-01',
      to: '2026-03-31',
      hotels: `${UUID_A},${UUID_B}`,
      regions: UUID_A,
      products: `${UUID_A},${UUID_B},${UUID_C}`,
      hgroups: UUID_A,
      lgroups: `${UUID_A},${UUID_B}`,
      maturity: '0-1mo,3-6mo',
    });
    expect(result.hotelIds).toEqual([UUID_A, UUID_B]);
    expect(result.regionIds).toEqual([UUID_A]);
    expect(result.productIds).toEqual([UUID_A, UUID_B, UUID_C]);
    expect(result.hotelGroupIds).toEqual([UUID_A]);
    expect(result.locationGroupIds).toEqual([UUID_A, UUID_B]);
    expect(result.maturityBuckets).toEqual(['0-1mo', '3-6mo']);
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

  it('drops non-UUID values silently and leaves the field undefined', () => {
    const result = parseAnalyticsFiltersFromSearchParams({
      from: '2026-01-01',
      to: '2026-03-31',
      hotels: 'not-a-uuid',
    });
    expect(result.hotelIds).toBeUndefined();
  });

  it('drops unknown maturity values, keeps valid ones', () => {
    const result = parseAnalyticsFiltersFromSearchParams({
      from: '2026-01-01',
      to: '2026-03-31',
      maturity: '0-1mo,12mo+',
    });
    expect(result.maturityBuckets).toEqual(['0-1mo']);
  });

  it('falls back to default date range when from/to absent', () => {
    const result = parseAnalyticsFiltersFromSearchParams({});
    // default is ytd preset: Jan 1 of current year → today (local date)
    const now = new Date();
    const year = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    expect(result.dateFrom).toBe(`${year}-01-01`);
    expect(result.dateTo).toBe(`${year}-${mm}-${dd}`);
  });

  it('accepts Next.js searchParams shape where values can be string | string[] | undefined', () => {
    // Next.js 15 passes searchParams with possible string[] for repeated keys.
    // We take the first value for scalar params like from/to/hotels/etc.
    const result = parseAnalyticsFiltersFromSearchParams({
      from: ['2026-01-01', '2026-02-01'],
      to: '2026-03-31',
      hotels: [`${UUID_A},${UUID_B}`],
    });
    expect(result.dateFrom).toBe('2026-01-01');
    expect(result.dateTo).toBe('2026-03-31');
    expect(result.hotelIds).toEqual([UUID_A, UUID_B]);
  });

  it('accepts URLSearchParams instance', () => {
    const sp = new URLSearchParams();
    sp.set('from', '2026-01-01');
    sp.set('to', '2026-03-31');
    sp.set('hotels', `${UUID_A},${UUID_B}`);
    const result = parseAnalyticsFiltersFromSearchParams(sp);
    expect(result.dateFrom).toBe('2026-01-01');
    expect(result.dateTo).toBe('2026-03-31');
    expect(result.hotelIds).toEqual([UUID_A, UUID_B]);
  });
});
