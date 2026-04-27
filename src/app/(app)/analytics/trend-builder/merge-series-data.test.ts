import { describe, expect, it } from "vitest";
import { mergeSeriesData } from "./merge-series-data";
import type { SeriesConfig, TrendDataPoint } from "@/lib/analytics/types";

// Helper — three days in the same ISO week (2026-04-20 was a Monday).
const WEEK = ["2026-04-20", "2026-04-21", "2026-04-22"];

function avgBasketSeries(id: string): SeriesConfig {
  return {
    id,
    metric: "avg_basket_value",
    filters: {},
    color: "#000",
    label: id,
    hidden: false,
  };
}

function revenueSeries(id: string): SeriesConfig {
  return {
    id,
    metric: "revenue",
    filters: {},
    color: "#000",
    label: id,
    hidden: false,
  };
}

describe("mergeSeriesData", () => {
  describe("avg_basket_value (Task 2.7 — weighted weekly/monthly bucketing)", () => {
    it("computes weighted average per bucket — not the SUM of daily means", () => {
      // Daily means: £10, £20, £30 across three days in the same week.
      // Pre-fix behaviour was 10 + 20 + 30 = 60 (live UAT showed £600 vs £15.62).
      // Post-fix uses the per-day numerator/denominator:
      //   weekly mean = (100 + 200 + 600) / (10 + 10 + 20) = 900 / 40 = 22.5
      const data: TrendDataPoint[] = [
        { date: WEEK[0], value: 10, numerator: 100, denominator: 10 },
        { date: WEEK[1], value: 20, numerator: 200, denominator: 10 },
        { date: WEEK[2], value: 30, numerator: 600, denominator: 20 },
      ];
      const series = avgBasketSeries("s1");
      const allData = new Map([["s1", data]]);

      const result = mergeSeriesData(allData, [series], "weekly");

      expect(result).toHaveLength(1);
      expect(result[0].s1).toBeCloseTo(22.5, 6);
      // Sanity: post-fix bucket value must NOT match the additive (60) shape.
      expect(result[0].s1).not.toBe(60);
    });

    it("collapses an entire month of daily averages into one weighted mean", () => {
      // Two days, very different volumes — the high-volume day should dominate.
      const data: TrendDataPoint[] = [
        { date: "2026-04-01", value: 5, numerator: 50, denominator: 10 },
        { date: "2026-04-15", value: 100, numerator: 100_000, denominator: 1000 },
      ];
      const series = avgBasketSeries("s1");
      const allData = new Map([["s1", data]]);

      const result = mergeSeriesData(allData, [series], "monthly");

      // (50 + 100_000) / (10 + 1000) = 100_050 / 1010 ≈ 99.06
      expect(result).toHaveLength(1);
      expect(result[0].s1).toBeCloseTo(100050 / 1010, 4);
    });

    it("falls back gracefully when num/denom are missing on the point", () => {
      // Defensive: should still produce a finite result rather than NaN/divide-by-zero.
      const data: TrendDataPoint[] = [
        { date: WEEK[0], value: 10 },
        { date: WEEK[1], value: 20 },
      ];
      const series = avgBasketSeries("s1");
      const allData = new Map([["s1", data]]);

      const result = mergeSeriesData(allData, [series], "weekly");
      expect(result).toHaveLength(1);
      expect(Number.isFinite(result[0].s1 as number)).toBe(true);
    });
  });

  describe("additive metrics — must continue to SUM within a bucket", () => {
    it("sums daily revenue values when bucketed weekly (regression guard)", () => {
      const data: TrendDataPoint[] = [
        { date: WEEK[0], value: 100 },
        { date: WEEK[1], value: 200 },
        { date: WEEK[2], value: 300 },
      ];
      const series = revenueSeries("rev");
      const allData = new Map([["rev", data]]);

      const result = mergeSeriesData(allData, [series], "weekly");

      expect(result).toHaveLength(1);
      expect(result[0].rev).toBe(600);
    });

    it("preserves daily values when granularity is daily", () => {
      const data: TrendDataPoint[] = [
        { date: WEEK[0], value: 100 },
        { date: WEEK[1], value: 200 },
      ];
      const series = revenueSeries("rev");
      const allData = new Map([["rev", data]]);

      const result = mergeSeriesData(allData, [series], "daily");

      expect(result).toHaveLength(2);
      expect(result[0].rev).toBe(100);
      expect(result[1].rev).toBe(200);
    });
  });

  it("handles multiple series of mixed metrics in one call", () => {
    const allData = new Map<string, TrendDataPoint[]>([
      [
        "rev",
        [
          { date: WEEK[0], value: 100 },
          { date: WEEK[1], value: 200 },
        ],
      ],
      [
        "abv",
        [
          { date: WEEK[0], value: 10, numerator: 100, denominator: 10 },
          { date: WEEK[1], value: 20, numerator: 200, denominator: 10 },
        ],
      ],
    ]);

    const result = mergeSeriesData(
      allData,
      [revenueSeries("rev"), avgBasketSeries("abv")],
      "weekly",
    );

    expect(result).toHaveLength(1);
    expect(result[0].rev).toBe(300);
    // Weighted mean: (100 + 200) / (10 + 10) = 15
    expect(result[0].abv).toBeCloseTo(15, 6);
  });
});
