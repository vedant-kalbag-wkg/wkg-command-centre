import type { AnalyticsFilters, LocationType, MetricMode } from '@/lib/analytics/types';

export interface CanonicalFilters {
  dateFrom: string | null;
  dateTo: string | null;
  hotelIds: string[];
  regionIds: string[];
  productIds: string[];
  hotelGroupIds: string[];
  locationGroupIds: string[];
  maturityBuckets: string[];
  locationTypes: LocationType[];
  metricMode: MetricMode;
}

function sortedUnique(xs: string[] | undefined): string[] {
  return [...new Set(xs ?? [])].sort();
}

function sortedUniqueTypes(xs: LocationType[] | undefined): LocationType[] {
  return [...new Set(xs ?? [])].sort() as LocationType[];
}

// AnalyticsFilters from types.ts requires dateFrom/dateTo. Input relaxes
// those to optional so tests can construct partial filters without forcing
// every call-site to fill them in; callers passing a real AnalyticsFilters
// satisfy the optional signature trivially.
export type CanonicaliseInput = Partial<AnalyticsFilters>;

export function canonicaliseFilters(f: CanonicaliseInput): CanonicalFilters {
  return {
    dateFrom: f.dateFrom ?? null,
    dateTo:   f.dateTo   ?? null,
    hotelIds:         sortedUnique(f.hotelIds),
    regionIds:        sortedUnique(f.regionIds),
    productIds:       sortedUnique(f.productIds),
    hotelGroupIds:    sortedUnique(f.hotelGroupIds),
    locationGroupIds: sortedUnique(f.locationGroupIds),
    maturityBuckets:  sortedUnique(f.maturityBuckets),
    locationTypes:    sortedUniqueTypes(f.locationTypes),
    // metricMode participates in the cache key so Sales and Revenue don't
    // alias the same cache entry. Default to 'sales' when absent (matches
    // the UI + URL parse defaults).
    metricMode:       f.metricMode ?? 'sales',
  };
}
