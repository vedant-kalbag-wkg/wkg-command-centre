"use client";

import { useEffect, useState, useTransition } from "react";
import { ChartCard } from "@/components/ui/chart-card";
import { HighPerformerPatterns } from "../high-performer-patterns";
import { fetchHighPerformerPatterns } from "../actions";
import { usePerformerThresholdStore } from "@/lib/stores/performer-threshold-store";
import type {
  AnalyticsFilters,
  HighPerformerPatterns as HighPerformerPatternsData,
} from "@/lib/analytics/types";

interface Props {
  filters: AnalyticsFilters;
}

/**
 * Client island — `greenCutoff` is Zustand-persisted client state (localStorage),
 * so the server can't pre-render this. Refetches whenever filters or the cutoff
 * change. Uses `useTransition` so the loading flag flip isn't a synchronous
 * setState inside the effect body (React 19 / react-hooks/set-state-in-effect).
 */
export function HighPerformerIsland({ filters }: Props) {
  const greenCutoff = usePerformerThresholdStore((s) => s.greenCutoff);
  const [data, setData] = useState<HighPerformerPatternsData | null>(null);
  const [isPending, startTransition] = useTransition();

  // Serialise filters for a stable effect dep.
  const filtersJson = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      try {
        const result = await fetchHighPerformerPatterns(
          JSON.parse(filtersJson) as AnalyticsFilters,
          greenCutoff,
        );
        if (!cancelled) setData(result);
      } catch (err) {
        console.error("[high-performer-island]", err);
        if (!cancelled) setData(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filtersJson, greenCutoff]);

  const hasData = !!data && (data.greenCount > 0 || data.totalCount > 0);
  const loading = isPending && data === null;

  return (
    <ChartCard
      title="High Performer Patterns"
      description="Traits shared by top-tier outlets"
      className="gap-0 py-0 lg:col-span-12"
      loading={loading}
      empty={!loading && !hasData}
      emptyMessage="No performance data for selected filters"
      collapsible
    >
      {data && <HighPerformerPatterns data={data} />}
    </ChartCard>
  );
}
