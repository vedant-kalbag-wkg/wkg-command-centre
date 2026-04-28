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
        tooltip="In Sales mode: SUM(netAmount) WHERE NOT is_weknow_fee AND NOT is_reversal — gross customer purchases at outlets in this region. In Revenue mode: SUM(netAmount) WHERE is_weknow_fee — WKG's booking-fee + cash-handling-fee take only. Excludes internal accounts and outlets with no region membership (per audit-fix D1, D9, D10)."
        value={formatCurrency(metrics.revenue)}
        change={revenueChange}
        loading={loading}
        primary
      />
      <KpiCard
        title="Transactions"
        tooltip="COUNT(*) WHERE NOT is_weknow_fee AND NOT is_reversal across outlets in this region. Counts non-fee, non-refund customer transactions only. Mode-invariant — same number in Sales and Revenue mode (per audit-fix D1+D2)."
        value={formatNumber(metrics.transactions)}
        change={txnChange}
        loading={loading}
      />
      <KpiCard
        title="Hotel Groups"
        tooltip="Distinct hotel groups with at least one active outlet in this region. Counts groups via the deduped membership path (location_hotel_group_memberships) so a multi-region JV group is counted once per region it actually serves (per audit-fix D5)."
        value={formatNumber(metrics.hotelGroupCount)}
        loading={loading}
      />
      <KpiCard
        title="Location Groups"
        tooltip="Distinct location groups (operating-cluster rollups, e.g. 'Heathrow Hotels') with at least one active outlet in this region. One-membership-per-location enforced (per audit-fix D5)."
        value={formatNumber(metrics.locationGroupCount)}
        loading={loading}
      />
    </div>
  );
}
