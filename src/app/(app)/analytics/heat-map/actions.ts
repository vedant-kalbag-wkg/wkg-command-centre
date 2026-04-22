"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getHeatMapDataCached } from "@/lib/analytics/queries/heat-map";
import { getThresholds } from "@/lib/analytics/thresholds-server";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import { getCacheScopeKey } from "@/lib/analytics/cache-scope";
import type { ThresholdConfig } from "@/lib/analytics/thresholds";
import { fetchLocationFlags } from "@/app/(app)/analytics/flags/actions";
import type {
  AnalyticsFilters,
  HeatMapData,
  LocationFlag,
  ScoreWeights,
} from "@/lib/analytics/types";

export async function fetchHeatMapData(
  filters: AnalyticsFilters,
  weights?: ScoreWeights,
): Promise<HeatMapData> {
  const [, scopeKey] = await Promise.all([getUserCtx(), getCacheScopeKey()]);
  const canonical = canonicaliseFilters(filters);
  return getHeatMapDataCached(canonical, scopeKey, weights);
}

export async function fetchThresholdConfig(): Promise<ThresholdConfig> {
  return getThresholds();
}

export async function fetchActiveFlags(): Promise<LocationFlag[]> {
  return fetchLocationFlags();
}
