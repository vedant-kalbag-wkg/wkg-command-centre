"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getHeatMapDataCached } from "@/lib/analytics/queries/heat-map";
import {
  getThresholds,
  getOutletTierThresholds,
} from "@/lib/analytics/thresholds-server";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import { getCacheScopeKey } from "@/lib/analytics/cache-scope";
import type {
  ThresholdConfig,
  OutletTierConfig,
} from "@/lib/analytics/thresholds";
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

// Phase 6 plan 06-05 — re-export the canonical reader names so the heat-map
// client page can call them directly (instead of a separate dual-purpose
// `fetchThresholdConfig`). This keeps the URL-param override pattern uniform
// across heat-map / portfolio: both pages call `fetchThresholds()` +
// `fetchOutletTierThresholds()`.
export async function fetchThresholds(): Promise<ThresholdConfig> {
  return getThresholds();
}

export async function fetchOutletTierThresholds(): Promise<OutletTierConfig> {
  return getOutletTierThresholds();
}

export async function fetchActiveFlags(): Promise<LocationFlag[]> {
  return fetchLocationFlags();
}
