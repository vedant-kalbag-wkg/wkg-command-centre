"use client";

import { KpiCard } from "@/components/analytics/kpi-card";
import {
  formatCurrency,
  formatNumber,
  formatNullValue,
} from "@/lib/analytics/formatters";
import type { LocationGroupDetail } from "@/lib/analytics/types";

interface CapacityMetricsProps {
  capacityMetrics: LocationGroupDetail["capacityMetrics"];
  loading?: boolean;
}

export function CapacityMetrics({ capacityMetrics, loading = false }: CapacityMetricsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard
        title="Rev / Room"
        tooltip="Revenue ÷ Total Rooms (per-location-deduped). Capacity-normalised yield: how much each available room is generating. Sales mode uses non-fee revenue; Revenue mode uses WKG fee take. Total Rooms uses per-location aggregation to avoid double-counting (audit-fix 2.1, PR-7)."
        value={formatNullValue(capacityMetrics.revenuePerRoom, formatCurrency)}
        loading={loading}
        primary
      />
      <KpiCard
        title="Txn / Room"
        tooltip="Transactions ÷ Total Rooms. Throughput per available room: how many non-fee, non-refund customer transactions each room generates. Mode-invariant (transactions are the same in Sales and Revenue mode — per audit-fix D1+D2)."
        value={formatNullValue(capacityMetrics.txnPerRoom, (v) => formatNumber(v, 1))}
        loading={loading}
      />
      <KpiCard
        title="Txn / Kiosk"
        tooltip="Transactions ÷ Total Kiosks (active kiosks at active locations in this group, via locationGroupKiosksSubquery). Throughput per physical POS unit. Mode-invariant. Per location-groups handoff §4 follow-up — fixed in PR-28."
        value={formatNullValue(capacityMetrics.txnPerKiosk, (v) => formatNumber(v, 1))}
        loading={loading}
      />
      <KpiCard
        title="Avg Basket"
        value={formatCurrency(capacityMetrics.avgBasketValue)}
        loading={loading}
        // Phase 6.5 / 8.5 — Avg Basket has subtly different definitions
        // across dashboards. State the formula in-place so the operator
        // knows whether the figure includes fees, reversals, etc.
        tooltip="Total revenue ÷ total transactions in the selected window. Excludes booking and cash-handling fees and excludes reversed transactions. Updates with the metric-mode toggle (Sales vs Revenue)."
      />
      <KpiCard
        title="Total Rooms"
        tooltip="SUM(rooms) across active locations in this group, deduped per location (subquery aggregation per audit-fix 2.1 / PR-7). Pre-fix this used SUM(DISTINCT) on a JOINed table and silently misreported (e.g. Heathrow showed 1.79M rooms)."
        value={formatNullValue(capacityMetrics.totalRooms, formatNumber)}
        loading={loading}
      />
      <KpiCard
        title="Total Kiosks"
        tooltip="Active (archived_at IS NULL) kiosks at active locations in this group, via locationGroupKiosksSubquery (handoff §4 follow-up, PR-28). Replaced an earlier NULL placeholder so Txn/Kiosk now renders a real value at the summary level."
        value={formatNullValue(capacityMetrics.totalKiosks, formatNumber)}
        loading={loading}
      />
    </div>
  );
}
