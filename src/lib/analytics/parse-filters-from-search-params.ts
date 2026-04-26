import { toLocalISODate } from '@/lib/analytics/formatters';
import { parseUrlFilters } from '@/lib/analytics/url-filters';
import type { AnalyticsFilters } from '@/lib/analytics/types';

export type NextSearchParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

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
 *
 * Boundary validation lives in `parseUrlFilters` (Zod): UUIDs are checked,
 * enum values are whitelisted, malformed dates are dropped. Bad values
 * silently fall through here and reach SQL only as the empty default —
 * RSC has no UI surface to toast from, so dropped values aren't surfaced.
 * The client-side FilterBar mirrors the same validation and does toast.
 */
export function parseAnalyticsFiltersFromSearchParams(
  sp: NextSearchParams,
): AnalyticsFilters {
  const { filters } = parseUrlFilters(sp);
  const { dateFrom: defaultFrom, dateTo: defaultTo } = defaultYtdRange();

  const dateFrom = filters.dateRange ? toLocalISODate(filters.dateRange.from) : defaultFrom;
  const dateTo = filters.dateRange ? toLocalISODate(filters.dateRange.to) : defaultTo;

  return {
    dateFrom,
    dateTo,
    hotelIds: filters.hotelFilter,
    regionIds: filters.regionFilter,
    productIds: filters.productFilter,
    hotelGroupIds: filters.hotelGroupFilter,
    locationGroupIds: filters.locationGroupFilter,
    maturityBuckets: filters.maturityFilter as string[] | undefined,
    locationTypes: filters.locationTypeFilter,
    metricMode: filters.metricMode ?? 'sales',
  };
}
