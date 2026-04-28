"use client";

import { KpiCard } from "@/components/analytics/kpi-card";
import {
  formatCurrency,
  formatNumber,
  formatNullValue,
  formatChangeIndicator,
} from "@/lib/analytics/formatters";
import { calculatePeriodChange } from "@/lib/analytics/metrics";
import { useMetricLabel } from "@/lib/analytics/metric-label";
import type { LocationGroupDetail } from "@/lib/analytics/types";

interface LocationMetricsProps {
  detail: LocationGroupDetail;
  loading?: boolean;
}

export function LocationMetrics({ detail, loading = false }: LocationMetricsProps) {
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
        tooltip="In Sales mode: SUM(netAmount) WHERE NOT is_weknow_fee AND NOT is_reversal — gross customer purchases at outlets in this location group. In Revenue mode: SUM(netAmount) WHERE is_weknow_fee — WKG's booking-fee + cash-handling-fee take only. Excludes internal accounts (per audit-fix D1, D9, D10)."
        value={formatCurrency(metrics.revenue)}
        change={revenueChange}
        loading={loading}
        primary
      />
      <KpiCard
        title="Transactions"
        tooltip="COUNT(*) WHERE NOT is_weknow_fee AND NOT is_reversal across outlets in this location group. Counts non-fee, non-refund customer transactions only. Mode-invariant — same number in Sales and Revenue mode (per audit-fix D1+D2)."
        value={formatNumber(metrics.transactions)}
        change={txnChange}
        loading={loading}
      />
      <KpiCard
        title="Hotels"
        tooltip="Distinct count of active (archived_at IS NULL) locations linked to this location group. One-membership-per-location enforced (per audit-fix D5, PR-6)."
        value={formatNumber(metrics.hotelCount)}
        loading={loading}
      />
      <KpiCard
        title="Total Rooms"
        tooltip="SUM(rooms) across active locations in this group, deduped per location via subquery aggregation (audit-fix 2.1 / PR-7). Pre-fix this used SUM(DISTINCT) on a JOIN and silently misreported."
        value={formatNullValue(metrics.totalRooms, formatNumber)}
        loading={loading}
      />
    </div>
  );
}
