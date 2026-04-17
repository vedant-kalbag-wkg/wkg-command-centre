"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getPortfolioData } from "@/lib/analytics/queries/portfolio";
import { getBusinessEvents } from "@/lib/analytics/queries/trend-series";
import { getThresholds, type ThresholdConfig } from "@/lib/analytics/thresholds";
import type {
  AnalyticsFilters,
  PortfolioData,
  BusinessEventDisplay,
} from "@/lib/analytics/types";

export async function fetchPortfolioData(
  filters: AnalyticsFilters,
): Promise<PortfolioData> {
  const userCtx = await getUserCtx();
  return getPortfolioData(filters, userCtx);
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
