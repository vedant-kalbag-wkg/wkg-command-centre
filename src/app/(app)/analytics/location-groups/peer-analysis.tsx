"use client";

import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/analytics/empty-state";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import type { LocationGroupDetail } from "@/lib/analytics/types";

interface PeerAnalysisProps {
  data: LocationGroupDetail["peerAnalysis"];
}

function percentileColorClass(percentile: number): string {
  if (percentile >= 75) return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
  if (percentile >= 50) return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400";
  if (percentile >= 25) return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";
  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
}

function formatMetricValue(metric: string, value: number): string {
  if (metric.toLowerCase().includes("revenue") || metric.toLowerCase().includes("basket")) {
    return formatCurrency(value);
  }
  return formatNumber(value);
}

export function PeerAnalysis({ data }: PeerAnalysisProps) {
  if (data.length === 0) {
    return <EmptyState message="No peer comparison data available" />;
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {data.map((item) => (
        <div
          key={item.metric}
          className="rounded-lg border p-4 flex flex-col gap-2"
        >
          <span className="text-xs text-muted-foreground">{item.metric}</span>
          <span className="text-lg font-semibold">
            {formatMetricValue(item.metric, item.value)}
          </span>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  percentileColorClass(item.percentile),
                )}
                style={{ width: `${Math.min(item.percentile, 100)}%` }}
              />
            </div>
            <span
              className={cn(
                "inline-block rounded-md px-2 py-0.5 text-xs font-semibold",
                percentileColorClass(item.percentile),
              )}
            >
              P{Math.round(item.percentile)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
