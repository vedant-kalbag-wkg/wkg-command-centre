"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  DollarSign,
  Receipt,
  Percent,
  Hash,
} from "lucide-react";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import { PageHeader } from "@/components/layout/page-header";
import { ChartCard } from "@/components/ui/chart-card";
import { KpiCard } from "@/components/analytics/kpi-card";
import { ChartWrapper } from "@/components/analytics/chart-wrapper";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
  formatNumber,
  formatChangeIndicator,
} from "@/lib/analytics/formatters";
import {
  fetchCommissionSummary,
  fetchCommissionByLocation,
  fetchCommissionByProduct,
  fetchCommissionMonthlyTrend,
  type CommissionSummary,
  type CommissionByLocation,
  type CommissionByProduct,
  type CommissionMonthlyTrend,
} from "./actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CommissionData = {
  summary: CommissionSummary;
  byLocation: CommissionByLocation[];
  byProduct: CommissionByProduct[];
  monthlyTrend: CommissionMonthlyTrend[];
};

// ---------------------------------------------------------------------------
// Empty defaults
// ---------------------------------------------------------------------------

const emptySummary: CommissionSummary = {
  totalCommission: 0,
  totalCommissionable: 0,
  avgRate: 0,
  recordCount: 0,
  prevTotalCommission: null,
  prevTotalCommissionable: null,
  prevAvgRate: null,
  prevRecordCount: null,
  commissionDelta: null,
  commissionableDelta: null,
  rateDelta: null,
  recordDelta: null,
};

const emptyData: CommissionData = {
  summary: emptySummary,
  byLocation: [],
  byProduct: [],
  monthlyTrend: [],
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CommissionPage() {
  const filters = useAnalyticsFilters();
  const [data, setData] = useState<CommissionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filtersJson = JSON.stringify(filters);
  const abortRef = useRef<AbortController | null>(null);

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(filtersJson);
      const [summary, byLocation, byProduct, monthlyTrend] = await Promise.all([
        fetchCommissionSummary(parsed),
        fetchCommissionByLocation(parsed),
        fetchCommissionByProduct(parsed),
        fetchCommissionMonthlyTrend(parsed),
      ]);

      if (!controller.signal.aborted) {
        setData({ summary, byLocation, byProduct, monthlyTrend });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "Failed to load commission data",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [filtersJson]);

  useEffect(() => {
    loadData();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadData]);

  const d = data ?? emptyData;
  const hasLocationData = d.byLocation.length > 0;
  const hasProductData = d.byProduct.length > 0;
  const hasMonthlyData = d.monthlyTrend.length > 0;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Commission Analytics"
        description="Commission performance across locations and products"
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* KPI Cards */}
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              title="Total Commission"
              value={formatCurrency(d.summary.totalCommission)}
              change={
                d.summary.commissionDelta !== null
                  ? formatChangeIndicator(d.summary.commissionDelta)
                  : undefined
              }
              primary
              icon={<DollarSign className="size-3.5" />}
            />
            <KpiCard
              title="Commissionable Revenue"
              value={formatCurrency(d.summary.totalCommissionable)}
              change={
                d.summary.commissionableDelta !== null
                  ? formatChangeIndicator(d.summary.commissionableDelta)
                  : undefined
              }
              icon={<Receipt className="size-3.5" />}
            />
            <KpiCard
              title="Average Rate"
              value={`${d.summary.avgRate.toFixed(2)}%`}
              change={
                d.summary.rateDelta !== null
                  ? {
                      text: `${d.summary.rateDelta >= 0 ? "+" : ""}${d.summary.rateDelta.toFixed(2)}pp`,
                      color: d.summary.rateDelta >= 0 ? "#16A34A" : "#DC2626",
                      direction: d.summary.rateDelta >= 0 ? "up" : "down",
                    }
                  : undefined
              }
              icon={<Percent className="size-3.5" />}
            />
            <KpiCard
              title="Records with Commission"
              value={formatNumber(d.summary.recordCount)}
              change={
                d.summary.recordDelta !== null
                  ? formatChangeIndicator(d.summary.recordDelta)
                  : undefined
              }
              icon={<Hash className="size-3.5" />}
            />
          </div>
        )}

        {/* By Location */}
        <ChartCard
          title="By Location"
          description="Commission totals and effective rates per location"
          loading={loading}
          empty={!loading && !hasLocationData}
          emptyMessage="No commission data by location"
          collapsible
        >
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Location</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">Commissionable</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">Commission</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">Eff. Rate</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground text-right"># Records</th>
                </tr>
              </thead>
              <tbody>
                {d.byLocation.map((row) => (
                  <tr key={row.locationName} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{row.locationName}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(row.commissionable)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(row.commission)}</td>
                    <td className="px-4 py-2 text-right">{row.effectiveRate.toFixed(2)}%</td>
                    <td className="px-4 py-2 text-right">{formatNumber(row.recordCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>

        {/* By Product */}
        <ChartCard
          title="By Product"
          description="Commission totals and effective rates per product"
          loading={loading}
          empty={!loading && !hasProductData}
          emptyMessage="No commission data by product"
          collapsible
        >
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Product</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">Commissionable</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">Commission</th>
                  <th className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground text-right">Eff. Rate</th>
                </tr>
              </thead>
              <tbody>
                {d.byProduct.map((row) => (
                  <tr key={row.productName} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{row.productName}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(row.commissionable)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(row.commission)}</td>
                    <td className="px-4 py-2 text-right">{row.effectiveRate.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>

        {/* Monthly Trend */}
        <ChartCard
          title="Monthly Trend"
          description="Commission totals across months"
          loading={loading}
          empty={!loading && !hasMonthlyData}
          emptyMessage="No monthly commission data"
          collapsible
        >
          <ChartWrapper>
            <BarChart
              data={d.monthlyTrend}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis
                tickFormatter={(v: number) => formatCurrency(v)}
                fontSize={12}
              />
              <Tooltip
                formatter={(value) => [formatCurrency(Number(value)), "Commission"]}
                labelFormatter={(label) => `Month: ${String(label)}`}
              />
              <Bar dataKey="commission" fill="#00A6D3" name="Commission" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartWrapper>
        </ChartCard>
      </div>
    </div>
  );
}
