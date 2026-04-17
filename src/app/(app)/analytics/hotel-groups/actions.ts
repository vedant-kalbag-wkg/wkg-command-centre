"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getHotelGroupsList, getHotelGroupDetail } from "@/lib/analytics/queries/hotel-groups";
import type {
  AnalyticsFilters,
  HotelGroupData,
  HotelGroupDetail,
} from "@/lib/analytics/types";

export async function fetchHotelGroupsList(
  filters: AnalyticsFilters,
): Promise<HotelGroupData[]> {
  const userCtx = await getUserCtx();
  return getHotelGroupsList(filters, userCtx);
}

export async function fetchHotelGroupDetail(
  groupIds: string[],
  filters: AnalyticsFilters,
): Promise<HotelGroupDetail> {
  const userCtx = await getUserCtx();
  return getHotelGroupDetail(groupIds, filters, userCtx);
}
