"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useAnalyticsFilters } from "@/lib/stores/analytics-filter-store";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { SectionAccordion } from "@/components/analytics/section-accordion";
import { KpiCard } from "@/components/analytics/kpi-card";
import { ChartWrapper } from "@/components/analytics/chart-wrapper";
import { EmptyState } from "@/components/analytics/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchMaturityAnalysis } from "./actions";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import { DETAILED_MATURITY_BUCKETS } from "@/lib/analytics/maturity";
import type { AnalyticsFilters, MaturityAnalysis } from "@/lib/analytics/types";

function getPlateauInsight(
  bucketMetrics: MaturityAnalysis["bucketMetrics"],
): { text: string; color: string } {
  const bucket3160 = bucketMetrics.find((b) => b.bucket === "31-60d");
  const bucket90 = bucketMetrics.find((b) => b.bucket === "90+d");

  if (
    !bucket3160 ||
    !bucket90 ||
    bucket3160.locationCount === 0 ||
    bucket90.locationCount === 0
  ) {
    return {
      text: "Insufficient data to determine maturity trend",
      color: "#6B7280",
    };
  }

  const avg3160 = bucket3160.avgRevenue;
  const avg90 = bucket90.avgRevenue;

  if (avg3160 === 0) {
    return {
      text: "Insufficient data to determine maturity trend",
      color: "#6B7280",
    };
  }

  const pctChange = ((avg90 - avg3160) / avg3160) * 100;

  if (pctChange > 10) {
    return {
      text: `Mature kiosks continue to grow (+${pctChange.toFixed(1)}%)`,
      color: "#166534",
    };
  }
  if (pctChange < -10) {
    return {
      text: `Revenue declines after maturity (${pctChange.toFixed(1)}%)`,
      color: "#991B1B",
    };
  }
  return {
    text: "Revenue plateaus after 90 days",
    color: "#6B7280",
  };
}

export default function MaturityPage() {
  const filters = useAnalyticsFilters();
  const [data, setData] = useState<MaturityAnalysis | null>(null);
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
      const parsed = JSON.parse(filtersJson) as AnalyticsFilters;
      const result = await fetchMaturityAnalysis(parsed);
      if (!controller.signal.aborted) {
        setData(result);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [filtersJson]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const bucketLabel = (value: string) =>
    DETAILED_MATURITY_BUCKETS.find((b) => b.value === value)?.label ?? value;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Maturity Analysis
        </h1>
        <p className="text-sm text-muted-foreground">
          Understand how kiosk revenue evolves after installation
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* A. Revenue by Maturity Bucket */}
      <SectionAccordion title="Revenue by Maturity Bucket">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))
            : data?.bucketMetrics.map((bm) => (
                <KpiCard
                  key={bm.bucket}
                  title={`${bucketLabel(bm.bucket)} (${formatNumber(bm.locationCount)} locations)`}
                  value={formatCurrency(bm.avgRevenue)}
                />
              ))}
        </div>

        <div className="mt-4">
          {loading ? (
            <Skeleton className="h-[300px] w-full rounded-lg" />
          ) : data && data.bucketMetrics.some((b) => b.totalRevenue > 0) ? (
            <ChartWrapper>
              <BarChart
                data={data.bucketMetrics.map((bm) => ({
                  ...bm,
                  label: bucketLabel(bm.bucket),
                }))}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis
                  tickFormatter={(v: number) => formatCurrency(v)}
                  fontSize={12}
                />
                <Tooltip
                  formatter={(value) => [
                    formatCurrency(Number(value)),
                    "Avg Revenue",
                  ]}
                />
                <Bar
                  dataKey="avgRevenue"
                  fill="#00A6D3"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartWrapper>
          ) : (
            <EmptyState message="No maturity data for selected filters" />
          )}
        </div>
      </SectionAccordion>

      {/* B. Revenue Ramp Curve */}
      <SectionAccordion title="Revenue Ramp Curve">
        {loading ? (
          <Skeleton className="h-[300px] w-full rounded-lg" />
        ) : data && data.rampCurve.some((p) => p.avgRevenue > 0) ? (
          <ChartWrapper>
            <LineChart
              data={data.rampCurve.map((p) => ({
                ...p,
                label:
                  p.monthsSinceInstall === 6
                    ? "6+"
                    : String(p.monthsSinceInstall),
              }))}
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                fontSize={12}
                label={{
                  value: "Months since install",
                  position: "insideBottomRight",
                  offset: -5,
                  fontSize: 11,
                }}
              />
              <YAxis
                tickFormatter={(v: number) => formatCurrency(v)}
                fontSize={12}
              />
              <Tooltip
                formatter={(value) => [
                  formatCurrency(Number(value)),
                  "Avg Revenue",
                ]}
                labelFormatter={(label) =>
                  `Month ${label}${label === "6+" ? " (and beyond)" : ""}`
                }
              />
              <Line
                type="monotone"
                dataKey="avgRevenue"
                stroke="#00A6D3"
                strokeWidth={2}
                dot={{ r: 4, fill: "#00A6D3" }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ChartWrapper>
        ) : (
          <EmptyState message="No ramp data available" />
        )}
      </SectionAccordion>

      {/* C. Install Month Cohorts */}
      <SectionAccordion title="Install Month Cohorts">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-md" />
            ))}
          </div>
        ) : data && data.installCohorts.length > 0 ? (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-2 text-left font-medium">
                    Install Month
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    # Locations
                  </th>
                  <th className="px-4 py-2 text-right font-medium">
                    Avg Monthly Revenue
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.installCohorts.map((cohort) => (
                  <tr
                    key={cohort.installMonth}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-2 font-medium">
                      {cohort.installMonth}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {formatNumber(cohort.locationCount)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {formatCurrency(cohort.avgMonthlyRevenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No install cohort data available" />
        )}
      </SectionAccordion>

      {/* D. Plateau Detection */}
      <SectionAccordion title="Plateau Detection">
        {loading ? (
          <Skeleton className="h-20 rounded-lg" />
        ) : data ? (
          (() => {
            const insight = getPlateauInsight(data.bucketMetrics);
            return (
              <div
                className="rounded-lg border px-4 py-3"
                style={{ borderLeftWidth: 4, borderLeftColor: insight.color }}
              >
                <p className="text-sm font-medium" style={{ color: insight.color }}>
                  {insight.text}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Comparing 90+ day average revenue vs 31-60 day average revenue
                </p>
              </div>
            );
          })()
        ) : null}
      </SectionAccordion>
    </div>
  );
}
