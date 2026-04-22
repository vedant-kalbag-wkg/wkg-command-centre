"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import {
  getLocationGroupsListCached,
  getLocationGroupDetailCached,
} from "@/lib/analytics/queries/location-groups";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import { getCacheScopeKey } from "@/lib/analytics/cache-scope";
import type {
  AnalyticsFilters,
  LocationGroupData,
  LocationGroupDetail,
} from "@/lib/analytics/types";

export async function fetchLocationGroupsList(
  filters: AnalyticsFilters,
): Promise<LocationGroupData[]> {
  await getUserCtx();
  const canonical = canonicaliseFilters(filters);
  const scopeKey = await getCacheScopeKey();
  return getLocationGroupsListCached(canonical, scopeKey);
}

export async function fetchLocationGroupDetail(
  groupIds: string[],
  filters: AnalyticsFilters,
): Promise<LocationGroupDetail> {
  await getUserCtx();
  const canonical = canonicaliseFilters(filters);
  const scopeKey = await getCacheScopeKey();
  return getLocationGroupDetailCached(canonical, scopeKey, groupIds);
}
