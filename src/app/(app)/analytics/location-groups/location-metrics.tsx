"use client";

import { KpiCard } from "@/components/analytics/kpi-card";
import {
  formatCurrency,
  formatNumber,
  formatNullValue,
  formatChangeIndicator,
} from "@/lib/analytics/formatters";
import { calculatePeriodChange } from "@/lib/analytics/metrics";
import type { LocationGroupDetail } from "@/lib/analytics/types";

interface LocationMetricsProps {
  detail: LocationGroupDetail;
  loading?: boolean;
}

export function LocationMetrics({ detail, loading = false }: LocationMetricsProps) {
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
        title="Revenue"
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
        title="Hotels"
        value={formatNumber(metrics.hotelCount)}
        loading={loading}
      />
      <KpiCard
        title="Total Rooms"
        value={formatNullValue(metrics.totalRooms, formatNumber)}
        loading={loading}
      />
    </div>
  );
}
