"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import { SectionAccordion } from "@/components/analytics/section-accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchHeatMapData, fetchThresholdConfig, fetchActiveFlags } from "./actions";
import { ScoreLegend } from "./score-legend";
import { PerformanceTable } from "./performance-table";
import type { HeatMapData, LocationFlag } from "@/lib/analytics/types";
import type { ThresholdConfig } from "@/lib/analytics/thresholds";

type ViewMode = "top" | "bottom" | "all";

export default function HeatMapPage() {
  const filters = useAnalyticsFilters();
  const [data, setData] = useState<HeatMapData | null>(null);
  const [thresholdConfig, setThresholdConfig] = useState<ThresholdConfig>({ redMax: 500, greenMin: 1500 });
  const [flags, setFlags] = useState<LocationFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("top");

  const filtersJson = JSON.stringify(filters);
  const abortRef = useRef<AbortController | null>(null);

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(filtersJson);
      const [result, thresholds, activeFlags] = await Promise.all([
        fetchHeatMapData(parsed),
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
  }, [filtersJson]);

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

  const viewData =
    view === "top"
      ? heatMap.topPerformers
      : view === "bottom"
        ? heatMap.bottomPerformers
        : heatMap.allPerformers;

  const viewTitle =
    view === "top"
      ? "Top 20 Performers"
      : view === "bottom"
        ? "Bottom 20 Performers"
        : "All Hotels";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Performance Heat Map
        </h1>
        <p className="text-sm text-muted-foreground">
          Composite scoring across revenue, transactions, and capacity metrics
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <SectionAccordion title="Score Weights">
        {loading ? (
          <Skeleton className="h-16 rounded-lg" />
        ) : (
          <ScoreLegend weights={heatMap.scoreWeights} />
        )}
      </SectionAccordion>

      <SectionAccordion
        title="Performance Rankings"
        actions={
          <Tabs
            value={view}
            onValueChange={(v) => setView(v as ViewMode)}
          >
            <TabsList className="h-7">
              <TabsTrigger value="top" className="text-xs px-2 py-0.5">
                Top 20
              </TabsTrigger>
              <TabsTrigger value="bottom" className="text-xs px-2 py-0.5">
                Bottom 20
              </TabsTrigger>
              <TabsTrigger value="all" className="text-xs px-2 py-0.5">
                All
              </TabsTrigger>
            </TabsList>
          </Tabs>
        }
      >
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : (
          <PerformanceTable data={viewData} title={viewTitle} thresholdConfig={thresholdConfig} flags={flags} onFlagCreated={loadData} />
        )}
      </SectionAccordion>
    </div>
  );
}
