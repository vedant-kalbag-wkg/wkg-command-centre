import { describe, it, expect } from "vitest";
import { classifyOutletTier } from "../metrics";
import type { OutletTierConfig } from "../thresholds";

// Boundary tests for `classifyOutletTier(percentile, config)` per Phase 6
// plan 06-05. Cutoffs are inclusive at the lower bound — i.e. percentile === 80
// is "Premium", percentile === 79 is "Standard". The default configuration is
// `{ top: 80, mid: 50, bottom: 20 }`, mirroring the constants the function
// previously hard-coded before the config-injection refactor.

const DEFAULT_CONFIG: OutletTierConfig = { top: 80, mid: 50, bottom: 20 };

describe("classifyOutletTier (Phase 6 plan 06-05)", () => {
  it("85 -> Premium with default config", () => {
    expect(classifyOutletTier(85, DEFAULT_CONFIG)).toBe("Premium");
  });

  it("80 -> Premium (inclusive lower bound)", () => {
    expect(classifyOutletTier(80, DEFAULT_CONFIG)).toBe("Premium");
  });

  it("79 -> Standard", () => {
    expect(classifyOutletTier(79, DEFAULT_CONFIG)).toBe("Standard");
  });

  it("50 -> Standard (inclusive lower bound)", () => {
    expect(classifyOutletTier(50, DEFAULT_CONFIG)).toBe("Standard");
  });

  it("49 -> Developing", () => {
    expect(classifyOutletTier(49, DEFAULT_CONFIG)).toBe("Developing");
  });

  it("20 -> Developing (inclusive lower bound)", () => {
    expect(classifyOutletTier(20, DEFAULT_CONFIG)).toBe("Developing");
  });

  it("19 -> Emerging", () => {
    expect(classifyOutletTier(19, DEFAULT_CONFIG)).toBe("Emerging");
  });

  it("0 -> Emerging", () => {
    expect(classifyOutletTier(0, DEFAULT_CONFIG)).toBe("Emerging");
  });

  it("custom config: 75 with { top: 90, mid: 60, bottom: 30 } -> Standard", () => {
    expect(
      classifyOutletTier(75, { top: 90, mid: 60, bottom: 30 }),
    ).toBe("Standard");
  });

  it("does not throw on invalid config (top < mid) — caller's job to validate", () => {
    // Safety net: a misconfigured DB row should never 500 a dashboard. The
    // form layer enforces top > mid > bottom; here we only assert that the
    // pure function returns *something* in the OutletTier union rather than
    // throwing.
    expect(() =>
      classifyOutletTier(60, { top: 50, mid: 80, bottom: 20 }),
    ).not.toThrow();
  });
});
