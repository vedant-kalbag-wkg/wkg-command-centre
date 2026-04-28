import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// Mirror the `vi.mock` shape used by `src/lib/analytics/queries/hotel-groups.test.ts`:
// drizzle's chain `db.select().from(t).where(...)` resolves to the rows array,
// so we mock the terminal `where` step. `unstable_cache` is replaced with the
// identity function so the wrapped reader runs eagerly per call.

const mockWhere = vi.fn();

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => mockWhere(...args),
      }),
    }),
  },
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
}));

// Import AFTER mocks so the cached reader picks up the mocked db + cache.
import {
  getOutletTierThresholdsCached,
  OUTLET_TIER_THRESHOLDS_TAG,
} from "../thresholds-server";

describe("getOutletTierThresholdsCached (Phase 6 plan 06-05)", () => {
  beforeEach(() => {
    mockWhere.mockReset();
  });

  it("returns defaults { top: 80, mid: 50, bottom: 20 } when no rows exist", async () => {
    mockWhere.mockResolvedValue([]);
    const config = await getOutletTierThresholdsCached();
    expect(config).toEqual({ top: 80, mid: 50, bottom: 20 });
  });

  it("returns saved overrides when all three keys are present", async () => {
    mockWhere.mockResolvedValue([
      { key: "threshold_outlet_tier_top", value: "85" },
      { key: "threshold_outlet_tier_mid", value: "55" },
      { key: "threshold_outlet_tier_bottom", value: "25" },
    ]);
    const config = await getOutletTierThresholdsCached();
    expect(config).toEqual({ top: 85, mid: 55, bottom: 25 });
  });

  it("falls back to defaults for missing keys (partial override)", async () => {
    mockWhere.mockResolvedValue([
      { key: "threshold_outlet_tier_top", value: "85" },
    ]);
    const config = await getOutletTierThresholdsCached();
    expect(config).toEqual({ top: 85, mid: 50, bottom: 20 });
  });

  it("coerces string values from app_settings.value (text column) to numbers", async () => {
    mockWhere.mockResolvedValue([
      { key: "threshold_outlet_tier_top", value: "85" },
      { key: "threshold_outlet_tier_mid", value: "55" },
      { key: "threshold_outlet_tier_bottom", value: "25" },
    ]);
    const config = await getOutletTierThresholdsCached();
    // Strict equality on JS number — proves Number() coercion happened.
    expect(typeof config.top).toBe("number");
    expect(typeof config.mid).toBe("number");
    expect(typeof config.bottom).toBe("number");
    expect(config.top).toBe(85);
  });

  it("exports a stable cache tag for invalidation", () => {
    expect(OUTLET_TIER_THRESHOLDS_TAG).toBe("analytics:outlet_tier_thresholds");
  });
});
