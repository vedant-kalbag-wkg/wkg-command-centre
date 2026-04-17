import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { weatherCache } from "@/db/schema";
import { setupTestDb, teardownTestDb } from "../helpers/test-db";

describe("weatherCache table", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 120_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  it("inserts and reads a cache entry", async () => {
    const key = "weather:51.51:-0.13:2025-01-01:2025-01-31";
    const data = [
      { date: "2025-01-01", temperatureMax: 8, temperatureMin: 2, precipitation: 1.5 },
    ];

    await ctx.db.insert(weatherCache).values({
      cacheKey: key,
      dateFrom: "2025-01-01",
      dateTo: "2025-01-31",
      data,
      isForecast: false,
    });

    const rows = await ctx.db
      .select()
      .from(weatherCache)
      .where(eq(weatherCache.cacheKey, key));

    expect(rows).toHaveLength(1);
    expect(rows[0].cacheKey).toBe(key);
    expect(rows[0].isForecast).toBe(false);
    expect(rows[0].data).toEqual(data);
    expect(rows[0].cachedAt).toBeInstanceOf(Date);
  });

  it("upserts on conflict (updates existing entry)", async () => {
    const key = "weather:40.00:-74.00:2025-06-01:2025-06-30";
    const original = [
      { date: "2025-06-01", temperatureMax: 28, temperatureMin: 18, precipitation: 0 },
    ];
    const updated = [
      { date: "2025-06-01", temperatureMax: 30, temperatureMin: 20, precipitation: 2 },
    ];

    // Insert original
    await ctx.db.insert(weatherCache).values({
      cacheKey: key,
      dateFrom: "2025-06-01",
      dateTo: "2025-06-30",
      data: original,
      isForecast: true,
    });

    // Upsert with new data
    await ctx.db
      .insert(weatherCache)
      .values({
        cacheKey: key,
        dateFrom: "2025-06-01",
        dateTo: "2025-06-30",
        data: updated,
        isForecast: true,
        cachedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: weatherCache.cacheKey,
        set: {
          data: updated,
          isForecast: true,
          cachedAt: new Date(),
        },
      });

    const rows = await ctx.db
      .select()
      .from(weatherCache)
      .where(eq(weatherCache.cacheKey, key));

    expect(rows).toHaveLength(1);
    expect(rows[0].data).toEqual(updated);
  });

  it("stores forecast and historical entries separately", async () => {
    const forecastKey = "weather:10.00:20.00:2025-04-01:2025-04-07";
    const historicalKey = "weather:10.00:20.00:2024-01-01:2024-01-07";

    await ctx.db.insert(weatherCache).values([
      {
        cacheKey: forecastKey,
        dateFrom: "2025-04-01",
        dateTo: "2025-04-07",
        data: [],
        isForecast: true,
      },
      {
        cacheKey: historicalKey,
        dateFrom: "2024-01-01",
        dateTo: "2024-01-07",
        data: [],
        isForecast: false,
      },
    ]);

    const forecast = await ctx.db
      .select()
      .from(weatherCache)
      .where(eq(weatherCache.cacheKey, forecastKey));
    const historical = await ctx.db
      .select()
      .from(weatherCache)
      .where(eq(weatherCache.cacheKey, historicalKey));

    expect(forecast[0].isForecast).toBe(true);
    expect(historical[0].isForecast).toBe(false);
  });
});
