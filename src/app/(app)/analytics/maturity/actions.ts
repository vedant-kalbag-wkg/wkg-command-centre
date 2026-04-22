"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getMaturityAnalysisCached } from "@/lib/analytics/queries/maturity-analysis";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import { getCacheScopeKey } from "@/lib/analytics/cache-scope";
import type { AnalyticsFilters, MaturityAnalysis } from "@/lib/analytics/types";

export async function fetchMaturityAnalysis(
  filters: AnalyticsFilters,
): Promise<MaturityAnalysis> {
  const [, scopeKey] = await Promise.all([getUserCtx(), getCacheScopeKey()]);
  const canonical = canonicaliseFilters(filters);
  return getMaturityAnalysisCached(canonical, scopeKey);
}
