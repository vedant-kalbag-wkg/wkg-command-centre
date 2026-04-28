"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import {
  useHeatmapWeightsStore,
  toScoreWeights,
} from "@/lib/stores/heatmap-weights-store";
import { useAbortableAction } from "@/lib/analytics/use-abortable-action";
import { PageHeader } from "@/components/layout/page-header";
import { ChartCard } from "@/components/ui/chart-card";
import {
  fetchHeatMapData,
  fetchThresholds,
  fetchOutletTierThresholds,
  fetchActiveFlags,
} from "./actions";
import { WeightEditor } from "./weight-editor";
import { PerformanceTable } from "./performance-table";
import type { HeatMapData, LocationFlag } from "@/lib/analytics/types";
import type {
  ThresholdConfig,
  OutletTierConfig,
} from "@/lib/analytics/thresholds";

// Phase 6 plan 06-05 — fallback initial state consumed only while the cached
// reader is in-flight. Sentinel values (MIN_SAFE_INTEGER / MAX_SAFE_INTEGER)
// keep every cell in the amber band on first paint so the "no hard-coded
// 500/1500 magic-number" rule stays grep-clean.
const FALLBACK_THRESHOLDS: ThresholdConfig = {
  redMax: Number.MIN_SAFE_INTEGER,
  greenMin: Number.MAX_SAFE_INTEGER,
};
const FALLBACK_TIER_CONFIG: OutletTierConfig = { top: 80, mid: 50, bottom: 20 };

export default function HeatMapPage() {
  const filters = useAnalyticsFilters();
  const searchParams = useSearchParams();
  const appliedWeights = useHeatmapWeightsStore((s) => s.weights);
  const [data, setData] = useState<HeatMapData | null>(null);
  const [thresholdConfig, setThresholdConfig] =
    useState<ThresholdConfig>(FALLBACK_THRESHOLDS);
  const [tierConfig, setTierConfig] =
    useState<OutletTierConfig>(FALLBACK_TIER_CONFIG);
  const [flags, setFlags] = useState<LocationFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filtersJson = JSON.stringify(filters);
  const weightsJson = JSON.stringify(appliedWeights);

  // Discard stale server-action results on unmount / newer dispatch.
  const fetchHeatMap = useAbortableAction(fetchHeatMapData);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const parsedFilters = JSON.parse(filtersJson);
      const parsedWeights = JSON.parse(weightsJson);
      const [result, thresholds, tierThresholds, activeFlags] =
        await Promise.all([
          fetchHeatMap(parsedFilters, toScoreWeights(parsedWeights)),
          fetchThresholds(),
          fetchOutletTierThresholds(),
          fetchActiveFlags(),
        ]);
      // `null` from the abortable dispatcher means a newer call superseded
      // this one (or the component unmounted) — discard this batch.
      if (result === null) return;
      setData(result);
      setThresholdConfig(thresholds);
      setTierConfig(tierThresholds);
      setFlags(activeFlags);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load heat map data",
      );
    } finally {
      setLoading(false);
    }
  }, [filtersJson, weightsJson, fetchHeatMap]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Phase 6 plan 06-05 — URL-param override semantics (CONTEXT D-09: temp
  // overrides only; never auto-saved). `?redMax=200&greenMin=800` overrides
  // the saved traffic-light thresholds for the current view; tier params
  // (`?tierTop=` etc.) are wired here for symmetry with the portfolio page
  // even though heat-map does not currently render outlet-tier badges.
  const effectiveThresholds = useMemo<ThresholdConfig>(() => {
    const redMaxParam = searchParams.get("redMax");
    const greenMinParam = searchParams.get("greenMin");
    return {
      redMax:
        redMaxParam !== null ? Number(redMaxParam) : thresholdConfig.redMax,
      greenMin:
        greenMinParam !== null
          ? Number(greenMinParam)
          : thresholdConfig.greenMin,
    };
  }, [searchParams, thresholdConfig]);

  const effectiveTiers = useMemo<OutletTierConfig>(() => {
    const topParam = searchParams.get("tierTop");
    const midParam = searchParams.get("tierMid");
    const bottomParam = searchParams.get("tierBottom");
    return {
      top: topParam !== null ? Number(topParam) : tierConfig.top,
      mid: midParam !== null ? Number(midParam) : tierConfig.mid,
      bottom:
        bottomParam !== null ? Number(bottomParam) : tierConfig.bottom,
    };
  }, [searchParams, tierConfig]);

  // True when at least one URL-param override is active, so the legend can
  // surface "URL override active" text for the operator.
  const hasOverride =
    searchParams.get("redMax") !== null ||
    searchParams.get("greenMin") !== null ||
    searchParams.get("tierTop") !== null ||
    searchParams.get("tierMid") !== null ||
    searchParams.get("tierBottom") !== null;

  const emptyData: HeatMapData = {
    topPerformers: [],
    bottomPerformers: [],
    allPerformers: [],
    scoreWeights: {
      revenue: 0.3,
      transactions: 0.2,
      revenuePerRoom: 0.25,
      txnPerKiosk: 0.15,
      basketValue: 0.1,
    },
  };

  const heatMap = data ?? emptyData;

  const hasTopData = heatMap.topPerformers.length > 0;
  const hasBottomData = heatMap.bottomPerformers.length > 0;
  const hasAllData = heatMap.allPerformers.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Performance Heat Map"
        description="Composite scoring across revenue, transactions, and capacity metrics"
      />

      {/* Phase 6 plan 06-05 — threshold legend. Shows the active red/green
          cutoffs so an operator can see at a glance whether URL-param
          overrides are in effect. The visible text is the assertion surface
          the Playwright override spec keys off. */}
      {!loading && (
        <div
          data-testid="threshold-legend"
          className="rounded-lg border bg-muted/30 px-4 py-2 text-xs text-muted-foreground flex flex-wrap items-center gap-3"
        >
          <span>
            Red: ≤{effectiveThresholds.redMax.toLocaleString()}
          </span>
          <span className="opacity-50">·</span>
          <span>
            Green: ≥{effectiveThresholds.greenMin.toLocaleString()}
          </span>
          <span className="opacity-50">·</span>
          <span>
            Tiers: {effectiveTiers.top}/{effectiveTiers.mid}/
            {effectiveTiers.bottom}
          </span>
          {hasOverride && (
            <span className="font-medium text-amber-700 dark:text-amber-400">
              URL override active
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <ChartCard
        title="Score Weights"
        description="Configure how each metric contributes to the composite score"
        loading={false}
        collapsible
      >
        <WeightEditor />
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard
          title="Top 20 Performers"
          description="Highest composite scores for the selected period"
          loading={loading}
          empty={!loading && !hasTopData}
          emptyMessage="No top performer data available"
          collapsible
        >
          <PerformanceTable
            data={heatMap.topPerformers}
            title="Top 20 Performers"
            thresholdConfig={effectiveThresholds}
            flags={flags}
            onFlagCreated={loadData}
            referenceDate={filters.dateTo}
          />
        </ChartCard>

        <ChartCard
          title="Bottom 20 Performers"
          description="Lowest composite scores for the selected period"
          loading={loading}
          empty={!loading && !hasBottomData}
          emptyMessage="No bottom performer data available"
          collapsible
        >
          <PerformanceTable
            data={heatMap.bottomPerformers}
            title="Bottom 20 Performers"
            thresholdConfig={effectiveThresholds}
            flags={flags}
            onFlagCreated={loadData}
            referenceDate={filters.dateTo}
          />
        </ChartCard>
      </div>

      <ChartCard
        title="All Hotels"
        description="Every hotel ranked by composite score"
        loading={loading}
        empty={!loading && !hasAllData}
        emptyMessage="No hotel performance data available"
        collapsible
        defaultCollapsed
      >
        <PerformanceTable
          data={heatMap.allPerformers}
          title="All Hotels"
          thresholdConfig={thresholdConfig}
          flags={flags}
          onFlagCreated={loadData}
          referenceDate={filters.dateTo}
        />
      </ChartCard>
    </div>
  );
}
