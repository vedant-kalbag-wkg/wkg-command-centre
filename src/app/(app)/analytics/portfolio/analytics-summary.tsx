"use client";

import {
  DollarSign,
  ShoppingCart,
  Package,
  TrendingUp,
  Layers,
  Building2,
} from "lucide-react";
import { KpiCard } from "@/components/analytics/kpi-card";
import {
  formatCurrency,
  formatNumber,
  formatChangeIndicator,
} from "@/lib/analytics/formatters";
import { calculatePeriodChange } from "@/lib/analytics/metrics";
import type { PortfolioSummary } from "@/lib/analytics/types";

interface AnalyticsSummaryProps {
  summary: PortfolioSummary;
  previousSummary: PortfolioSummary | null;
  loading?: boolean;
}

export function AnalyticsSummary({
  summary,
  previousSummary,
  loading = false,
}: AnalyticsSummaryProps) {
  const change = (current: number, previous: number | undefined) => {
    if (previous === undefined) return undefined;
    const pct = calculatePeriodChange(current, previous);
    return pct !== null ? formatChangeIndicator(pct) : undefined;
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard
        title="Total Revenue"
        value={formatCurrency(summary.totalRevenue)}
        change={change(summary.totalRevenue, previousSummary?.totalRevenue)}
        loading={loading}
        primary
        icon={<DollarSign className="size-3.5" />}
      />
      <KpiCard
        title="Transactions"
        value={formatNumber(summary.totalTransactions)}
        change={change(
          summary.totalTransactions,
          previousSummary?.totalTransactions,
        )}
        loading={loading}
        icon={<ShoppingCart className="size-3.5" />}
      />
      <KpiCard
        title="Quantity"
        value={formatNumber(summary.totalQuantity)}
        change={change(summary.totalQuantity, previousSummary?.totalQuantity)}
        loading={loading}
        icon={<Package className="size-3.5" />}
      />
      <KpiCard
        title="Avg Basket"
        value={formatCurrency(summary.avgBasketValue)}
        change={change(
          summary.avgBasketValue,
          previousSummary?.avgBasketValue,
        )}
        loading={loading}
        icon={<TrendingUp className="size-3.5" />}
      />
      <KpiCard
        title="Unique Products"
        value={formatNumber(summary.uniqueProducts)}
        change={change(
          summary.uniqueProducts,
          previousSummary?.uniqueProducts,
        )}
        loading={loading}
        icon={<Layers className="size-3.5" />}
      />
      <KpiCard
        title="Unique Outlets"
        value={formatNumber(summary.uniqueOutlets)}
        change={change(summary.uniqueOutlets, previousSummary?.uniqueOutlets)}
        loading={loading}
        icon={<Building2 className="size-3.5" />}
      />
    </div>
  );
}
