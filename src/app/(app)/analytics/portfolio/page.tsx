"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Flag } from "lucide-react";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import { useAbortableAction } from "@/lib/analytics/use-abortable-action";
import { PageHeader } from "@/components/layout/page-header";
import { ChartCard } from "@/components/ui/chart-card";
import { StatCard } from "@/components/analytics/stat-card";
import { FlagBadge } from "@/components/analytics/flag-badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  fetchPortfolioData,
  fetchThresholdConfig,
  fetchPortfolioEvents,
  fetchHighPerformerPatterns,
  fetchLowPerformerPatterns,
  fetchActiveFlags,
} from "./actions";
import { EVENT_CATEGORIES } from "@/lib/stores/trend-store";
import { CategoryPerformance } from "./category-performance";
import { TopProducts } from "./top-products";
import { DailyTrends } from "./daily-trends";
import { HourlyDistribution } from "./hourly-distribution";
import { OutletTiers } from "./outlet-tiers";
import { HighPerformerPatterns } from "./high-performer-patterns";
import { LowPerformerPatterns } from "./low-performer-patterns";
import { ThresholdEditor } from "./threshold-editor";
import { usePerformerThresholdStore } from "@/lib/stores/performer-threshold-store";
import {
  formatCurrency,
  formatNumber,
  formatDate,
} from "@/lib/analytics/formatters";
import { calculatePeriodChange } from "@/lib/analytics/metrics";
import type {
  AnalyticsFilters,
  ComparisonMode,
  PortfolioData,
  BusinessEventDisplay,
  HighPerformerPatterns as HighPerformerPatternsData,
  LowPerformerPatterns as LowPerformerPatternsData,
  LocationFlag,
} from "@/lib/analytics/types";
import type { ThresholdConfig } from "@/lib/analytics/thresholds";

type Kpi = {
  label: string;
  value: string;
  delta?: { value: number; direction: "up" | "down" | "flat"; label?: string };
};

function toDelta(
  current: number,
  previous: number | undefined,
  label: string,
): Kpi["delta"] {
  if (previous === undefined) return undefined;
  const pct = calculatePeriodChange(current, previous);
  if (pct === null) return undefined;
  const rounded = Math.round(pct * 10) / 10;
  const direction: "up" | "down" | "flat" =
    rounded > 0.1 ? "up" : rounded < -0.1 ? "down" : "flat";
  return { value: rounded, direction, label };
}

export default function PortfolioPage() {
  const filters = useAnalyticsFilters();
  const [data, setData] = useState<PortfolioData | null>(null);
  const [thresholdConfig, setThresholdConfig] = useState<ThresholdConfig>({
    redMax: 500,
    greenMin: 1500,
  });
  const [events, setEvents] = useState<BusinessEventDisplay[]>([]);
  const [highPerformerData, setHighPerformerData] =
    useState<HighPerformerPatternsData | null>(null);
  const [lowPerformerData, setLowPerformerData] =
    useState<LowPerformerPatternsData | null>(null);
  const [flags, setFlags] = useState<LocationFlag[]>([]);
  const greenCutoff = usePerformerThresholdStore((s) => s.greenCutoff);
  const redCutoff = usePerformerThresholdStore((s) => s.redCutoff);
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>("mom");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flagsSheetOpen, setFlagsSheetOpen] = useState(false);

  // All event categories active by default for portfolio view
  const activeEventCategories = EVENT_CATEGORIES.map((c) => c.name);

  // Serialize filters for effect dependency (stable reference comparison)
  const filtersJson = JSON.stringify(filters);

  // Discard stale server-action results on unmount / newer dispatch.
  const fetchPortfolio = useAbortableAction(fetchPortfolioData);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(filtersJson) as AnalyticsFilters;
      const [result, thresholds, eventsResult, hpResult, lpResult, activeFlags] =
        await Promise.all([
          fetchPortfolio(parsed, comparisonMode),
          fetchThresholdConfig(),
          fetchPortfolioEvents(parsed.dateFrom, parsed.dateTo).catch(() => []),
          fetchHighPerformerPatterns(parsed, greenCutoff).catch(() => null),
          fetchLowPerformerPatterns(parsed, redCutoff).catch(() => null),
          fetchActiveFlags().catch(() => []),
        ]);
      // `null` from the abortable dispatcher means a newer call superseded
      // this one (or the component unmounted) — discard this batch.
      if (result === null) return;
      setData(result);
      setThresholdConfig(thresholds);
      setEvents(eventsResult);
      setHighPerformerData(hpResult);
      setLowPerformerData(lpResult);
      setFlags(activeFlags);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load portfolio data",
      );
    } finally {
      setLoading(false);
    }
  }, [filtersJson, comparisonMode, greenCutoff, redCutoff, fetchPortfolio]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const comparisonLabel = comparisonMode === "mom" ? "vs. prev." : "vs. prev. yr";

  const kpis = useMemo<Kpi[] | null>(() => {
    if (!data) return null;
    const s = data.summary;
    const p = data.previousSummary ?? undefined;
    return [
      {
        label: "Revenue",
        value: formatCurrency(s.totalRevenue),
        delta: toDelta(s.totalRevenue, p?.totalRevenue, comparisonLabel),
      },
      {
        label: "Transactions",
        value: formatNumber(s.totalTransactions),
        delta: toDelta(
          s.totalTransactions,
          p?.totalTransactions,
          comparisonLabel,
        ),
      },
      {
        label: "Avg Basket",
        value: formatCurrency(s.avgBasketValue),
        delta: toDelta(
          s.avgBasketValue,
          p?.avgBasketValue,
          comparisonLabel,
        ),
      },
      {
        label: "Unique Outlets",
        value: formatNumber(s.uniqueOutlets),
        delta: toDelta(s.uniqueOutlets, p?.uniqueOutlets, comparisonLabel),
      },
      {
        label: "Unique Products",
        value: formatNumber(s.uniqueProducts),
        delta: toDelta(
          s.uniqueProducts,
          p?.uniqueProducts,
          comparisonLabel,
        ),
      },
    ];
  }, [data, comparisonLabel]);

  const portfolio = data;
  const activeFlagCount = flags.length;
  const hasCategoryData = (portfolio?.categoryPerformance.length ?? 0) > 0;
  const hasTopProductsData = (portfolio?.topProducts.length ?? 0) > 0;
  const hasDailyTrendsData = (portfolio?.dailyTrends.length ?? 0) > 0;
  const hasHourlyData = (portfolio?.hourlyDistribution.length ?? 0) > 0;
  const hasOutletTiersData = (portfolio?.outletTiers.length ?? 0) > 0;
  const hasHighPerformerData =
    !!highPerformerData &&
    (highPerformerData.greenCount > 0 || highPerformerData.totalCount > 0);
  const hasLowPerformerData =
    !!lowPerformerData &&
    (lowPerformerData.redCount > 0 || lowPerformerData.totalCount > 0);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Portfolio"
        description="Cross-portfolio performance overview"
        actions={
          <>
            <div className="inline-flex items-center gap-0.5 rounded-md border bg-muted/40 p-0.5">
              <Button
                size="sm"
                variant={comparisonMode === "mom" ? "default" : "ghost"}
                className="h-7 px-3 text-xs"
                onClick={() => setComparisonMode("mom")}
              >
                MoM
              </Button>
              <Button
                size="sm"
                variant={comparisonMode === "yoy" ? "default" : "ghost"}
                className="h-7 px-3 text-xs"
                onClick={() => setComparisonMode("yoy")}
              >
                YoY
              </Button>
            </div>
          </>
        }
        toolbar={
          <div className="flex w-full items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Filters are set in the sticky filter bar above. Active comparison:
              <span className="font-medium text-foreground ml-1">
                {comparisonMode === "mom"
                  ? "Month-over-month"
                  : "Year-over-year"}
              </span>
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setFlagsSheetOpen(true)}
            >
              <Flag className="size-3.5" />
              Active flags ({activeFlagCount})
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {(kpis ?? Array.from({ length: 5 }).map(() => null)).map((k, i) => (
            <StatCard
              key={k?.label ?? `placeholder-${i}`}
              label={k?.label ?? ""}
              value={k?.value ?? ""}
              delta={k?.delta}
              loading={loading || !k}
            />
          ))}
        </div>

        {/* Threshold editor drives both performer cards */}
        <ThresholdEditor />

        {/* 12-col chart grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <ChartCard
            title="High Performer Patterns"
            description="Traits shared by top-tier outlets"
            className="gap-0 py-0 lg:col-span-12"
            loading={loading}
            empty={!loading && !hasHighPerformerData}
            emptyMessage="No performance data for selected filters"
            collapsible
          >
            {highPerformerData && (
              <HighPerformerPatterns data={highPerformerData} />
            )}
          </ChartCard>

          <ChartCard
            title="Low Performer Patterns"
            description="Traits shared by bottom-tier outlets"
            className="gap-0 py-0 lg:col-span-12"
            loading={loading}
            empty={!loading && !hasLowPerformerData}
            emptyMessage="No performance data for selected filters"
            collapsible
          >
            {lowPerformerData && (
              <LowPerformerPatterns data={lowPerformerData} />
            )}
          </ChartCard>

          <ChartCard
            title="Daily Trends"
            description="Revenue and transactions over time"
            className="gap-0 py-0 lg:col-span-12"
            loading={loading}
            empty={!loading && !hasDailyTrendsData}
            emptyMessage="No trend data for selected filters"
            collapsible
          >
            {portfolio && (
              <DailyTrends
                data={portfolio.dailyTrends}
                events={events}
                activeEventCategories={activeEventCategories}
              />
            )}
          </ChartCard>

          <ChartCard
            title="Category Performance"
            description="Revenue by product category"
            className="gap-0 py-0 lg:col-span-12"
            loading={loading}
            empty={!loading && !hasCategoryData}
            emptyMessage="No category data for selected filters"
            collapsible
          >
            {portfolio && (
              <CategoryPerformance data={portfolio.categoryPerformance} />
            )}
          </ChartCard>

          <ChartCard
            title="Top Products"
            description="Best-selling products by revenue"
            className="gap-0 py-0 lg:col-span-12"
            loading={loading}
            empty={!loading && !hasTopProductsData}
            emptyMessage="No product data for selected filters"
            collapsible
          >
            {portfolio && <TopProducts data={portfolio.topProducts} />}
          </ChartCard>

          <ChartCard
            title="Hourly Distribution"
            description="Revenue by hour of day"
            className="gap-0 py-0 lg:col-span-12"
            loading={loading}
            empty={!loading && !hasHourlyData}
            emptyMessage="No hourly data for selected filters"
            collapsible
          >
            {portfolio && (
              <HourlyDistribution data={portfolio.hourlyDistribution} />
            )}
          </ChartCard>

          <ChartCard
            title="Outlet Tiers"
            description="Performance banding across outlets"
            className="gap-0 py-0 lg:col-span-12"
            loading={loading}
            empty={!loading && !hasOutletTiersData}
            emptyMessage="No outlet data for selected filters"
            collapsible
          >
            {portfolio && (
              <OutletTiers
                data={portfolio.outletTiers}
                thresholdConfig={thresholdConfig}
                flags={flags}
                onFlagCreated={loadData}
              />
            )}
          </ChartCard>

        </div>
      </div>

      {/* Flags drawer */}
      <Sheet open={flagsSheetOpen} onOpenChange={setFlagsSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Active flags ({flags.length})</SheetTitle>
            <SheetDescription>
              Outlet flags raised across the portfolio.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-auto px-4 pb-4">
            {flags.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active flags. Flags raised from the Outlet Tiers table will
                appear here.
              </p>
            ) : (
              <ul className="space-y-3">
                {flags.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-lg border bg-card p-3 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <FlagBadge flagType={f.flagType} />
                      <span className="text-xs text-muted-foreground">
                        {formatDate(f.createdAt)}
                      </span>
                    </div>
                    {f.reason && (
                      <p className="mt-2 text-sm text-foreground">
                        {f.reason}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Raised by {f.actorName}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
