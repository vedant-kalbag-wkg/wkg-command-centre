"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getTrendSeriesData, getBusinessEvents } from "@/lib/analytics/queries/trend-series";
import { fetchWeatherData as fetchWeatherFromApi } from "@/lib/weather/open-meteo";
import type {
  TrendMetric,
  SeriesFilters,
  TrendDataPoint,
  DailyWeather,
  BusinessEventDisplay,
} from "@/lib/analytics/types";

async function getUserCtx() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");

  return {
    id: session.user.id,
    userType:
      (session.user as unknown as { userType: "internal" | "external" })
        .userType ?? "internal",
    role: (session.user.role ?? null) as
      | "admin"
      | "member"
      | "viewer"
      | null,
  };
}

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

export async function fetchBusinessEvents(
  dateFrom: string,
  dateTo: string,
): Promise<BusinessEventDisplay[]> {
  const userCtx = await getUserCtx();
  if (userCtx.userType === "external") return [];
  return getBusinessEvents(dateFrom, dateTo);
}
