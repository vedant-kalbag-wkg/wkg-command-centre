import { describe, it, expect } from "vitest";
import {
  getActiveTierConfig,
  calculateWaterfallCommission,
  calculateCommission,
} from "./engine";
import type { VersionedTierConfig, TierConfig } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STANDARD_TIERS: TierConfig[] = [
  { minRevenue: 0, maxRevenue: 10_000, rate: 0.05 },
  { minRevenue: 10_000, maxRevenue: 25_000, rate: 0.07 },
  { minRevenue: 25_000, maxRevenue: null, rate: 0.10 },
];

const TIER_HISTORY: VersionedTierConfig[] = [
  {
    effectiveFrom: "2025-01-01",
    tiers: [
      { minRevenue: 0, maxRevenue: 20_000, rate: 0.04 },
      { minRevenue: 20_000, maxRevenue: null, rate: 0.06 },
    ],
  },
  {
    effectiveFrom: "2025-07-01",
    tiers: STANDARD_TIERS,
  },
];

// ---------------------------------------------------------------------------
// getActiveTierConfig
// ---------------------------------------------------------------------------

describe("getActiveTierConfig", () => {
  it("selects the latest config before the transaction date", () => {
    const result = getActiveTierConfig(TIER_HISTORY, "2025-09-15");
    expect(result).not.toBeNull();
    expect(result!.effectiveFrom).toBe("2025-07-01");
  });

  it("returns null when no config is active (date before any effectiveFrom)", () => {
    const result = getActiveTierConfig(TIER_HISTORY, "2024-12-31");
    expect(result).toBeNull();
  });

  it("handles a single config in history", () => {
    const single: VersionedTierConfig[] = [
      { effectiveFrom: "2025-01-01", tiers: STANDARD_TIERS },
    ];
    const result = getActiveTierConfig(single, "2025-06-01");
    expect(result).not.toBeNull();
    expect(result!.effectiveFrom).toBe("2025-01-01");
  });

  it("handles exact effectiveFrom date match", () => {
    const result = getActiveTierConfig(TIER_HISTORY, "2025-07-01");
    expect(result).not.toBeNull();
    expect(result!.effectiveFrom).toBe("2025-07-01");
  });

  it("selects earlier config when date is between two configs", () => {
    const result = getActiveTierConfig(TIER_HISTORY, "2025-03-15");
    expect(result).not.toBeNull();
    expect(result!.effectiveFrom).toBe("2025-01-01");
  });
});

// ---------------------------------------------------------------------------
// calculateWaterfallCommission
// ---------------------------------------------------------------------------

describe("calculateWaterfallCommission", () => {
  it("sale fits entirely in one tier bracket", () => {
    // 5,000 starting from 0 → all in tier 1 (0-10k @ 5%)
    const { commissionAmount, breakdown } = calculateWaterfallCommission(
      5_000,
      0,
      STANDARD_TIERS,
    );
    expect(commissionAmount).toBeCloseTo(250); // 5000 * 0.05
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toEqual({
      tierRate: 0.05,
      revenueInTier: 5_000,
      commission: 250,
    });
  });

  it("sale spans two tier brackets", () => {
    // 8,000 starting from cumulative 7,000
    // tier 1: 3,000 (7k→10k @ 5%) = 150
    // tier 2: 5,000 (10k→15k @ 7%) = 350
    const { commissionAmount, breakdown } = calculateWaterfallCommission(
      8_000,
      7_000,
      STANDARD_TIERS,
    );
    expect(commissionAmount).toBeCloseTo(500);
    expect(breakdown).toHaveLength(2);
    expect(breakdown[0]).toEqual({
      tierRate: 0.05,
      revenueInTier: 3_000,
      commission: 150,
    });
    expect(breakdown[1]).toEqual({
      tierRate: 0.07,
      revenueInTier: 5_000,
      commission: 350,
    });
  });

  it("sale spans three tier brackets", () => {
    // 30,000 starting from cumulative 5,000
    // tier 1: 5,000 (5k→10k @ 5%) = 250
    // tier 2: 15,000 (10k→25k @ 7%) = 1,050
    // tier 3: 10,000 (25k→35k @ 10%) = 1,000
    const { commissionAmount, breakdown } = calculateWaterfallCommission(
      30_000,
      5_000,
      STANDARD_TIERS,
    );
    expect(commissionAmount).toBeCloseTo(2_300);
    expect(breakdown).toHaveLength(3);
    expect(breakdown[0]).toEqual({
      tierRate: 0.05,
      revenueInTier: 5_000,
      commission: 250,
    });
    expect(breakdown[1]).toEqual({
      tierRate: 0.07,
      revenueInTier: 15_000,
      commission: 1_050,
    });
    expect(breakdown[2]).toEqual({
      tierRate: 0.10,
      revenueInTier: 10_000,
      commission: 1_000,
    });
  });

  it("respects cumulative position (sale starts mid-bracket)", () => {
    // 2,000 starting from cumulative 12,000
    // cursor is in tier 2 (10k-25k @ 7%), entirely within
    const { commissionAmount, breakdown } = calculateWaterfallCommission(
      2_000,
      12_000,
      STANDARD_TIERS,
    );
    expect(commissionAmount).toBeCloseTo(140); // 2000 * 0.07
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toEqual({
      tierRate: 0.07,
      revenueInTier: 2_000,
      commission: 140,
    });
  });

  it("sale entirely in upper tier (high cumulative)", () => {
    // 10,000 starting from cumulative 30,000 → all in tier 3 (25k+ @ 10%)
    const { commissionAmount, breakdown } = calculateWaterfallCommission(
      10_000,
      30_000,
      STANDARD_TIERS,
    );
    expect(commissionAmount).toBeCloseTo(1_000); // 10000 * 0.10
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toEqual({
      tierRate: 0.10,
      revenueInTier: 10_000,
      commission: 1_000,
    });
  });

  it("zero amount returns zero commission", () => {
    const { commissionAmount, breakdown } = calculateWaterfallCommission(
      0,
      5_000,
      STANDARD_TIERS,
    );
    expect(commissionAmount).toBe(0);
    expect(breakdown).toHaveLength(0);
  });

  it("empty tiers array returns zero", () => {
    const { commissionAmount, breakdown } = calculateWaterfallCommission(
      5_000,
      0,
      [],
    );
    expect(commissionAmount).toBe(0);
    expect(breakdown).toHaveLength(0);
  });

  it("handles maxRevenue: null (unlimited top tier)", () => {
    // 100,000 starting from 26,000 → all in tier 3 (25k+ @ 10%, no ceiling)
    const { commissionAmount, breakdown } = calculateWaterfallCommission(
      100_000,
      26_000,
      STANDARD_TIERS,
    );
    expect(commissionAmount).toBeCloseTo(10_000); // 100000 * 0.10
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0]).toEqual({
      tierRate: 0.10,
      revenueInTier: 100_000,
      commission: 10_000,
    });
  });

  it("sorts tiers by minRevenue even when provided out of order", () => {
    const unorderedTiers: TierConfig[] = [
      { minRevenue: 25_000, maxRevenue: null, rate: 0.10 },
      { minRevenue: 0, maxRevenue: 10_000, rate: 0.05 },
      { minRevenue: 10_000, maxRevenue: 25_000, rate: 0.07 },
    ];
    const { commissionAmount } = calculateWaterfallCommission(
      5_000,
      0,
      unorderedTiers,
    );
    expect(commissionAmount).toBeCloseTo(250); // 5000 * 0.05
  });
});

// ---------------------------------------------------------------------------
// calculateCommission
// ---------------------------------------------------------------------------

describe("calculateCommission", () => {
  it("returns null when no active tier config", () => {
    const result = calculateCommission(
      1_000,
      100,
      0,
      TIER_HISTORY,
      "2024-06-01", // before any effectiveFrom
    );
    expect(result).toBeNull();
  });

  it("returns null when history is empty", () => {
    const result = calculateCommission(1_000, 100, 0, [], "2025-06-01");
    expect(result).toBeNull();
  });

  it("uses grossAmount as commissionable amount", () => {
    const result = calculateCommission(
      5_000,
      200, // bookingFee — ignored for now
      0,
      TIER_HISTORY,
      "2025-08-01",
    );
    expect(result).not.toBeNull();
    expect(result!.commissionableAmount).toBe(5_000);
  });

  it("selects correct tier version based on transaction date", () => {
    // 2025-03-01 → uses Jan 2025 config (4% / 6%)
    const resultJan = calculateCommission(
      10_000,
      0,
      0,
      TIER_HISTORY,
      "2025-03-01",
    );
    expect(resultJan).not.toBeNull();
    expect(resultJan!.tierVersionEffectiveFrom).toBe("2025-01-01");
    expect(resultJan!.commissionAmount).toBeCloseTo(400); // 10000 * 0.04

    // 2025-09-01 → uses Jul 2025 config (5% / 7% / 10%)
    const resultJul = calculateCommission(
      10_000,
      0,
      0,
      TIER_HISTORY,
      "2025-09-01",
    );
    expect(resultJul).not.toBeNull();
    expect(resultJul!.tierVersionEffectiveFrom).toBe("2025-07-01");
    expect(resultJul!.commissionAmount).toBeCloseTo(500); // 10000 * 0.05
  });

  it("returns full CommissionResult shape", () => {
    const result = calculateCommission(
      15_000,
      0,
      8_000,
      TIER_HISTORY,
      "2025-08-01",
    );
    expect(result).not.toBeNull();
    expect(result).toEqual({
      commissionableAmount: 15_000,
      commissionAmount: expect.any(Number),
      tierBreakdown: expect.any(Array),
      tierVersionEffectiveFrom: "2025-07-01",
    });
    // Verify breakdown:
    // tier 1: 2,000 (8k→10k @ 5%) = 100
    // tier 2: 13,000 (10k→23k @ 7%) = 910
    expect(result!.commissionAmount).toBeCloseTo(1_010);
    expect(result!.tierBreakdown).toHaveLength(2);
  });
});
