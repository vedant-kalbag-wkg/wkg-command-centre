"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getPortfolioData } from "@/lib/analytics/queries/portfolio";
import { getBusinessEvents } from "@/lib/analytics/queries/trend-series";
import { getThresholds } from "@/lib/analytics/thresholds-server";
import type { ThresholdConfig } from "@/lib/analytics/thresholds";
import { getHighPerformerPatterns } from "@/lib/analytics/queries/high-performer-analysis";
import { fetchLocationFlags } from "@/app/(app)/analytics/flags/actions";
import type {
  AnalyticsFilters,
  ComparisonMode,
  PortfolioData,
  BusinessEventDisplay,
  HighPerformerPatterns,
  LocationFlag,
} from "@/lib/analytics/types";

export async function fetchPortfolioData(
  filters: AnalyticsFilters,
  comparison: ComparisonMode = "mom",
): Promise<PortfolioData> {
  const userCtx = await getUserCtx();
  return getPortfolioData(filters, userCtx, comparison);
}

export async function fetchThresholdConfig(): Promise<ThresholdConfig> {
  return getThresholds();
}

/**
 * Fetch business events for the portfolio daily trends chart.
 * Gated to internal users only — external users get an empty array.
 */
export async function fetchPortfolioEvents(
  dateFrom: string,
  dateTo: string,
): Promise<BusinessEventDisplay[]> {
  const userCtx = await getUserCtx();
  if (userCtx.userType === "external") return [];
  return getBusinessEvents(dateFrom, dateTo);
}

export async function fetchHighPerformerPatterns(
  filters: AnalyticsFilters,
): Promise<HighPerformerPatterns> {
  const userCtx = await getUserCtx();
  const thresholdConfig = await getThresholds();
  return getHighPerformerPatterns(filters, userCtx, thresholdConfig);
}

export async function fetchActiveFlags(): Promise<LocationFlag[]> {
  return fetchLocationFlags();
}
