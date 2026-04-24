import type { AnalyticsFilters, LocationType, MetricMode } from '@/lib/analytics/types';
import { LOCATION_TYPES } from '@/lib/analytics/types';

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

function defaultYtdRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const year = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return {
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-${mm}-${dd}`,
  };
}

/**
 * Parse Next.js `searchParams` into a fully-defaulted `AnalyticsFilters`.
 *
 * Single source of truth for RSC analytics pages: the filter bar writes URL
 * params (see `filtersToSearchParams` in the store), this helper reads them.
 * Defaults mirror the store's `ytd` preset so a fresh page load with an
 * empty URL renders current-year data (not the previous calendar year,
 * which hides live operational data for 12 months after rollover).
 */
export function parseAnalyticsFiltersFromSearchParams(
  sp: NextSearchParams,
): AnalyticsFilters {
  const from = getScalar(sp, 'from');
  const to = getScalar(sp, 'to');
  const { dateFrom: defaultFrom, dateTo: defaultTo } = defaultYtdRange();
  const rawMode = getScalar(sp, 'mode');
  const metricMode: MetricMode =
    rawMode === 'revenue' ? 'revenue' : 'sales';

  const rawTypes = getIds(sp, 'types');
  const validTypes = new Set<string>(LOCATION_TYPES);
  const locationTypes = rawTypes?.filter((t): t is LocationType => validTypes.has(t));

  return {
    dateFrom: from ?? defaultFrom,
    dateTo: to ?? defaultTo,
    hotelIds: getIds(sp, 'hotels'),
    regionIds: getIds(sp, 'regions'),
    productIds: getIds(sp, 'products'),
    hotelGroupIds: getIds(sp, 'hgroups'),
    locationGroupIds: getIds(sp, 'lgroups'),
    maturityBuckets: getIds(sp, 'maturity'),
    locationTypes: locationTypes?.length ? locationTypes : undefined,
    metricMode,
  };
}
