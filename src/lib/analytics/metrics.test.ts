import { describe, it, expect } from "vitest";
import {
  calculatePeriodChange, getPreviousPeriodDates,
  calculateCompositeScore, calculateRevenuePerRoom,
  calculateTxnPerKiosk, calculateAvgBasketValue,
  classifyOutletTier, calculatePercentile,
  getComparisonDates,
} from "./metrics";

describe("calculatePeriodChange", () => {
  it("calculates percentage change", () => {
    expect(calculatePeriodChange(12000, 10000)).toBeCloseTo(20.0);
  });
  it("returns null when previous is zero", () => {
    expect(calculatePeriodChange(100, 0)).toBeNull();
  });
  it("handles negative change", () => {
    expect(calculatePeriodChange(8000, 10000)).toBeCloseTo(-20.0);
  });
});

describe("getPreviousPeriodDates", () => {
  it("calculates same-duration previous period", () => {
    const { prevFrom, prevTo } = getPreviousPeriodDates("2025-02-01", "2025-02-28");
    expect(prevTo).toBe("2025-01-31");
    expect(prevFrom).toBe("2025-01-04");
  });
});

describe("calculateCompositeScore", () => {
  it("computes weighted score", () => {
    const score = calculateCompositeScore([
      { value: 100, weight: 0.5 },
      { value: 50, weight: 0.5 },
    ]);
    expect(score).toBeCloseTo(75);
  });
  it("redistributes weight when value is null", () => {
    const score = calculateCompositeScore([
      { value: 80, weight: 0.5 },
      { value: null, weight: 0.3 },
      { value: 60, weight: 0.2 },
    ]);
    expect(score).toBeCloseTo(74.29, 1);
  });
  it("returns 0 when all values null", () => {
    expect(calculateCompositeScore([{ value: null, weight: 1 }])).toBe(0);
  });
});

// Phase 6 plan 06-05 — `classifyOutletTier` now takes an `OutletTierConfig`
// second arg; the boundary suite lives in
// `src/lib/analytics/__tests__/metrics.test.ts`. Smoke-test with the default
// 80/50/20 cutoffs here so the existing top-level metrics suite continues to
// catch regressions.
const DEFAULT_TIER_CONFIG = { top: 80, mid: 50, bottom: 20 } as const;

describe("classifyOutletTier", () => {
  it(">=80 -> Premium", () =>
    expect(classifyOutletTier(85, DEFAULT_TIER_CONFIG)).toBe("Premium"));
  it(">=50 -> Standard", () =>
    expect(classifyOutletTier(60, DEFAULT_TIER_CONFIG)).toBe("Standard"));
  it(">=20 -> Developing", () =>
    expect(classifyOutletTier(30, DEFAULT_TIER_CONFIG)).toBe("Developing"));
  it("<20 -> Emerging", () =>
    expect(classifyOutletTier(10, DEFAULT_TIER_CONFIG)).toBe("Emerging"));
});

describe("calculatePercentile", () => {
  it("returns 0 for empty array", () => {
    expect(calculatePercentile(50, [])).toBe(0);
  });
  it("calculates rank correctly", () => {
    const all = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(calculatePercentile(50, all)).toBe(50);
  });
});

describe("capacity metrics", () => {
  it("revenue per room", () => {
    expect(calculateRevenuePerRoom(10000, 50)).toBe(200);
  });
  it("revenue per room with null rooms", () => {
    expect(calculateRevenuePerRoom(10000, null)).toBeNull();
  });
  it("txn per kiosk", () => {
    expect(calculateTxnPerKiosk(500, 5)).toBe(100);
  });
  it("avg basket value", () => {
    expect(calculateAvgBasketValue(10000, 200)).toBe(50);
  });
  it("avg basket value with zero txns", () => {
    expect(calculateAvgBasketValue(10000, 0)).toBeNull();
  });
});

describe("getComparisonDates — yoy Feb 29 fallback (Task 2.11)", () => {
  it("Feb 29 2024 → Feb 28 2023 (not Mar 1)", () => {
    const { prevFrom, prevTo } = getComparisonDates(
      "2024-02-29",
      "2024-02-29",
      "yoy",
    );
    expect(prevFrom).toBe("2023-02-28");
    expect(prevTo).toBe("2023-02-28");
  });
  it("non-Feb-29 dates shift by exactly one year", () => {
    const { prevFrom, prevTo } = getComparisonDates(
      "2025-06-15",
      "2025-06-30",
      "yoy",
    );
    expect(prevFrom).toBe("2024-06-15");
    expect(prevTo).toBe("2024-06-30");
  });
});
