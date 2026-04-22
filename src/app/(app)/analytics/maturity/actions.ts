"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getMaturityAnalysisCached } from "@/lib/analytics/queries/maturity-analysis";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import { getCacheScopeKey } from "@/lib/analytics/cache-scope";
import type { AnalyticsFilters, MaturityAnalysis } from "@/lib/analytics/types";

export async function fetchMaturityAnalysis(
  filters: AnalyticsFilters,
): Promise<MaturityAnalysis> {
  await getUserCtx(); // auth gate — caching safely collapses internal users
  const canonical = canonicaliseFilters(filters);
  const scopeKey = await getCacheScopeKey();
  return getMaturityAnalysisCached(canonical, scopeKey);
}
