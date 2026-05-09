"use client";

import { KpiCard } from "@/components/analytics/kpi-card";
import {
  formatCurrency,
  formatNativeCurrency,
  formatNumber,
  formatNullValue,
  formatChangeIndicator,
} from "@/lib/analytics/formatters";
import { pickRevenueDisplay } from "@/lib/analytics/queries/shared";
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

  // Phase 9.1 / D-10 auto-pick (single source-of-truth via pickRevenueDisplay):
  // when this location group's sales are all in a single currency the KPI
  // tile shows the native total; when the group spans multiple currencies
  // the tile auto-converts to GBP using the BoE rate locked at the time of
  // each sale. % change vs previous period stays GBP-on-GBP per D-12 —
  // comparing native totals across periods would drift with FX volatility.
  const picked = pickRevenueDisplay({
    revenue_native: String(metrics.revenueNative),
    revenue_gbp: String(metrics.revenue),
    currency_key: metrics.currencyKey,
  });
  const renderedRevenue =
    picked.currency === "GBP"
      ? formatCurrency(picked.value)
      : formatNativeCurrency(picked.value, picked.currency);

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
        tooltip="In Sales mode: SUM(netAmount) WHERE NOT is_weknow_fee AND NOT is_reversal — gross customer purchases at outlets in this location group. In Revenue mode: SUM(netAmount) WHERE is_weknow_fee — WKG's booking-fee + cash-handling-fee take only. Excludes internal accounts (per audit-fix D1, D9, D10). Per D-10: when this group spans a single currency the cell shows the native total; when it spans multiple currencies the cell auto-converts to GBP using the BoE rate locked at the time of each sale."
        value={renderedRevenue}
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
