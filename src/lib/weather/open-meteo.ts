/**
 * OpenMeteo weather data fetcher with DB caching.
 *
 * Uses the free Open-Meteo API (no API key required):
 *   - Archive endpoint for dates > 92 days ago
 *   - Forecast endpoint for recent / future dates
 *   - Automatically splits requests that span the boundary
 *
 * Cache layer uses the weatherCache table:
 *   - Historical data (entirely before archive threshold): 30-day TTL
 *   - Forecast / mixed data (any date within 92 days): 6-hour TTL
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { weatherCache } from "@/db/schema";
import type { DailyWeather } from "@/lib/analytics/types";

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const DAILY_PARAMS = "temperature_2m_max,temperature_2m_min,precipitation_sum";

// Archive endpoint only has data up to ~5 days ago; the exact boundary
// shifts, but 92 days is the documented limit for the forecast endpoint.
// Dates older than this threshold use the archive endpoint.
const ARCHIVE_THRESHOLD_DAYS = 92;

/** Forecast cache entries expire after 6 hours. */
const FORECAST_TTL_MS = 6 * 60 * 60 * 1000;
/** Historical cache entries expire after 30 days. */
const HISTORICAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function parseDate(s: string): Date {
  return new Date(s + "T00:00:00");
}

// ─── Cache Helpers ──────────────────────────────────────────────────────────

/**
 * Build a deterministic cache key. Lat/lon are rounded to 2 decimal places
 * so that nearby coordinates share cache entries.
 */
export function buildCacheKey(
  lat: number,
  lon: number,
  dateFrom: string,
  dateTo: string,
): string {
  const rlat = lat.toFixed(2);
  const rlon = lon.toFixed(2);
  return `weather:${rlat}:${rlon}:${dateFrom}:${dateTo}`;
}

/**
 * Determine whether a date range should be treated as "forecast" for cache
 * expiry purposes. Any date within the archive threshold means the data
 * may still change, so we treat it as forecast.
 */
export function isForecastRange(dateTo: string): boolean {
  const to = parseDate(dateTo);
  const threshold = daysAgo(ARCHIVE_THRESHOLD_DAYS);
  return to >= threshold;
}

/**
 * Check whether a cached entry is still valid based on its isForecast flag
 * and the time it was cached.
 */
function isCacheValid(cachedAt: Date, isForecast: boolean): boolean {
  const ttl = isForecast ? FORECAST_TTL_MS : HISTORICAL_TTL_MS;
  return Date.now() - cachedAt.getTime() < ttl;
}

// ─── API Response Type ───────────────────────────────────────────────────────

type OpenMeteoResponse = {
  daily?: {
    time?: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
  };
};

// ─── Internal Fetch ──────────────────────────────────────────────────────────

async function fetchFromEndpoint(
  endpoint: string,
  lat: number,
  lon: number,
  dateFrom: string,
  dateTo: string,
): Promise<DailyWeather[]> {
  const url = new URL(endpoint);
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("start_date", dateFrom);
  url.searchParams.set("end_date", dateTo);
  url.searchParams.set("daily", DAILY_PARAMS);
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString(), {
    next: { revalidate: 3600 }, // 1h ISR cache at the Next.js level
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenMeteo API error (${res.status}): ${text.slice(0, 200)}`,
    );
  }

  const json = (await res.json()) as OpenMeteoResponse;
  const daily = json.daily;
  if (!daily?.time) return [];

  const times = daily.time;
  const tempMax = daily.temperature_2m_max ?? [];
  const tempMin = daily.temperature_2m_min ?? [];
  const precip = daily.precipitation_sum ?? [];

  return times.map((date, i) => ({
    date,
    temperatureMax: tempMax[i] ?? 0,
    temperatureMin: tempMin[i] ?? 0,
    precipitation: precip[i] ?? 0,
  }));
}

// ─── Internal: fetch from API (no cache) ────────────────────────────────────

async function fetchFromApi(
  lat: number,
  lon: number,
  dateFrom: string,
  dateTo: string,
): Promise<DailyWeather[]> {
  const from = parseDate(dateFrom);
  const to = parseDate(dateTo);
  const threshold = daysAgo(ARCHIVE_THRESHOLD_DAYS);

  // Entire range is in archive territory
  if (to < threshold) {
    return fetchFromEndpoint(ARCHIVE_URL, lat, lon, dateFrom, dateTo);
  }

  // Entire range is in forecast territory
  if (from >= threshold) {
    return fetchFromEndpoint(FORECAST_URL, lat, lon, dateFrom, dateTo);
  }

  // Range spans the boundary — split into two requests
  const archiveTo = new Date(threshold);
  archiveTo.setDate(archiveTo.getDate() - 1);
  const forecastFrom = new Date(threshold);

  const [archiveData, forecastData] = await Promise.all([
    fetchFromEndpoint(
      ARCHIVE_URL,
      lat,
      lon,
      dateFrom,
      toISODate(archiveTo),
    ),
    fetchFromEndpoint(
      FORECAST_URL,
      lat,
      lon,
      toISODate(forecastFrom),
      dateTo,
    ),
  ]);

  // Deduplicate any overlap day
  const seen = new Set(archiveData.map((d) => d.date));
  const merged = [
    ...archiveData,
    ...forecastData.filter((d) => !seen.has(d.date)),
  ];

  return merged.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch daily weather data for a coordinate and date range.
 * Automatically splits the request between archive and forecast
 * endpoints when the date range spans the threshold boundary.
 *
 * Results are cached in the weatherCache table. Historical data is cached
 * for 30 days; forecast/mixed data is cached for 6 hours.
 */
export async function fetchWeatherData(
  lat: number,
  lon: number,
  dateFrom: string,
  dateTo: string,
): Promise<DailyWeather[]> {
  const key = buildCacheKey(lat, lon, dateFrom, dateTo);

  // ── Cache read ──────────────────────────────────────────────────────────
  try {
    const cached = await db
      .select()
      .from(weatherCache)
      .where(eq(weatherCache.cacheKey, key))
      .limit(1);

    if (cached.length > 0) {
      const entry = cached[0];
      if (isCacheValid(entry.cachedAt, entry.isForecast)) {
        return entry.data as DailyWeather[];
      }
    }
  } catch {
    // If the cache read fails (e.g. DB unavailable), fall through to API
  }

  // ── Fetch from API ────────────────────────────────────────────────────
  const data = await fetchFromApi(lat, lon, dateFrom, dateTo);

  // ── Cache write ─────────────────────────────────────────────────────────
  const forecast = isForecastRange(dateTo);
  try {
    await db
      .insert(weatherCache)
      .values({
        cacheKey: key,
        dateFrom,
        dateTo,
        data: data as unknown as Record<string, unknown>,
        isForecast: forecast,
        cachedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: weatherCache.cacheKey,
        set: {
          data: data as unknown as Record<string, unknown>,
          isForecast: forecast,
          cachedAt: new Date(),
        },
      });
  } catch {
    // If the cache write fails, we still return the fresh data
  }

  return data;
}
