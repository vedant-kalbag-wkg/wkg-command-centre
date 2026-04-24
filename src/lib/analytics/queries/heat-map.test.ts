import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

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

// Phase 1 #6: new request-scoped active-location helper. Under test we don't
// care which IDs get fetched — `combineConditions` is stubbed to undefined
// anyway — so just short-circuit it to a no-op condition. Returning
// undefined keeps parity with the previous `buildExclusionCondition` mock.
vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi.fn().mockResolvedValue([]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi.fn().mockResolvedValue(undefined),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { getHeatMapData } from "./heat-map";
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

/** Two hotels: Hotel A has more revenue, Hotel B has more transactions */
const salesRows = [
  {
    location_id: "loc-1",
    outlet_code: "HA",
    hotel_name: "Hotel Alpha",
    num_rooms: "100",
    live_date: "2025-01-15T00:00:00.000Z",
    hotel_group_name: "Alpha Group",
    kiosk_count: 5,
    revenue: "50000",
    transactions: "200",
    quantity: "400",
  },
  {
    location_id: "loc-2",
    outlet_code: "HB",
    hotel_name: "Hotel Beta",
    num_rooms: "80",
    live_date: null,
    hotel_group_name: "Beta Group",
    kiosk_count: 2,
    revenue: "30000",
    transactions: "400",
    quantity: "600",
  },
];

/** Hotel Alpha has 5 kiosks, Hotel Beta has 2 kiosks */
const kioskRows = [
  { location_id: "loc-1", kiosk_count: "5" },
  { location_id: "loc-2", kiosk_count: "2" },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("getHeatMapData – kiosk enrichment", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("computes txnPerKiosk when kiosk counts are available", async () => {
    // db.execute is called twice (sales + kiosk count) via Promise.all
    mockExecute
      .mockResolvedValueOnce(salesRows)     // sales query
      .mockResolvedValueOnce(kioskRows);    // kiosk count query

    const result = await getHeatMapData(filters, userCtx);

    expect(result.allPerformers).toHaveLength(2);

    const alpha = result.allPerformers.find((h) => h.locationId === "loc-1")!;
    const beta = result.allPerformers.find((h) => h.locationId === "loc-2")!;

    // Hotel Alpha: 200 txns / 5 kiosks = 40
    expect(alpha.txnPerKiosk).toBe(40);
    // Hotel Beta: 400 txns / 2 kiosks = 200
    expect(beta.txnPerKiosk).toBe(200);
  });

  it("sets txnPerKiosk to null for locations with no kiosk assignments", async () => {
    mockExecute
      .mockResolvedValueOnce(salesRows)
      .mockResolvedValueOnce([]);  // no kiosk data at all

    const result = await getHeatMapData(filters, userCtx);

    for (const hotel of result.allPerformers) {
      expect(hotel.txnPerKiosk).toBeNull();
    }
  });

  it("kiosk enrichment affects composite scores vs. no kiosks", async () => {
    // Run 1: WITH kiosk data
    mockExecute
      .mockResolvedValueOnce(salesRows)
      .mockResolvedValueOnce(kioskRows);
    const withKiosks = await getHeatMapData(filters, userCtx);

    // Run 2: WITHOUT kiosk data (all null)
    mockExecute
      .mockResolvedValueOnce(salesRows)
      .mockResolvedValueOnce([]);
    const withoutKiosks = await getHeatMapData(filters, userCtx);

    const alphaWith = withKiosks.allPerformers.find((h) => h.locationId === "loc-1")!;
    const alphaWithout = withoutKiosks.allPerformers.find((h) => h.locationId === "loc-1")!;

    // Composite scores should differ because txnPerKiosk contributes 15% weight
    expect(alphaWith.compositeScore).not.toBe(alphaWithout.compositeScore);
  });

  it("returns empty result when sales query returns no rows", async () => {
    mockExecute
      .mockResolvedValueOnce([])     // empty sales
      .mockResolvedValueOnce([]);    // empty kiosks

    const result = await getHeatMapData(filters, userCtx);

    expect(result.allPerformers).toHaveLength(0);
    expect(result.topPerformers).toHaveLength(0);
    expect(result.bottomPerformers).toHaveLength(0);
  });

  it("handles partial kiosk data (only some locations have kiosks)", async () => {
    // Only loc-1 has kiosk data
    mockExecute
      .mockResolvedValueOnce(salesRows)
      .mockResolvedValueOnce([{ location_id: "loc-1", kiosk_count: "3" }]);

    const result = await getHeatMapData(filters, userCtx);

    const alpha = result.allPerformers.find((h) => h.locationId === "loc-1")!;
    const beta = result.allPerformers.find((h) => h.locationId === "loc-2")!;

    // Alpha: 200 / 3 ≈ 66.67
    expect(alpha.txnPerKiosk).toBeCloseTo(66.67, 1);
    // Beta: no kiosk data → null
    expect(beta.txnPerKiosk).toBeNull();
  });
});

describe("getHeatMapData – property-level enrichment (Phase 4.3)", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("surfaces hotelGroupName, kioskCount, numRooms, and revenuePerKiosk on each row", async () => {
    mockExecute
      .mockResolvedValueOnce(salesRows)
      .mockResolvedValueOnce(kioskRows);

    const result = await getHeatMapData(filters, userCtx);

    const alpha = result.allPerformers.find((h) => h.locationId === "loc-1")!;
    const beta = result.allPerformers.find((h) => h.locationId === "loc-2")!;

    expect(alpha.hotelGroupName).toBe("Alpha Group");
    expect(alpha.kioskCount).toBe(5);
    expect(alpha.numRooms).toBe(100);
    // 50000 revenue / 5 active kiosks = 10000
    expect(alpha.revenuePerKiosk).toBe(10000);

    expect(beta.hotelGroupName).toBe("Beta Group");
    expect(beta.kioskCount).toBe(2);
    expect(beta.numRooms).toBe(80);
    // 30000 / 2 = 15000
    expect(beta.revenuePerKiosk).toBe(15000);
  });

  it("returns null revenuePerKiosk (not Infinity) when kiosk_count is 0", async () => {
    mockExecute
      .mockResolvedValueOnce([
        {
          ...salesRows[0],
          kiosk_count: 0,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await getHeatMapData(filters, userCtx);

    expect(result.allPerformers).toHaveLength(1);
    const hotel = result.allPerformers[0];
    expect(hotel.kioskCount).toBe(0);
    expect(hotel.revenuePerKiosk).toBeNull();
  });

  it("carries hotelGroupName=null through for unaffiliated locations", async () => {
    mockExecute
      .mockResolvedValueOnce([
        {
          ...salesRows[0],
          hotel_group_name: null,
        },
      ])
      .mockResolvedValueOnce([{ location_id: "loc-1", kiosk_count: "5" }]);

    const result = await getHeatMapData(filters, userCtx);

    expect(result.allPerformers).toHaveLength(1);
    expect(result.allPerformers[0].hotelGroupName).toBeNull();
  });
});
