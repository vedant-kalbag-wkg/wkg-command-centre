import { describe, it, expect } from "vitest";
import {
  calculateMaturityBucket,
  MATURITY_BUCKET_VALUES,
} from "./maturity";

// These tests lock in that the maturity-bucket helper computes against the
// caller-supplied reference date, not `new Date()`, and that the 5-bucket
// scheme (D3) covers every months-since-liveDate range. Boundaries are
// left-inclusive / right-exclusive (see header comment in maturity.ts).

describe("MATURITY_BUCKET_VALUES", () => {
  it("exposes exactly the 5 buckets in the D3 order", () => {
    expect(MATURITY_BUCKET_VALUES).toEqual([
      "0-1mo",
      "1-3mo",
      "3-6mo",
      "6-9mo",
      "9+mo",
    ]);
  });
});

describe("calculateMaturityBucket", () => {
  it("uses the provided reference date, not today", () => {
    const liveDate = new Date("2025-01-01");
    const endDate = new Date("2025-02-15"); // ~1.5 months later
    expect(calculateMaturityBucket(liveDate, endDate)).toBe("1-3mo");
  });

  it("returns 0-1mo for a kiosk live ~12 days before end", () => {
    const liveDate = new Date("2025-01-20");
    const endDate = new Date("2025-02-01");
    expect(calculateMaturityBucket(liveDate, endDate)).toBe("0-1mo");
  });

  it("returns 3-6mo for a kiosk live ~4 months before end", () => {
    const liveDate = new Date("2024-09-01");
    const endDate = new Date("2025-01-01"); // ~4 months later
    expect(calculateMaturityBucket(liveDate, endDate)).toBe("3-6mo");
  });

  it("returns 6-9mo for a kiosk live ~7 months before end", () => {
    const liveDate = new Date("2024-06-01");
    const endDate = new Date("2025-01-01"); // ~7 months later
    expect(calculateMaturityBucket(liveDate, endDate)).toBe("6-9mo");
  });

  it("returns 9+mo for very old installs", () => {
    const liveDate = new Date("2024-01-01");
    const endDate = new Date("2025-01-01");
    expect(calculateMaturityBucket(liveDate, endDate)).toBe("9+mo");
  });

  it("returns null when liveDate is null", () => {
    expect(calculateMaturityBucket(null, new Date())).toBeNull();
  });

  it("does NOT classify a historical window by today's clock", () => {
    // Kiosk went live Dec 15 2023. Window ends Dec 31 2023 → 16 days → 0-1mo.
    // Using NOW() (well into 2026) would mis-bucket as 9+mo.
    const liveDate = new Date("2023-12-15");
    const endDate = new Date("2023-12-31");
    expect(calculateMaturityBucket(liveDate, endDate)).toBe("0-1mo");
  });
});
