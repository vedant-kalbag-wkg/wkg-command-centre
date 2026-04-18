"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getMaturityAnalysis } from "@/lib/analytics/queries/maturity-analysis";
import type { AnalyticsFilters, MaturityAnalysis } from "@/lib/analytics/types";

export async function fetchMaturityAnalysis(
  filters: AnalyticsFilters,
): Promise<MaturityAnalysis> {
  const userCtx = await getUserCtx();
  return getMaturityAnalysis(filters, userCtx);
}
