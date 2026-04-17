import { describe, it, expect } from "vitest";
import {
  calculatePeriodChange, getPreviousPeriodDates,
  calculateCompositeScore, calculateRevenuePerRoom,
  calculateTxnPerKiosk, calculateAvgBasketValue,
  classifyOutletTier, calculatePercentile,
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

describe("classifyOutletTier", () => {
  it(">=80 -> Premium", () => expect(classifyOutletTier(85)).toBe("Premium"));
  it(">=50 -> Standard", () => expect(classifyOutletTier(60)).toBe("Standard"));
  it(">=20 -> Developing", () => expect(classifyOutletTier(30)).toBe("Developing"));
  it("<20 -> Emerging", () => expect(classifyOutletTier(10)).toBe("Emerging"));
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
