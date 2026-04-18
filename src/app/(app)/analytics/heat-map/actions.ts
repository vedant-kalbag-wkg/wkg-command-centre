"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getHeatMapData } from "@/lib/analytics/queries/heat-map";
import { getThresholds, type ThresholdConfig } from "@/lib/analytics/thresholds";
import { fetchLocationFlags } from "@/app/(app)/analytics/flags/actions";
import type { AnalyticsFilters, HeatMapData, LocationFlag } from "@/lib/analytics/types";

export async function fetchHeatMapData(
  filters: AnalyticsFilters,
): Promise<HeatMapData> {
  const userCtx = await getUserCtx();
  return getHeatMapData(filters, userCtx);
}

export async function fetchThresholdConfig(): Promise<ThresholdConfig> {
  return getThresholds();
}

export async function fetchActiveFlags(): Promise<LocationFlag[]> {
  return fetchLocationFlags();
}
