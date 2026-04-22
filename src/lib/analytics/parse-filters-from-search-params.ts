import type { AnalyticsFilters } from '@/lib/analytics/types';

export type NextSearchParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function getScalar(sp: NextSearchParams, key: string): string | undefined {
  if (sp instanceof URLSearchParams) {
    const v = sp.get(key);
    return v === null ? undefined : v;
  }
  const raw = sp[key];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

function getIds(sp: NextSearchParams, key: string): string[] | undefined {
  const raw = getScalar(sp, key);
  if (!raw) return undefined;
  return raw.split(',').filter(Boolean);
}

function defaultLastYearRange(): { dateFrom: string; dateTo: string } {
  const lastYear = new Date().getFullYear() - 1;
  return {
    dateFrom: `${lastYear}-01-01`,
    dateTo: `${lastYear}-12-31`,
  };
}

/**
 * Parse Next.js `searchParams` into a fully-defaulted `AnalyticsFilters`.
 *
 * Single source of truth for RSC analytics pages: the filter bar writes URL
 * params (see `filtersToSearchParams` in the store), this helper reads them.
 * Defaults mirror the store's `last-year` preset so a fresh page load with
 * empty URL renders the same data the client store would.
 */
export function parseAnalyticsFiltersFromSearchParams(
  sp: NextSearchParams,
): AnalyticsFilters {
  const from = getScalar(sp, 'from');
  const to = getScalar(sp, 'to');
  const { dateFrom: defaultFrom, dateTo: defaultTo } = defaultLastYearRange();

  return {
    dateFrom: from ?? defaultFrom,
    dateTo: to ?? defaultTo,
    hotelIds: getIds(sp, 'hotels'),
    regionIds: getIds(sp, 'regions'),
    productIds: getIds(sp, 'products'),
    hotelGroupIds: getIds(sp, 'hgroups'),
    locationGroupIds: getIds(sp, 'lgroups'),
    maturityBuckets: getIds(sp, 'maturity'),
  };
}
