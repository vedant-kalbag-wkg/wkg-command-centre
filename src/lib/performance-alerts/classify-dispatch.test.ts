import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { decideAlert } from "./classify-dispatch";
import type { Tier } from "./classify-dispatch";

const NOW = new Date("2026-05-04T09:00:00Z");

describe("decideAlert", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns flip-in when prior is null and newTier is Emerging", () => {
    expect(decideAlert(null, "Emerging", NOW)).toBe("flip-in");
  });

  it("returns flip-in when prior tier is Standard and newTier is Emerging", () => {
    expect(
      decideAlert({ tier: "Standard", lastAlertedAt: null }, "Emerging", NOW),
    ).toBe("flip-in");
  });

  it("returns chronic when prior tier is Emerging and lastAlertedAt is null", () => {
    expect(
      decideAlert({ tier: "Emerging", lastAlertedAt: null }, "Emerging", NOW),
    ).toBe("chronic");
  });

  it("returns chronic when lastAlertedAt is 31 days ago", () => {
    const lastAlertedAt = new Date(NOW.getTime() - 31 * 24 * 60 * 60 * 1000);
    expect(
      decideAlert({ tier: "Emerging", lastAlertedAt }, "Emerging", NOW),
    ).toBe("chronic");
  });

  it("returns no-alert when lastAlertedAt is 29 days ago", () => {
    const lastAlertedAt = new Date(NOW.getTime() - 29 * 24 * 60 * 60 * 1000);
    expect(
      decideAlert({ tier: "Emerging", lastAlertedAt }, "Emerging", NOW),
    ).toBe("no-alert");
  });

  it("returns chronic when lastAlertedAt is exactly 30 days ago", () => {
    const lastAlertedAt = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(
      decideAlert({ tier: "Emerging", lastAlertedAt }, "Emerging", NOW),
    ).toBe("chronic");
  });

  it("returns no-alert when prior is null and newTier is Premium", () => {
    expect(decideAlert(null, "Premium", NOW)).toBe("no-alert");
  });

  it("returns no-alert when prior tier is Emerging but newTier is Standard", () => {
    expect(
      decideAlert({ tier: "Emerging", lastAlertedAt: null }, "Standard", NOW),
    ).toBe("no-alert");
  });
});
