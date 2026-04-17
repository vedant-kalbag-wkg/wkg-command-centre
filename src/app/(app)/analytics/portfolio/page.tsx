"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import { SectionAccordion } from "@/components/analytics/section-accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchPortfolioData, fetchThresholdConfig } from "./actions";
import { AnalyticsSummary } from "./analytics-summary";
import { CategoryPerformance } from "./category-performance";
import { TopProducts } from "./top-products";
import { DailyTrends } from "./daily-trends";
import { HourlyDistribution } from "./hourly-distribution";
import { OutletTiers } from "./outlet-tiers";
import type { PortfolioData } from "@/lib/analytics/types";
import type { ThresholdConfig } from "@/lib/analytics/thresholds";

export default function PortfolioPage() {
  const filters = useAnalyticsFilters();
  const [data, setData] = useState<PortfolioData | null>(null);
  const [thresholdConfig, setThresholdConfig] = useState<ThresholdConfig>({ redMax: 500, greenMin: 1500 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Serialize filters for effect dependency (stable reference comparison)
  const filtersJson = JSON.stringify(filters);
  const abortRef = useRef<AbortController | null>(null);

  const loadData = useCallback(async () => {
    // Cancel any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(filtersJson);
      const [result, thresholds] = await Promise.all([
        fetchPortfolioData(parsed),
        fetchThresholdConfig(),
      ]);
      if (!controller.signal.aborted) {
        setData(result);
        setThresholdConfig(thresholds);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "Failed to load portfolio data",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [filtersJson]);

  useEffect(() => {
    loadData();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadData]);

  // Empty defaults for loading/error states
  const emptyPortfolio: PortfolioData = {
    summary: {
      totalRevenue: 0,
      totalTransactions: 0,
      totalQuantity: 0,
      avgBasketValue: 0,
      uniqueProducts: 0,
      uniqueOutlets: 0,
    },
    previousSummary: null,
    categoryPerformance: [],
    topProducts: [],
    dailyTrends: [],
    hourlyDistribution: [],
    outletTiers: [],
  };

  const portfolio = data ?? emptyPortfolio;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Portfolio Overview
        </h1>
        <p className="text-sm text-muted-foreground">
          Comprehensive view of sales performance across your portfolio
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <SectionAccordion title="Summary">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : (
          <AnalyticsSummary
            summary={portfolio.summary}
            previousSummary={portfolio.previousSummary}
          />
        )}
      </SectionAccordion>

      <SectionAccordion title="Category Performance">
        <CategoryPerformance
          data={portfolio.categoryPerformance}
          loading={loading}
        />
      </SectionAccordion>

      <SectionAccordion title="Top Products">
        <TopProducts data={portfolio.topProducts} loading={loading} />
      </SectionAccordion>

      <SectionAccordion title="Daily Trends">
        <DailyTrends data={portfolio.dailyTrends} loading={loading} />
      </SectionAccordion>

      <SectionAccordion title="Hourly Distribution">
        <HourlyDistribution
          data={portfolio.hourlyDistribution}
          loading={loading}
        />
      </SectionAccordion>

      <SectionAccordion title="Outlet Tiers">
        <OutletTiers data={portfolio.outletTiers} loading={loading} thresholdConfig={thresholdConfig} />
      </SectionAccordion>
    </div>
  );
}
