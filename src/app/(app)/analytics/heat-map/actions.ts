"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getHeatMapData } from "@/lib/analytics/queries/heat-map";
import type { AnalyticsFilters, HeatMapData } from "@/lib/analytics/types";

export async function fetchHeatMapData(
  filters: AnalyticsFilters,
): Promise<HeatMapData> {
  const userCtx = await getUserCtx();
  return getHeatMapData(filters, userCtx);
}
