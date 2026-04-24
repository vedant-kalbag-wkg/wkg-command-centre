import { useAnalyticsFilterStore } from "@/lib/stores/analytics-filter-store";
import type { MetricMode } from "@/lib/analytics/types";

export function metricLabel(mode: MetricMode | undefined): string {
  return mode === "revenue" ? "Revenue" : "Sales";
}

export function useMetricLabel(): string {
  return useAnalyticsFilterStore((s) => metricLabel(s.metricMode));
}
