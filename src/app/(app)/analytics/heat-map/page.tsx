"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import {
  useHeatmapWeightsStore,
  toScoreWeights,
} from "@/lib/stores/heatmap-weights-store";
import { PageHeader } from "@/components/layout/page-header";
import { ChartCard } from "@/components/ui/chart-card";
import { fetchHeatMapData, fetchThresholdConfig, fetchActiveFlags } from "./actions";
import { WeightEditor } from "./weight-editor";
import { PerformanceTable } from "./performance-table";
import type { HeatMapData, LocationFlag } from "@/lib/analytics/types";
import type { ThresholdConfig } from "@/lib/analytics/thresholds";

export default function HeatMapPage() {
  const filters = useAnalyticsFilters();
  const appliedWeights = useHeatmapWeightsStore((s) => s.weights);
  const [data, setData] = useState<HeatMapData | null>(null);
  const [thresholdConfig, setThresholdConfig] = useState<ThresholdConfig>({ redMax: 500, greenMin: 1500 });
  const [flags, setFlags] = useState<LocationFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filtersJson = JSON.stringify(filters);
  const weightsJson = JSON.stringify(appliedWeights);
  const abortRef = useRef<AbortController | null>(null);

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const parsedFilters = JSON.parse(filtersJson);
      const parsedWeights = JSON.parse(weightsJson);
      const [result, thresholds, activeFlags] = await Promise.all([
        fetchHeatMapData(parsedFilters, toScoreWeights(parsedWeights)),
        fetchThresholdConfig(),
        fetchActiveFlags(),
      ]);
      if (!controller.signal.aborted) {
        setData(result);
        setThresholdConfig(thresholds);
        setFlags(activeFlags);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "Failed to load heat map data",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [filtersJson, weightsJson]);

  useEffect(() => {
    loadData();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadData]);

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
            thresholdConfig={thresholdConfig}
            flags={flags}
            onFlagCreated={loadData}
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
            thresholdConfig={thresholdConfig}
            flags={flags}
            onFlagCreated={loadData}
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
        />
      </ChartCard>
    </div>
  );
}
