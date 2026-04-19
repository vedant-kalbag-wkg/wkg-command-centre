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
import { formatCurrency } from "@/lib/analytics/formatters";
import type { HourlyDistributionRow } from "@/lib/analytics/types";

interface HourlyDistributionProps {
  data: HourlyDistributionRow[];
  loading?: boolean;
}

export function HourlyDistribution({
  data,
  loading = false,
}: HourlyDistributionProps) {
  return (
    <ChartWrapper loading={loading}>
      <BarChart
        data={data}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="hour"
          fontSize={12}
          tickFormatter={(v: number) => `${String(v).padStart(2, "0")}:00`}
        />
        <YAxis
          tickFormatter={(v: number) => formatCurrency(v)}
          fontSize={12}
        />
        <Tooltip
          formatter={(value) => [formatCurrency(Number(value)), "Revenue"]}
          labelFormatter={(label) => {
            const h = String(label).padStart(2, "0");
            return `${h}:00 - ${h}:59`;
          }}
        />
        <Bar dataKey="revenue" fill="#00A6D3" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartWrapper>
  );
}
