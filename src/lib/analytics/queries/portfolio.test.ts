import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// Mirror the heat-map.test.ts shape: mock db.execute + the shared-condition
// builders so the query body runs end-to-end in JS without touching Postgres.

const mockExecute = vi.fn();

vi.mock("@/db", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics/queries/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/queries/shared")>();
  return {
    ...actual,
    buildExclusionCondition: vi.fn().mockResolvedValue(undefined),
    buildDateCondition: vi.fn().mockReturnValue(undefined),
    buildDimensionFilters: vi.fn().mockReturnValue([]),
    buildMaturityCondition: vi.fn().mockReturnValue(undefined),
    combineConditions: vi.fn().mockReturnValue(undefined),
  };
});

vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi.fn().mockResolvedValue([]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { getOutletTiers } from "./portfolio";
import type { AnalyticsFilters } from "@/lib/analytics/types";
import type { UserCtx } from "@/lib/scoping/scoped-query";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const filters: AnalyticsFilters = {
  dateFrom: "2025-01-01",
  dateTo: "2025-06-30",
};

const userCtx: UserCtx = {
  id: "test-user",
  userType: "internal",
  role: "admin",
};

/**
 * Two properties; the driver-shaped rows the raw query would return.
 *  - Hotel A: 3 active kiosks, 100 rooms, £10,000 revenue, belongs to "Hilton"
 *  - Hotel B: 0 kiosks, null rooms, £5,000 revenue, no group membership
 */
const outletTierRows = [
  {
    location_id: "loc-a",
    outlet_code: "HA",
    hotel_name: "Hotel Alpha",
    live_date: "2025-01-15T00:00:00.000Z",
    hotel_group_name: "Hilton",
    kiosk_count: 3,
    num_rooms: 100,
    revenue: "10000",
    transactions: "500",
  },
  {
    location_id: "loc-b",
    outlet_code: "HB",
    hotel_name: "Hotel Beta",
    live_date: null,
    hotel_group_name: null,
    kiosk_count: 0,
    num_rooms: null,
    revenue: "5000",
    transactions: "200",
  },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("getOutletTiers – property-level enrichment (Phase 4.2)", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("maps kioskCount, numRooms, hotelGroupName, and revenue-per-X correctly", async () => {
    mockExecute.mockResolvedValueOnce(outletTierRows);

    const rows = await getOutletTiers(filters, userCtx);

    expect(rows).toHaveLength(2);

    const alpha = rows.find((r) => r.locationId === "loc-a")!;
    expect(alpha.hotelGroupName).toBe("Hilton");
    expect(alpha.kioskCount).toBe(3);
    expect(alpha.numRooms).toBe(100);
    // 10000 / 3 ≈ 3333.3333
    expect(alpha.revenuePerKiosk).toBeCloseTo(3333.33, 2);
    // 10000 / 100 = 100
    expect(alpha.revenuePerRoom).toBe(100);

    const beta = rows.find((r) => r.locationId === "loc-b")!;
    expect(beta.hotelGroupName).toBeNull();
    expect(beta.kioskCount).toBe(0);
    expect(beta.numRooms).toBeNull();
    // 0 kiosks → null (not Infinity / NaN)
    expect(beta.revenuePerKiosk).toBeNull();
    // null rooms → null (not Infinity / NaN)
    expect(beta.revenuePerRoom).toBeNull();
  });

  it("retains legacy fields (percentile, sharePercentage, tier) alongside the new ones", async () => {
    mockExecute.mockResolvedValueOnce(outletTierRows);

    const rows = await getOutletTiers(filters, userCtx);

    const alpha = rows.find((r) => r.locationId === "loc-a")!;
    const beta = rows.find((r) => r.locationId === "loc-b")!;

    // Shares: Alpha = 10k/15k = 66.67%, Beta = 5k/15k = 33.33%
    expect(alpha.sharePercentage).toBeCloseTo(66.67, 1);
    expect(beta.sharePercentage).toBeCloseTo(33.33, 1);
    // percentile is 0-100 and both rows should have a valid tier assigned
    expect(alpha.percentile).toBeGreaterThanOrEqual(0);
    expect(alpha.percentile).toBeLessThanOrEqual(100);
    expect(["Premium", "Standard", "Developing", "Emerging"]).toContain(alpha.tier);
    expect(["Premium", "Standard", "Developing", "Emerging"]).toContain(beta.tier);
  });

  it("handles numRooms === 0 as null revenuePerRoom (not divide-by-zero)", async () => {
    mockExecute.mockResolvedValueOnce([
      {
        location_id: "loc-z",
        outlet_code: "HZ",
        hotel_name: "Zero Rooms",
        live_date: null,
        hotel_group_name: null,
        kiosk_count: 2,
        num_rooms: 0,
        revenue: "1000",
        transactions: "10",
      },
    ]);

    const [row] = await getOutletTiers(filters, userCtx);
    expect(row.numRooms).toBe(0);
    expect(row.revenuePerRoom).toBeNull();
    // kioskCount > 0 so revenuePerKiosk should still be finite
    expect(row.revenuePerKiosk).toBe(500);
  });

  it("returns an empty array when the query returns no rows", async () => {
    mockExecute.mockResolvedValueOnce([]);

    const rows = await getOutletTiers(filters, userCtx);
    expect(rows).toHaveLength(0);
  });
});
