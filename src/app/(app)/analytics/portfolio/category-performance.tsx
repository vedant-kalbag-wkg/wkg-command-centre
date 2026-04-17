"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ChartWrapper } from "@/components/analytics/chart-wrapper";
import { EmptyState } from "@/components/analytics/empty-state";
import { formatCurrency } from "@/lib/analytics/formatters";
import type { CategoryPerformanceRow } from "@/lib/analytics/types";

interface CategoryPerformanceProps {
  data: CategoryPerformanceRow[];
  loading?: boolean;
}

export function CategoryPerformance({
  data,
  loading = false,
}: CategoryPerformanceProps) {
  if (!loading && data.length === 0) {
    return <EmptyState message="No category data for selected filters" />;
  }

  return (
    <ChartWrapper loading={loading} minHeight={Math.max(300, data.length * 40)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => formatCurrency(v)}
          fontSize={12}
        />
        <YAxis
          type="category"
          dataKey="categoryName"
          width={140}
          fontSize={12}
          tickLine={false}
        />
        <Tooltip
          formatter={(value) => [formatCurrency(Number(value)), "Revenue"]}
          labelStyle={{ fontWeight: 600 }}
        />
        <Bar dataKey="revenue" fill="#00A6D3" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartWrapper>
  );
}
