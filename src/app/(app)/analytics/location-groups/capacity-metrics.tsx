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
        value={formatNullValue(capacityMetrics.revenuePerRoom, formatCurrency)}
        loading={loading}
        primary
      />
      <KpiCard
        title="Txn / Room"
        value={formatNullValue(capacityMetrics.txnPerRoom, (v) => formatNumber(v, 1))}
        loading={loading}
      />
      <KpiCard
        title="Txn / Kiosk"
        value={formatNullValue(capacityMetrics.txnPerKiosk, (v) => formatNumber(v, 1))}
        loading={loading}
      />
      <KpiCard
        title="Avg Basket"
        value={formatCurrency(capacityMetrics.avgBasketValue)}
        loading={loading}
      />
      <KpiCard
        title="Total Rooms"
        value={formatNullValue(capacityMetrics.totalRooms, formatNumber)}
        loading={loading}
      />
      <KpiCard
        title="Total Kiosks"
        value={formatNullValue(capacityMetrics.totalKiosks, formatNumber)}
        loading={loading}
      />
    </div>
  );
}
