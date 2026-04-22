"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { executePivotCached } from "@/lib/analytics/queries/pivot";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import { getCacheScopeKey } from "@/lib/analytics/cache-scope";
import type { AnalyticsFilters, PivotConfig, PivotResponse } from "@/lib/analytics/types";

export async function fetchPivotData(
  filters: AnalyticsFilters,
  config: PivotConfig,
): Promise<PivotResponse> {
  const [, scopeKey] = await Promise.all([getUserCtx(), getCacheScopeKey()]);
  const canonical = canonicaliseFilters(filters);
  return executePivotCached(canonical, scopeKey, config);
}
