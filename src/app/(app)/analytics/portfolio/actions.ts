"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import {
  getCategoryPerformanceCached,
  getDailyTrendsCached,
  getHourlyDistributionCached,
  getOutletTiersCached,
  getPortfolioSummaryCached,
  getTopProductsCached,
} from "@/lib/analytics/queries/portfolio";
import { getBusinessEvents } from "@/lib/analytics/queries/trend-series";
import { getThresholds } from "@/lib/analytics/thresholds-server";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import { getCacheScopeKey } from "@/lib/analytics/cache-scope";
import { getComparisonDates } from "@/lib/analytics/metrics";
import type { ThresholdConfig } from "@/lib/analytics/thresholds";
import {
  getHighPerformerData,
  getLowPerformerData,
} from "@/lib/analytics/queries/high-performer-analysis";
import { fetchLocationFlags } from "@/app/(app)/analytics/flags/actions";
import type {
  AnalyticsFilters,
  CategoryPerformanceRow,
  ComparisonMode,
  DailyTrendRow,
  HourlyDistributionRow,
  OutletTierRow,
  PortfolioData,
  PortfolioSummary,
  TopProductRow,
  BusinessEventDisplay,
  HighPerformerPatterns,
  LowPerformerPatterns,
  LocationFlag,
} from "@/lib/analytics/types";

export async function fetchPortfolioData(
  filters: AnalyticsFilters,
  comparison: ComparisonMode = "mom",
): Promise<PortfolioData> {
  const [, scopeKey] = await Promise.all([getUserCtx(), getCacheScopeKey()]);
  const canonical = canonicaliseFilters(filters);

  const { prevFrom, prevTo } = getComparisonDates(filters.dateFrom, filters.dateTo, comparison);
  const previousCanonical = canonicaliseFilters({ ...filters, dateFrom: prevFrom, dateTo: prevTo });

  const [summary, previousSummary, categoryPerformance, topProducts, dailyTrends, hourlyDistribution, outletTiers]
    = await Promise.all([
      getPortfolioSummaryCached(canonical, scopeKey),
      getPortfolioSummaryCached(previousCanonical, scopeKey).catch((err): PortfolioSummary | null => {
        console.error('[portfolio] previousSummary failed:', err);
        return null;
      }),
      getCategoryPerformanceCached(canonical, scopeKey).catch((err): CategoryPerformanceRow[] => {
        console.error('[portfolio] categoryPerformance failed:', err);
        return [];
      }),
      getTopProductsCached(canonical, scopeKey).catch((err): TopProductRow[] => {
        console.error('[portfolio] topProducts failed:', err);
        return [];
      }),
      getDailyTrendsCached(canonical, scopeKey).catch((err): DailyTrendRow[] => {
        console.error('[portfolio] dailyTrends failed:', err);
        return [];
      }),
      getHourlyDistributionCached(canonical, scopeKey).catch((err): HourlyDistributionRow[] => {
        console.error('[portfolio] hourlyDistribution failed:', err);
        return [];
      }),
      getOutletTiersCached(canonical, scopeKey).catch((err): OutletTierRow[] => {
        console.error('[portfolio] outletTiers failed:', err);
        return [];
      }),
    ]);

  return {
    summary,
    previousSummary,
    comparisonMode: comparison,
    categoryPerformance,
    topProducts,
    dailyTrends,
    hourlyDistribution,
    outletTiers,
  };
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
  greenCutoff: number = 30,
): Promise<HighPerformerPatterns> {
  const userCtx = await getUserCtx();
  return getHighPerformerData(filters, userCtx, greenCutoff);
}

export async function fetchLowPerformerPatterns(
  filters: AnalyticsFilters,
  redCutoff: number = 30,
): Promise<LowPerformerPatterns> {
  const userCtx = await getUserCtx();
  return getLowPerformerData(filters, userCtx, redCutoff);
}

export async function fetchActiveFlags(): Promise<LocationFlag[]> {
  return fetchLocationFlags();
}
