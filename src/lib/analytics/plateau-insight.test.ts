import { describe, it, expect } from "vitest";
import { getPlateauInsight, PLATEAU_THRESHOLD_PCT } from "./plateau-insight";
import type { MaturityAnalysis, RevenueRampPoint } from "./types";

// Helper — build a MaturityAnalysis whose rampCurve uses the canonical
// 5-bucket lower-edge keys (0, 1, 3, 6, 9). bucketMetrics + installCohorts
// are not consulted by getPlateauInsight; we leave them empty.
function makeAnalysis(rampCurve: RevenueRampPoint[]): MaturityAnalysis {
  return {
    bucketMetrics: [],
    rampCurve,
    installCohorts: [],
  };
}

function ramp(
  monthsSinceInstall: number,
  avgRevenue: number,
  locationCount = 5,
): RevenueRampPoint {
  return { monthsSinceInstall, avgRevenue, locationCount };
}

describe("getPlateauInsight", () => {
  it("reports growth when the cohort revenue rises beyond the threshold", () => {
    // 1-3mo ramp point at 100, 9+mo at 200 → +100% ⇒ "continues to grow".
    const data = makeAnalysis([
      ramp(0, 50),
      ramp(1, 100),
      ramp(3, 140),
      ramp(6, 180),
      ramp(9, 200),
    ]);
    const result = getPlateauInsight(data, "Revenue");
    expect(result.text).toContain("continue to grow");
    expect(result.text).toContain("+100.0%");
    expect(result.color).toBe("#166534");
  });

  it("reports a plateau when young vs mature are within ±threshold", () => {
    // 100 → 105 = +5%, inside the 10% band ⇒ plateau message.
    const data = makeAnalysis([
      ramp(0, 50),
      ramp(1, 100),
      ramp(3, 102),
      ramp(6, 104),
      ramp(9, 105),
    ]);
    const result = getPlateauInsight(data, "Revenue");
    expect(result.text).toBe("Revenue plateaus after 9 months");
    expect(result.color).toBe("#6B7280");
  });

  it("reports decline when mature revenue is more than threshold below young", () => {
    // 100 → 70 = -30% ⇒ "declines after maturity".
    const data = makeAnalysis([
      ramp(0, 50),
      ramp(1, 100),
      ramp(3, 90),
      ramp(6, 80),
      ramp(9, 70),
    ]);
    const result = getPlateauInsight(data, "Revenue");
    expect(result.text).toContain("declines after maturity");
    expect(result.text).toContain("-30.0%");
    expect(result.color).toBe("#991B1B");
  });

  it("returns insufficient-data when avgYoung is 0", () => {
    const data = makeAnalysis([
      ramp(0, 0),
      ramp(1, 0),
      ramp(3, 50),
      ramp(6, 80),
      ramp(9, 100),
    ]);
    const result = getPlateauInsight(data, "Revenue");
    expect(result.text).toBe("Insufficient data to determine maturity trend");
    expect(result.color).toBe("#6B7280");
  });

  it("returns insufficient-data when avgYoung is negative (would flip the sign)", () => {
    // Without the `<= 0` guard a negative young value silently inverts the
    // pctChange sign; the dashboard would show "continues to grow" for a
    // mature cohort that's actually below the (negative) young baseline.
    const data = makeAnalysis([
      ramp(0, 0),
      ramp(1, -10),
      ramp(3, 20),
      ramp(6, 50),
      ramp(9, 100),
    ]);
    const result = getPlateauInsight(data, "Revenue");
    expect(result.text).toBe("Insufficient data to determine maturity trend");
  });

  it("returns insufficient-data for an empty rampCurve", () => {
    const data = makeAnalysis([]);
    const result = getPlateauInsight(data, "Revenue");
    expect(result.text).toBe("Insufficient data to determine maturity trend");
  });

  it("returns insufficient-data when the young or mature ramp point has no locations", () => {
    // Mature point exists in the array but no locations contributed → the
    // avgRevenue would be 0 (default of the SQL coalesce), but the more
    // meaningful guard is "no kiosks have aged into 9+mo yet".
    const data = makeAnalysis([
      ramp(0, 50, 5),
      ramp(1, 100, 5),
      ramp(3, 120, 4),
      ramp(6, 140, 2),
      ramp(9, 0, 0),
    ]);
    const result = getPlateauInsight(data, "Revenue");
    expect(result.text).toBe("Insufficient data to determine maturity trend");
  });

  it("respects a caller-supplied threshold override", () => {
    // 100 → 115 = +15%. With default 10% it crosses the threshold (growth).
    // With a 20% threshold it is inside the band (plateau). This is the hook
    // we'd wire to a future admin setting.
    const data = makeAnalysis([
      ramp(0, 50),
      ramp(1, 100),
      ramp(3, 105),
      ramp(6, 110),
      ramp(9, 115),
    ]);
    expect(getPlateauInsight(data, "Revenue").text).toContain(
      "continue to grow",
    );
    expect(getPlateauInsight(data, "Revenue", 20).text).toBe(
      "Revenue plateaus after 9 months",
    );
  });

  it("exposes the default threshold as a constant for callers", () => {
    expect(PLATEAU_THRESHOLD_PCT).toBe(10);
  });
});
