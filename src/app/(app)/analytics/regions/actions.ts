"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getRegionsList, getRegionDetail } from "@/lib/analytics/queries/regions";
import type {
  AnalyticsFilters,
  RegionData,
  RegionDetail,
} from "@/lib/analytics/types";

export async function fetchRegionsList(
  filters: AnalyticsFilters,
): Promise<RegionData[]> {
  const userCtx = await getUserCtx();
  return getRegionsList(filters, userCtx);
}

export async function fetchRegionDetail(
  regionIds: string[],
  filters: AnalyticsFilters,
): Promise<RegionDetail> {
  const userCtx = await getUserCtx();
  return getRegionDetail(regionIds, filters, userCtx);
}
