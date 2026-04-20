"use server";

import { db } from "@/db";
import { locations, locationGroupMemberships } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getTrendSeriesData, getBusinessEvents } from "@/lib/analytics/queries/trend-series";
import { getComparisonDates } from "@/lib/analytics/metrics";
import { fetchWeatherData as fetchWeatherFromApi } from "@/lib/weather/open-meteo";
import type {
  TrendMetric,
  SeriesFilters,
  TrendDataPoint,
  DailyWeather,
  BusinessEventDisplay,
} from "@/lib/analytics/types";

export async function fetchTrendSeriesData(
  metric: TrendMetric,
  filters: SeriesFilters,
  dateFrom: string,
  dateTo: string,
): Promise<TrendDataPoint[]> {
  const userCtx = await getUserCtx();
  return getTrendSeriesData(metric, filters, dateFrom, dateTo, userCtx);
}

export async function fetchWeatherData(
  lat: number,
  lon: number,
  dateFrom: string,
  dateTo: string,
): Promise<DailyWeather[]> {
  // Auth check — weather is only available to authenticated users
  await getUserCtx();
  return fetchWeatherFromApi(lat, lon, dateFrom, dateTo);
}

/**
 * Weather fetch gated on exactly one location group being selected.
 * Resolves the representative coordinates from the first location in the
 * group that has both latitude and longitude set. Returns [] when no
 * groupId is supplied or no location in the group has coordinates —
 * acts as a server-side defense against the UI gate being bypassed.
 */
export async function fetchWeatherForLocationGroup(
  groupId: string | null,
  dateFrom: string,
  dateTo: string,
): Promise<DailyWeather[]> {
  await getUserCtx();

  if (!groupId) return [];

  const rows = await db
    .select({
      latitude: locations.latitude,
      longitude: locations.longitude,
    })
    .from(locationGroupMemberships)
    .innerJoin(locations, eq(locationGroupMemberships.locationId, locations.id))
    .where(
      and(
        eq(locationGroupMemberships.locationGroupId, groupId),
        isNotNull(locations.latitude),
        isNotNull(locations.longitude),
      ),
    )
    .limit(1);

  const first = rows[0];
  if (!first || first.latitude == null || first.longitude == null) return [];

  return fetchWeatherFromApi(first.latitude, first.longitude, dateFrom, dateTo);
}

export async function fetchBusinessEvents(
  dateFrom: string,
  dateTo: string,
): Promise<BusinessEventDisplay[]> {
  const userCtx = await getUserCtx();
  if (userCtx.userType === "external") return [];
  return getBusinessEvents(dateFrom, dateTo);
}

/**
 * Fetch trend series data for the YoY comparison period.
 * Returns data points shifted 1 year back, but with dates mapped
 * back to the current period so they overlay on the chart.
 */
export async function fetchTrendSeriesDataYoY(
  metric: TrendMetric,
  filters: SeriesFilters,
  dateFrom: string,
  dateTo: string,
): Promise<TrendDataPoint[]> {
  const userCtx = await getUserCtx();
  const { prevFrom, prevTo } = getComparisonDates(dateFrom, dateTo, "yoy");
  const data = await getTrendSeriesData(metric, filters, prevFrom, prevTo, userCtx);

  // Shift dates forward by 1 year so they align with the current period on the chart
  return data.map((pt) => {
    const d = new Date(pt.date);
    d.setFullYear(d.getFullYear() + 1);
    return { date: d.toISOString().split("T")[0], value: pt.value };
  });
}
