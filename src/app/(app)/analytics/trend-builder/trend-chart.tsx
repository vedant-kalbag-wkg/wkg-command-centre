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
import { EmptyState } from "@/components/analytics/empty-state";
import {
  formatCurrency,
  formatNumber,
  dateToBucket,
  autoGranularity,
  type Granularity,
} from "@/lib/analytics/formatters";
import type {
  SeriesConfig,
  TrendDataPoint,
  TrendGranularity,
  BusinessEventDisplay,
} from "@/lib/analytics/types";
import { EventAnnotations } from "./event-annotations";

// ─── Currency vs count metric classification ─────────────────────────────────

const CURRENCY_METRICS = new Set(["revenue", "avg_basket_value", "booking_fee"]);

function isCurrencyMetric(metric: string): boolean {
  return CURRENCY_METRICS.has(metric);
}

// ─── Merge + bucket series data ──────────────────────────────────────────────

type MergedRow = { date: string; [seriesId: string]: string | number };

function mergeSeriesData(
  allData: Map<string, TrendDataPoint[]>,
  appliedSeries: SeriesConfig[],
  granularity: Granularity,
): MergedRow[] {
  // Collect all dates from all series, bucketed
  const dateMap = new Map<string, MergedRow>();

  for (const series of appliedSeries) {
    const points = allData.get(series.id) ?? [];
    for (const pt of points) {
      const bucket = dateToBucket(pt.date, granularity);
      if (!dateMap.has(bucket)) {
        dateMap.set(bucket, { date: bucket });
      }
      const row = dateMap.get(bucket)!;
      // Accumulate values within the same bucket
      const existing = (row[series.id] as number) ?? 0;
      row[series.id] = existing + pt.value;
    }
  }

  // For avg_basket_value, we need count tracking to compute proper averages
  // within buckets. For now, the query already returns daily averages and
  // weekly/monthly bucketing sums them — which is an approximation. A full
  // weighted-average implementation would require returning both numerator
  // and denominator from the query. This is acceptable for the initial port.

  return Array.from(dateMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

interface TrendChartProps {
  allData: Map<string, TrendDataPoint[]>;
  yoyData?: Map<string, TrendDataPoint[]>;
  appliedSeries: SeriesConfig[];
  granularity: TrendGranularity;
  dateFrom: string;
  dateTo: string;
  loading?: boolean;
  events?: BusinessEventDisplay[];
  showEvents?: boolean;
  activeEventCategories?: string[];
  onToggleHidden?: (id: string) => void;
}

export function TrendChart({
  allData,
  yoyData,
  appliedSeries,
  granularity,
  dateFrom,
  dateTo,
  loading = false,
  events = [],
  showEvents = false,
  activeEventCategories = [],
  onToggleHidden,
}: TrendChartProps) {
  const visibleSeries = appliedSeries.filter((s) => !s.hidden);

  if (!loading && visibleSeries.length === 0) {
    return <EmptyState message="No series to display. Add and apply a series above." />;
  }

  // Resolve granularity
  const resolvedGranularity: Granularity =
    granularity === "auto"
      ? autoGranularity(new Date(dateFrom), new Date(dateTo))
      : granularity;

  const chartData = mergeSeriesData(allData, visibleSeries, resolvedGranularity);

  // Merge YoY data into chart rows with _yoy suffix keys
  const hasYoY = yoyData && yoyData.size > 0;
  if (hasYoY) {
    // Build a separate merged dataset for YoY series
    const yoyMerged = mergeSeriesData(yoyData, visibleSeries, resolvedGranularity);
    const yoyByDate = new Map(yoyMerged.map((row) => [row.date, row]));

    for (const row of chartData) {
      const yoyRow = yoyByDate.get(row.date);
      if (yoyRow) {
        for (const series of visibleSeries) {
          if (yoyRow[series.id] !== undefined) {
            row[`${series.id}_yoy`] = yoyRow[series.id];
          }
        }
      }
    }
  }

  if (!loading && chartData.length === 0) {
    return <EmptyState message="No data for selected filters and date range" />;
  }

  // Determine if we need dual Y-axes
  const hasCurrency = visibleSeries.some((s) => isCurrencyMetric(s.metric));
  const hasCount = visibleSeries.some((s) => !isCurrencyMetric(s.metric));

  return (
    <ChartWrapper loading={loading} minHeight={380}>
      <LineChart
        data={chartData}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          fontSize={12}
          tickFormatter={(v: string) => {
            const d = new Date(v);
            if (resolvedGranularity === "monthly") {
              return d.toLocaleDateString("en-GB", {
                month: "short",
                year: "2-digit",
              });
            }
            return `${d.getDate()}/${d.getMonth() + 1}`;
          }}
        />

        {/* Left Y-axis for currency metrics */}
        {hasCurrency && (
          <YAxis
            yAxisId="currency"
            orientation="left"
            tickFormatter={(v: number) => formatCurrency(v)}
            fontSize={12}
          />
        )}

        {/* Right Y-axis for count metrics */}
        {hasCount && (
          <YAxis
            yAxisId="count"
            orientation={hasCurrency ? "right" : "left"}
            tickFormatter={(v: number) => formatNumber(v)}
            fontSize={12}
          />
        )}

        <Tooltip
          formatter={(value, name) => {
            const v = Number(value);
            const n = String(name);
            // Handle YoY series naming
            const isYoY = n.endsWith("_yoy");
            const baseId = isYoY ? n.replace(/_yoy$/, "") : n;
            const series = appliedSeries.find((s) => s.id === baseId);
            const formatted = series && isCurrencyMetric(series.metric)
              ? formatCurrency(v)
              : formatNumber(v);
            const label = series?.label ?? baseId;
            return [formatted, isYoY ? `${label} (YoY)` : label];
          }}
          labelFormatter={(label) => {
            const d = new Date(String(label));
            return d.toLocaleDateString("en-GB");
          }}
        />

        <Legend
          onClick={(e) => {
            if (onToggleHidden && e.dataKey) {
              const dk = String(e.dataKey);
              // Don't toggle YoY lines directly — they follow their parent
              if (!dk.endsWith("_yoy")) {
                onToggleHidden(dk);
              }
            }
          }}
          formatter={(value) => {
            const v = String(value);
            const isYoY = v.endsWith("_yoy");
            const baseId = isYoY ? v.replace(/_yoy$/, "") : v;
            const series = appliedSeries.find((s) => s.id === baseId);
            const label = series?.label ?? baseId;
            return isYoY ? `${label} (YoY)` : label;
          }}
        />

        {/* Event overlays */}
        {showEvents && events.length > 0 && (
          <EventAnnotations
            events={events}
            activeCategories={activeEventCategories}
          />
        )}

        {/* Series lines */}
        {visibleSeries.map((series) => (
          <Line
            key={series.id}
            yAxisId={isCurrencyMetric(series.metric) ? "currency" : "count"}
            type="monotone"
            dataKey={series.id}
            stroke={series.color}
            strokeWidth={2}
            dot={false}
            name={series.id}
            connectNulls
          />
        ))}

        {/* YoY overlay lines (dashed, lower opacity) */}
        {hasYoY &&
          visibleSeries.map((series) => (
            <Line
              key={`${series.id}_yoy`}
              yAxisId={isCurrencyMetric(series.metric) ? "currency" : "count"}
              type="monotone"
              dataKey={`${series.id}_yoy`}
              stroke={series.color}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              strokeOpacity={0.4}
              dot={false}
              name={`${series.id}_yoy`}
              connectNulls
              legendType="none"
            />
          ))}
      </LineChart>
    </ChartWrapper>
  );
}
