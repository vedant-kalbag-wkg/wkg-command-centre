"use client";

import { useEffect, useState, useCallback } from "react";
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
import { useAbortableAction } from "@/lib/analytics/use-abortable-action";
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

  // Discard stale server-action results on unmount / newer dispatch.
  const fetchSummary = useAbortableAction(fetchCommissionSummary);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(filtersJson);
      const [summary, byLocation, byProduct, monthlyTrend] = await Promise.all([
        fetchSummary(parsed),
        fetchCommissionByLocation(parsed),
        fetchCommissionByProduct(parsed),
        fetchCommissionMonthlyTrend(parsed),
      ]);

      // `null` from the abortable dispatcher means a newer call superseded
      // this one (or the component unmounted) — discard this batch.
      if (summary === null) return;
      setData({ summary, byLocation, byProduct, monthlyTrend });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load commission data",
      );
    } finally {
      setLoading(false);
    }
  }, [filtersJson, fetchSummary]);

  useEffect(() => {
    loadData();
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
            {/* Tooltip text authored 2026-04-28 — values derive from
                fetchCommissionSummary (./actions.ts) which sums sales_records.commission_amount
                under buildCommissionWhere (PR-15). Phase 9.1 / D-15: this view
                is always GBP-normalised. Commission is paid out in GBP
                regardless of source-sale currency, so the page pins to GBP
                via formatCurrency rather than auto-picking native vs GBP per
                D-10 (which is the rule for cross-portfolio analytics tiles
                like /regions, /hotel-groups, /location-groups). */}
            <KpiCard
              title="Total Commission"
              tooltip="SUM(commission_amount) across sales_records in scope. The commission paid out (or owed) to operators based on their tier configuration. Region/location filters apply via the standard scoped-sales predicate (PR-15). Always GBP per D-15: commission is paid out in GBP regardless of source-sale currency, so this view is always GBP-normalised (uses commission_ledger amounts which are GBP-denominated post the FX-04 commission base swap)."
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
              tooltip="SUM(netAmount_gbp) over sales_records that have a non-null commission_amount — i.e. the share of revenue that actually drove a commission payment. Excludes records where commission was zero or unconfigured. Always GBP per D-15 — commission tiers are GBP-denominated, so the cumulative base for tier-bracket lookup is GBP-normalised at sale-time BoE rates."
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
              tooltip="Total Commission ÷ Commissionable Revenue × 100. The blended effective commission rate across the in-scope records — not the average of per-record rates (which would be vulnerable to Simpson's paradox). Delta is shown in percentage points (pp)."
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
              tooltip="COUNT(*) of sales_records in scope where commission_amount is not null. Useful as a denominator sanity check — if this is zero, there's no commission data flowing for the selected scope."
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
                  <tr key={row.locationId} className="border-b hover:bg-muted/30">
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
