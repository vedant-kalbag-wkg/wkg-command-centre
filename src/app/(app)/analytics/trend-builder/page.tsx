"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useAnalyticsFilterStore } from "@/lib/stores/analytics-filter-store";
import { useTrendStore } from "@/lib/stores/trend-store";
import { toLocalISODate } from "@/lib/analytics/formatters";
import { resolveWeatherLocation } from "@/lib/weather/region-coordinates";
import { PageHeader } from "@/components/layout/page-header";
import { ChartCard } from "@/components/ui/chart-card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { applyRollingAverage } from "@/lib/analytics/rolling-average";
import type { RollingWindow } from "@/lib/analytics/rolling-average";
import {
  fetchTrendSeriesData,
  fetchTrendSeriesDataYoY,
  fetchWeatherData,
  fetchBusinessEvents,
} from "./actions";
import { SeriesBuilderPanel } from "./series-builder-panel";
import { TrendChart } from "./trend-chart";
import { WeatherMiniChart } from "./weather-mini-chart";
import { GranularitySelector } from "./granularity-selector";
import type {
  TrendMetric,
  SeriesFilters,
  TrendDataPoint,
  DailyWeather,
  BusinessEventDisplay,
} from "@/lib/analytics/types";

export default function TrendBuilderPage() {
  // Date range from shared analytics filter store
  const dateRange = useAnalyticsFilterStore((s) => s.dateRange);
  const dateFrom = toLocalISODate(dateRange.from);
  const dateTo = toLocalISODate(dateRange.to);

  // Trend store state
  const appliedSeries = useTrendStore((s) => s.appliedSeries);
  const granularity = useTrendStore((s) => s.granularity);
  const setGranularity = useTrendStore((s) => s.setGranularity);
  const showWeather = useTrendStore((s) => s.showWeather);
  const setShowWeather = useTrendStore((s) => s.setShowWeather);
  const showEvents = useTrendStore((s) => s.showEvents);
  const setShowEvents = useTrendStore((s) => s.setShowEvents);
  const showYoY = useTrendStore((s) => s.showYoY);
  const setShowYoY = useTrendStore((s) => s.setShowYoY);
  const rollingAverage = useTrendStore((s) => s.rollingAverage);
  const setRollingAverage = useTrendStore((s) => s.setRollingAverage);
  const activeEventCategories = useTrendStore((s) => s.activeEventCategories);
  const toggleAppliedHidden = useTrendStore((s) => s.toggleAppliedHidden);

  // Data state
  const [seriesData, setSeriesData] = useState<Map<string, TrendDataPoint[]>>(
    new Map(),
  );
  const [yoyData, setYoyData] = useState<Map<string, TrendDataPoint[]>>(
    new Map(),
  );
  const [weatherData, setWeatherData] = useState<DailyWeather[]>([]);
  const [events, setEvents] = useState<BusinessEventDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Serialize dependencies for effect stability
  const seriesJson = JSON.stringify(
    appliedSeries.map((s) => ({
      id: s.id,
      metric: s.metric,
      filters: s.filters,
    })),
  );

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const parsed = JSON.parse(seriesJson) as {
        id: string;
        metric: TrendMetric;
        filters: SeriesFilters;
      }[];

      // Fetch all series in parallel
      const seriesPromises = parsed.map(async (s) => {
        const data = await fetchTrendSeriesData(
          s.metric,
          s.filters,
          dateFrom,
          dateTo,
        );
        return [s.id, data] as const;
      });

      // Fetch YoY series in parallel when enabled
      const yoyPromises = showYoY
        ? parsed.map(async (s) => {
            const data = await fetchTrendSeriesDataYoY(
              s.metric,
              s.filters,
              dateFrom,
              dateTo,
            );
            return [s.id, data] as const;
          })
        : [];

      // Fetch weather + events in parallel with series
      const weatherPromise = showWeather
        ? (() => {
            const coord = resolveWeatherLocation();
            return fetchWeatherData(coord.lat, coord.lon, dateFrom, dateTo);
          })()
        : Promise.resolve([]);

      const eventsPromise = showEvents
        ? fetchBusinessEvents(dateFrom, dateTo)
        : Promise.resolve([]);

      const [seriesResults, yoyResults, weatherResult, eventsResult] = await Promise.all([
        Promise.all(seriesPromises),
        Promise.all(yoyPromises),
        weatherPromise,
        eventsPromise,
      ]);

      if (!controller.signal.aborted) {
        setSeriesData(new Map(seriesResults));
        setYoyData(showYoY ? new Map(yoyResults) : new Map());
        setWeatherData(weatherResult);
        setEvents(eventsResult);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(
          err instanceof Error ? err.message : "Failed to load trend data",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [seriesJson, dateFrom, dateTo, showWeather, showEvents, showYoY]);

  useEffect(() => {
    loadData();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadData]);

  // Apply rolling average transformation client-side
  const chartData = useMemo(() => {
    if (!rollingAverage) return seriesData;
    const transformed = new Map<string, TrendDataPoint[]>();
    for (const [id, points] of seriesData) {
      transformed.set(id, applyRollingAverage(points, rollingAverage));
    }
    return transformed;
  }, [seriesData, rollingAverage]);

  const hasSeries = appliedSeries.length > 0;

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <PageHeader
        title="Trend Builder"
        description="Build custom multi-series trend charts with weather and event overlays"
        toolbar={
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <GranularitySelector value={granularity} onChange={setGranularity} />

            <div className="flex items-center gap-1 rounded-md border p-0.5">
              {([null, 7, 30] as RollingWindow[]).map((w) => {
                const label = w === null ? "Raw" : w === 7 ? "7d Avg" : "30d Avg";
                const isActive = rollingAverage === w;
                return (
                  <Button
                    key={label}
                    variant={isActive ? "default" : "ghost"}
                    size="sm"
                    className={
                      isActive
                        ? "h-7 px-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
                        : "h-7 px-2 text-xs"
                    }
                    onClick={() => setRollingAverage(w)}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="show-weather"
                checked={showWeather}
                onCheckedChange={setShowWeather}
              />
              <Label htmlFor="show-weather" className="text-xs">
                Weather
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="show-events"
                checked={showEvents}
                onCheckedChange={setShowEvents}
              />
              <Label htmlFor="show-events" className="text-xs">
                Events
              </Label>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="show-yoy"
                checked={showYoY}
                onCheckedChange={setShowYoY}
              />
              <Label htmlFor="show-yoy" className="text-xs">
                YoY Overlay
              </Label>
            </div>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Main trend chart */}
        <ChartCard
          title="Trend"
          description="Applied series over the selected date range"
          loading={loading}
          empty={!loading && !hasSeries}
          emptyMessage="Add a series in the Builder Panel below to see a trend"
          collapsible
        >
          <TrendChart
            allData={chartData}
            yoyData={yoyData}
            appliedSeries={appliedSeries}
            granularity={granularity}
            dateFrom={dateFrom}
            dateTo={dateTo}
            events={events}
            showEvents={showEvents}
            activeEventCategories={activeEventCategories}
            onToggleHidden={toggleAppliedHidden}
          />
        </ChartCard>

        {/* Weather mini chart (below main chart, synced) */}
        {showWeather && (
          <ChartCard
            title="Weather"
            description="Daily precipitation and temperature for the selected range"
            loading={loading}
            collapsible
          >
            <WeatherMiniChart data={weatherData} loading={false} />
          </ChartCard>
        )}

        {/* Series Builder */}
        <SeriesBuilderPanel />
      </div>
    </div>
  );
}
