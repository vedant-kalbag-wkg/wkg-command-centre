import { describe, it, expect } from "vitest";
import { buildCacheKey, isForecastRange } from "./open-meteo";

describe("buildCacheKey", () => {
  it("rounds lat/lon to 2 decimal places", () => {
    const key = buildCacheKey(51.5074, -0.1278, "2025-01-01", "2025-01-31");
    expect(key).toBe("weather:51.51:-0.13:2025-01-01:2025-01-31");
  });

  it("handles exact values without rounding artefacts", () => {
    const key = buildCacheKey(40.0, -74.0, "2025-06-01", "2025-06-30");
    expect(key).toBe("weather:40.00:-74.00:2025-06-01:2025-06-30");
  });

  it("produces consistent keys for slightly different coords", () => {
    const key1 = buildCacheKey(51.506, -0.126, "2025-01-01", "2025-01-31");
    const key2 = buildCacheKey(51.509, -0.129, "2025-01-01", "2025-01-31");
    expect(key1).toBe(key2); // both round to 51.51:-0.13
  });

  it("produces different keys for different date ranges", () => {
    const key1 = buildCacheKey(51.5, -0.13, "2025-01-01", "2025-01-31");
    const key2 = buildCacheKey(51.5, -0.13, "2025-02-01", "2025-02-28");
    expect(key1).not.toBe(key2);
  });

  it("handles negative latitudes", () => {
    const key = buildCacheKey(-33.8688, 151.2093, "2025-03-01", "2025-03-31");
    expect(key).toBe("weather:-33.87:151.21:2025-03-01:2025-03-31");
  });
});

describe("isForecastRange", () => {
  it("returns false for dates far in the past", () => {
    expect(isForecastRange("2020-01-01")).toBe(false);
  });

  it("returns true for today", () => {
    const today = new Date().toISOString().split("T")[0];
    expect(isForecastRange(today)).toBe(true);
  });

  it("returns true for a date 10 days ago", () => {
    const d = new Date();
    d.setDate(d.getDate() - 10);
    const recent = d.toISOString().split("T")[0];
    expect(isForecastRange(recent)).toBe(true);
  });

  it("returns false for a date 200 days ago", () => {
    const d = new Date();
    d.setDate(d.getDate() - 200);
    const old = d.toISOString().split("T")[0];
    expect(isForecastRange(old)).toBe(false);
  });
});
