"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ChartWrapper } from "@/components/analytics/chart-wrapper";
import { EventAnnotations } from "@/app/(app)/analytics/trend-builder/event-annotations";
import { formatCurrency, formatNumber } from "@/lib/analytics/formatters";
import { useMetricLabel } from "@/lib/analytics/metric-label";
import type { DailyTrendRow, BusinessEventDisplay } from "@/lib/analytics/types";

interface DailyTrendsProps {
  data: DailyTrendRow[];
  loading?: boolean;
  events?: BusinessEventDisplay[];
  activeEventCategories?: string[];
}

export function DailyTrends({
  data,
  loading = false,
  events = [],
  activeEventCategories = [],
}: DailyTrendsProps) {
  const metricLabel = useMetricLabel();
  return (
    <ChartWrapper loading={loading}>
      <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          fontSize={12}
          tickFormatter={(v: string) => {
            const d = new Date(v);
            return `${d.getDate()}/${d.getMonth() + 1}`;
          }}
        />
        <YAxis
          yAxisId="revenue"
          orientation="left"
          tickFormatter={(v: number) => formatCurrency(v)}
          fontSize={12}
        />
        <YAxis
          yAxisId="transactions"
          orientation="right"
          tickFormatter={(v: number) => formatNumber(v)}
          fontSize={12}
        />
        <Tooltip
          formatter={(value, name) => [
            name === "revenue"
              ? formatCurrency(Number(value))
              : formatNumber(Number(value)),
            name === "revenue" ? metricLabel : "Transactions",
          ]}
          labelFormatter={(label) => {
            const d = new Date(String(label));
            return d.toLocaleDateString("en-GB");
          }}
        />
        <Legend />
        <Line
          yAxisId="revenue"
          type="monotone"
          dataKey="revenue"
          stroke="#00A6D3"
          strokeWidth={2}
          dot={false}
          name={metricLabel}
        />
        <Line
          yAxisId="transactions"
          type="monotone"
          dataKey="transactions"
          stroke="#121212"
          strokeWidth={2}
          dot={false}
          name="Transactions"
        />
        {events.length > 0 && activeEventCategories.length > 0 && (
          <EventAnnotations
            events={events}
            activeCategories={activeEventCategories}
          />
        )}
      </LineChart>
    </ChartWrapper>
  );
}
