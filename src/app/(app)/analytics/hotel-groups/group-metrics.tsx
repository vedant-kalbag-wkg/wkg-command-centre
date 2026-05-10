"use client";

import { KpiCard } from "@/components/analytics/kpi-card";
import {
  formatCurrency,
  formatNativeCurrency,
  formatNumber,
  formatChangeIndicator,
} from "@/lib/analytics/formatters";
import { pickRevenueDisplay } from "@/lib/analytics/revenue-display";
import { calculatePeriodChange } from "@/lib/analytics/metrics";
import { useMetricLabel } from "@/lib/analytics/metric-label";
import type { HotelGroupDetail } from "@/lib/analytics/types";

interface GroupMetricsProps {
  detail: HotelGroupDetail;
  loading?: boolean;
}

export function GroupMetrics({ detail, loading = false }: GroupMetricsProps) {
  const metricLabel = useMetricLabel();
  const { metrics, previousMetrics } = detail;

  // Phase 9.1 / D-10 auto-pick (single source-of-truth via pickRevenueDisplay):
  // when this hotel group's sales are all in a single currency the KPI tile
  // shows the native total; when the group spans multiple currencies (e.g.
  // an international chain) the tile auto-converts to GBP using the BoE rate
  // locked at the time of each sale. The "Avg / Hotel" tile follows the same
  // dispatch — both use the same currency_key resolver so the symbol stays
  // consistent across the row.
  const picked = pickRevenueDisplay({
    revenue_native: String(metrics.revenueNative),
    revenue_gbp: String(metrics.revenue),
    currency_key: metrics.currencyKey,
  });
  const isSingleCurrency = picked.currency !== "GBP";
  const renderedRevenue =
    picked.currency === "GBP"
      ? formatCurrency(picked.value)
      : formatNativeCurrency(picked.value, picked.currency);
  const renderedAvgPerHotel = isSingleCurrency
    ? formatNativeCurrency(metrics.avgRevenuePerHotelNative, picked.currency)
    : formatCurrency(metrics.avgRevenuePerHotel);

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
        tooltip="In Sales mode: SUM(netAmount) WHERE NOT is_weknow_fee AND NOT is_reversal — gross customer purchases at outlets in this hotel group. In Revenue mode: SUM(netAmount) WHERE is_weknow_fee — WKG's booking-fee + cash-handling-fee take only. Excludes internal accounts (per audit-fix D1, D9, D10). Per D-10: when this group spans a single currency the cell shows the native total; when it spans multiple currencies the cell auto-converts to GBP using the BoE rate locked at the time of each sale."
        value={renderedRevenue}
        change={revenueChange}
        loading={loading}
        primary
      />
      <KpiCard
        title="Transactions"
        tooltip="COUNT(*) WHERE NOT is_weknow_fee AND NOT is_reversal across outlets in this hotel group. Counts non-fee, non-refund customer transactions only. Mode-invariant — same number in Sales and Revenue mode (per audit-fix D1+D2)."
        value={formatNumber(metrics.transactions)}
        change={txnChange}
        loading={loading}
      />
      <KpiCard
        title="Hotels"
        tooltip="Distinct count of active (archived_at IS NULL) locations linked to this hotel group via location_hotel_group_memberships. Internal accounts excluded by default — toggle 'Show internal accounts' on the FilterBar to include (per audit-fix D5+D9)."
        value={formatNumber(metrics.hotelCount)}
        loading={loading}
      />
      <KpiCard
        title={`Avg ${metricLabel} / Hotel`}
        tooltip={`${metricLabel} ÷ Hotels — average ${metricLabel.toLowerCase()} per active outlet in this hotel group, in the selected window. Both terms exclude reversals; Sales also excludes WKG fees, Revenue uses fee rows only (per audit-fix D1+D2). Per D-10: native cohort → native symbol; multi-currency cohort → GBP.`}
        value={renderedAvgPerHotel}
        loading={loading}
      />
    </div>
  );
}
