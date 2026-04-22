"use client";

import { useEffect, useState, useTransition } from "react";
import { ChartCard } from "@/components/ui/chart-card";
import { LowPerformerPatterns } from "../low-performer-patterns";
import { fetchLowPerformerPatterns } from "../actions";
import { usePerformerThresholdStore } from "@/lib/stores/performer-threshold-store";
import type {
  AnalyticsFilters,
  LowPerformerPatterns as LowPerformerPatternsData,
} from "@/lib/analytics/types";

interface Props {
  filters: AnalyticsFilters;
}

/**
 * Client island — `redCutoff` is Zustand-persisted client state (localStorage),
 * so the server can't pre-render this. Refetches whenever filters or the cutoff
 * change. Uses `useTransition` so the loading flag flip isn't a synchronous
 * setState inside the effect body (React 19 / react-hooks/set-state-in-effect).
 */
export function LowPerformerIsland({ filters }: Props) {
  const redCutoff = usePerformerThresholdStore((s) => s.redCutoff);
  const [data, setData] = useState<LowPerformerPatternsData | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtersJson = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      try {
        const result = await fetchLowPerformerPatterns(
          JSON.parse(filtersJson) as AnalyticsFilters,
          redCutoff,
        );
        if (!cancelled) setData(result);
      } catch (err) {
        console.error("[low-performer-island]", err);
        if (!cancelled) setData(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filtersJson, redCutoff]);

  const hasData = !!data && (data.redCount > 0 || data.totalCount > 0);
  const loading = isPending && data === null;

  return (
    <ChartCard
      title="Low Performer Patterns"
      description="Traits shared by bottom-tier outlets"
      className="gap-0 py-0 lg:col-span-12"
      loading={loading}
      empty={!loading && !hasData}
      emptyMessage="No performance data for selected filters"
      collapsible
    >
      {data && <LowPerformerPatterns data={data} />}
    </ChartCard>
  );
}
