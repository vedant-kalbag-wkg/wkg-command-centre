"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import {
  getHotelGroupsListCached,
  getHotelGroupDetailCached,
} from "@/lib/analytics/queries/hotel-groups";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import { getCacheScopeKey } from "@/lib/analytics/cache-scope";
import type {
  AnalyticsFilters,
  HotelGroupData,
  HotelGroupDetail,
} from "@/lib/analytics/types";

export async function fetchHotelGroupsList(
  filters: AnalyticsFilters,
): Promise<HotelGroupData[]> {
  await getUserCtx(); // auth gate — caching safely collapses internal users
  const canonical = canonicaliseFilters(filters);
  const scopeKey = await getCacheScopeKey();
  return getHotelGroupsListCached(canonical, scopeKey);
}

export async function fetchHotelGroupDetail(
  groupIds: string[],
  filters: AnalyticsFilters,
): Promise<HotelGroupDetail> {
  await getUserCtx(); // auth gate — caching safely collapses internal users
  const canonical = canonicaliseFilters(filters);
  const scopeKey = await getCacheScopeKey();
  return getHotelGroupDetailCached(canonical, scopeKey, groupIds);
}
