import { describe, it, expect } from "vitest";
import {
  calculateMaturityBucket,
  calculateDetailedMaturityBucket,
} from "./maturity";

// These tests lock in that the maturity-bucket helpers compute against the
// caller-supplied reference date, not `new Date()`. They back up the SQL
// fix in maturity-analysis.ts / shared.ts where `NOW()` was replaced with
// the user-selected end date (filters.dateTo).

describe("calculateDetailedMaturityBucket", () => {
  it("uses the provided reference date, not today", () => {
    const liveDate = new Date("2025-01-01");
    const endDate = new Date("2025-02-01"); // 31 days later
    expect(calculateDetailedMaturityBucket(liveDate, endDate)).toBe("31-60d");
  });

  it("returns 0-30d for a kiosk live 10 days before end", () => {
    const liveDate = new Date("2025-01-21");
    const endDate = new Date("2025-01-31");
    expect(calculateDetailedMaturityBucket(liveDate, endDate)).toBe("0-30d");
  });

  it("returns 61-90d for a kiosk live 75 days before end", () => {
    const liveDate = new Date("2025-01-01");
    const endDate = new Date("2025-03-17"); // 75 days later
    expect(calculateDetailedMaturityBucket(liveDate, endDate)).toBe("61-90d");
  });

  it("returns 90+d for a kiosk live well before end", () => {
    const liveDate = new Date("2024-01-01");
    const endDate = new Date("2025-01-01");
    expect(calculateDetailedMaturityBucket(liveDate, endDate)).toBe("90+d");
  });

  it("returns null when liveDate is null", () => {
    expect(calculateDetailedMaturityBucket(null, new Date())).toBeNull();
  });

  it("does NOT classify a historical window as 0-30d just because NOW() is close to today", () => {
    // Kiosk went live Jan 1 2023. The user's reporting window ends Dec 31 2023.
    // Against NOW() (well into 2026) every kiosk would land in 90+d — against
    // the selected end date (Dec 31 2023) this kiosk is ~365d old → 90+d too,
    // but a kiosk that went live Dec 15 2023 should be 0-30d, NOT 90+d.
    const liveDate = new Date("2023-12-15");
    const endDate = new Date("2023-12-31"); // 16 days later
    expect(calculateDetailedMaturityBucket(liveDate, endDate)).toBe("0-30d");
  });
});

describe("calculateMaturityBucket (monthly buckets)", () => {
  it("uses the provided reference date, not today", () => {
    const liveDate = new Date("2025-01-01");
    const endDate = new Date("2025-02-15"); // ~1.5 months later
    expect(calculateMaturityBucket(liveDate, endDate)).toBe("1-3mo");
  });

  it("returns 0-1mo for a very recent install", () => {
    const liveDate = new Date("2025-01-20");
    const endDate = new Date("2025-02-01"); // ~12 days later
    expect(calculateMaturityBucket(liveDate, endDate)).toBe("0-1mo");
  });

  it("returns 6+mo for very old installs", () => {
    const liveDate = new Date("2024-01-01");
    const endDate = new Date("2025-01-01");
    expect(calculateMaturityBucket(liveDate, endDate)).toBe("6+mo");
  });

  it("returns null when liveDate is null", () => {
    expect(calculateMaturityBucket(null, new Date())).toBeNull();
  });
});
