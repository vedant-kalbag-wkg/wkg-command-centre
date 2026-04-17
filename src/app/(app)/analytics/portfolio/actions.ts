"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getPortfolioData } from "@/lib/analytics/queries/portfolio";
import { getThresholds, type ThresholdConfig } from "@/lib/analytics/thresholds";
import type { AnalyticsFilters, PortfolioData } from "@/lib/analytics/types";

export async function fetchPortfolioData(
  filters: AnalyticsFilters,
): Promise<PortfolioData> {
  const userCtx = await getUserCtx();
  return getPortfolioData(filters, userCtx);
}

export async function fetchThresholdConfig(): Promise<ThresholdConfig> {
  return getThresholds();
}
