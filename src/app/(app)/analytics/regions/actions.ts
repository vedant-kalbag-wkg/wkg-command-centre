"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import {
  getRegionsListCached,
  getRegionDetailCached,
} from "@/lib/analytics/queries/regions";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import { getCacheScopeKey } from "@/lib/analytics/cache-scope";
import type {
  AnalyticsFilters,
  RegionData,
  RegionDetail,
} from "@/lib/analytics/types";

export async function fetchRegionsList(
  filters: AnalyticsFilters,
): Promise<RegionData[]> {
  await getUserCtx(); // auth gate — caching safely collapses internal users
  const canonical = canonicaliseFilters(filters);
  const scopeKey = await getCacheScopeKey();
  return getRegionsListCached(canonical, scopeKey);
}

export async function fetchRegionDetail(
  regionIds: string[],
  filters: AnalyticsFilters,
): Promise<RegionDetail> {
  await getUserCtx(); // auth gate — caching safely collapses internal users
  const canonical = canonicaliseFilters(filters);
  const scopeKey = await getCacheScopeKey();
  return getRegionDetailCached(canonical, scopeKey, regionIds);
}
