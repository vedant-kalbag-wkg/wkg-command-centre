"use client";

import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ChartWrapper } from "@/components/analytics/chart-wrapper";
import type { DailyWeather } from "@/lib/analytics/types";

interface WeatherMiniChartProps {
  data: DailyWeather[];
  loading?: boolean;
}

export function WeatherMiniChart({
  data,
  loading = false,
}: WeatherMiniChartProps) {
  if (!loading && data.length === 0) return null;

  return (
    <ChartWrapper loading={loading} minHeight={108}>
      <ComposedChart
        data={data}
        margin={{ top: 4, right: 30, left: 20, bottom: 4 }}
      >
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis
          dataKey="date"
          fontSize={10}
          tickFormatter={(v: string) => {
            const d = new Date(v);
            return `${d.getDate()}/${d.getMonth() + 1}`;
          }}
          hide
        />
        <YAxis
          yAxisId="temp"
          orientation="left"
          fontSize={10}
          tickFormatter={(v: number) => `${v}\u00B0`}
          width={32}
        />
        <YAxis
          yAxisId="precip"
          orientation="right"
          fontSize={10}
          tickFormatter={(v: number) => `${v}mm`}
          width={40}
        />
        <Tooltip
          formatter={(value, name) => {
            const v = Number(value);
            if (name === "precipitation") return [`${v.toFixed(1)}mm`, "Precip"];
            return [`${v.toFixed(1)}\u00B0C`, name === "temperatureMax" ? "High" : "Low"];
          }}
          labelFormatter={(label) => {
            const d = new Date(String(label));
            return d.toLocaleDateString("en-GB");
          }}
        />
        <Bar
          yAxisId="precip"
          dataKey="precipitation"
          fill="#00A6D3"
          fillOpacity={0.3}
          barSize={4}
          name="precipitation"
        />
        <Line
          yAxisId="temp"
          type="monotone"
          dataKey="temperatureMax"
          stroke="#DC2626"
          strokeWidth={1.5}
          dot={false}
          name="temperatureMax"
        />
        <Line
          yAxisId="temp"
          type="monotone"
          dataKey="temperatureMin"
          stroke="#2563EB"
          strokeWidth={1.5}
          dot={false}
          name="temperatureMin"
        />
      </ComposedChart>
    </ChartWrapper>
  );
}
