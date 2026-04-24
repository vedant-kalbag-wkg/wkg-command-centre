"use client";

import { KpiCard } from "@/components/analytics/kpi-card";
import {
  formatCurrency,
  formatNumber,
  formatChangeIndicator,
} from "@/lib/analytics/formatters";
import { calculatePeriodChange } from "@/lib/analytics/metrics";
import { useMetricLabel } from "@/lib/analytics/metric-label";
import type { RegionDetail } from "@/lib/analytics/types";

interface RegionMetricsProps {
  detail: RegionDetail;
  loading?: boolean;
}

export function RegionMetrics({ detail, loading = false }: RegionMetricsProps) {
  const metricLabel = useMetricLabel();
  const { metrics, previousMetrics } = detail;

  const revenueChange = previousMetrics
    ? formatChangeIndicator(calculatePeriodChange(metrics.revenue, previousMetrics.revenue))
    : undefined;
  const txnChange = previousMetrics
    ? formatChangeIndicator(calculatePeriodChange(metrics.transactions, previousMetrics.transactions))
    : undefined;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard
        title={metricLabel}
        value={formatCurrency(metrics.revenue)}
        change={revenueChange}
        loading={loading}
        primary
      />
      <KpiCard
        title="Transactions"
        value={formatNumber(metrics.transactions)}
        change={txnChange}
        loading={loading}
      />
      <KpiCard
        title="Hotel Groups"
        value={formatNumber(metrics.hotelGroupCount)}
        loading={loading}
      />
      <KpiCard
        title="Location Groups"
        value={formatNumber(metrics.locationGroupCount)}
        loading={loading}
      />
    </div>
  );
}
