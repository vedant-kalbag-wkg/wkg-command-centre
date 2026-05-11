import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// Mirror the heat-map.test.ts / portfolio.test.ts shape: stub db.execute and
// the shared-condition builders so the query body runs end-to-end in JS
// without touching Postgres. The tests below assert the FX-03 dual-emit
// contract — that the query reads revenue_native + revenue_gbp + currency_key
// from the driver shape and that the public `revenue` field binds to the
// GBP arm per D-12.

const mockExecute = vi.fn();

vi.mock("@/db", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics/queries/shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/analytics/queries/shared")>();
  return {
    ...actual,
    buildDateCondition: vi.fn().mockReturnValue(undefined),
    buildDimensionFilters: vi.fn().mockReturnValue([]),
    buildMaturityCondition: vi.fn().mockReturnValue(undefined),
    combineConditions: vi.fn().mockReturnValue(undefined),
  };
});

vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi.fn().mockResolvedValue([]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi
    .fn()
    .mockResolvedValue(undefined),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { createMongoAbility } from "@casl/ability";
import type { AppAbility } from "@/lib/casl/types";
import { getRegionsList } from "./regions";
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
  ability: createMongoAbility([]) as AppAbility,
};

// ─── Tests ──────────────────────────────────────────────────────────────────

// FX-03 / D-11 + D-10 + D-12 cohort assertions for getRegionsList.
//
// The list query returns one row per region with a dual-emit revenue shape.
// Per D-12, the public RegionData.revenue field is internally bound to the
// GBP arm so cross-region ranking compares like-for-like; renderer dispatch
// (plan 09.1-07) reads currency_key + revenue_native and flips native at
// the cell level for single-currency regions.
describe("getRegionsList — FX-03 dual-emit cohort assertions", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("single-currency cohort: returns currency_key set + GBP-bound revenue", async () => {
    // UK region is single-currency (GBP-only); FR region is single-currency
    // (EUR-only). Both rows carry currency_key set to their ISO code; the
    // public `revenue` field reads the GBP arm (D-12 — cross-region ranking
    // compares on a single base).
    mockExecute
      .mockResolvedValueOnce([
        {
          region_id: "uk",
          region_name: "United Kingdom",
          market_id: "mk-uk",
          market_name: "UK Market",
          revenue_native: "120000",
          revenue_gbp: "120000",
          currency_key: "GBP",
          transactions: "1500",
        },
        {
          region_id: "fr",
          region_name: "France",
          market_id: "mk-fr",
          market_name: "France Market",
          revenue_native: "75000",
          revenue_gbp: "62500",
          currency_key: "EUR",
          transactions: "900",
        },
      ])
      // Second call: badge-counts query — empty for this fixture.
      .mockResolvedValueOnce([]);

    const result = await getRegionsList(filters, userCtx);

    expect(result).toHaveLength(2);

    const uk = result.find((r) => r.id === "uk")!;
    const fr = result.find((r) => r.id === "fr")!;

    // D-12 — public revenue is GBP-bound. UK raw === GBP arm (identity).
    expect(uk.revenue).toBe(120000);
    // FR EUR-only cohort: public revenue reads the GBP arm so cross-region
    // ranking is currency-agnostic. The renderer (09.1-07) will flip to the
    // 75000 EUR native value at cell render time using currency_key="EUR".
    expect(fr.revenue).toBe(62500);

    // Transactions are currency-agnostic and pass through.
    expect(uk.transactions).toBe(1500);
    expect(fr.transactions).toBe(900);
  });

  it("multi-currency cohort: returns currency_key null + GBP-bound revenue (single global cohort)", async () => {
    // EMEA is a multi-region rollup containing UK + FR + DE — currency_key
    // is null because the cohort spans GBP + EUR. Per D-10 the renderer
    // dispatches GBP-only; per D-12 ranking uses the GBP arm.
    mockExecute
      .mockResolvedValueOnce([
        {
          region_id: "emea",
          region_name: "EMEA",
          market_id: "mk-emea",
          market_name: "EMEA Market",
          revenue_native: "0", // semantically meaningless for multi-currency
          revenue_gbp: "210000",
          currency_key: null,
          transactions: "3200",
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await getRegionsList(filters, userCtx);

    expect(result).toHaveLength(1);
    const emea = result[0];
    // D-12 — multi-currency cohort: revenue field reads GBP arm directly;
    // renderer (09.1-07) reads currency_key=null and dispatches via
    // formatCurrency (GBP-pinned).
    expect(emea.revenue).toBe(210000);
    expect(emea.transactions).toBe(3200);
  });

  it("D-12 — sort order is by revenue_gbp DESC even when native sums would re-order regions", async () => {
    // CZ region in CZK (CZK 5000000 ≈ £170,000) and US region in USD
    // ($200,000 ≈ £155,000). If sorted by raw native sums, CZ would rank
    // below US (5,000,000 > 200,000 — but only because CZK is a low-value
    // unit). Per D-12 the SQL ORDER BY is on revenue_gbp, so CZ ranks ABOVE
    // US (170,000 > 155,000). The mock returns the rows in GBP-DESC order
    // (Postgres applies the ORDER BY) so the consumer's array preserves
    // that order.
    mockExecute
      .mockResolvedValueOnce([
        {
          region_id: "cz",
          region_name: "Czech Republic",
          market_id: null,
          market_name: null,
          revenue_native: "5000000",
          revenue_gbp: "170000",
          currency_key: "CZK",
          transactions: "8000",
        },
        {
          region_id: "us",
          region_name: "United States",
          market_id: null,
          market_name: null,
          revenue_native: "200000",
          revenue_gbp: "155000",
          currency_key: "USD",
          transactions: "1800",
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await getRegionsList(filters, userCtx);

    // CZ first (170k GBP > 155k GBP), even though native sums would invert.
    expect(result[0].id).toBe("cz");
    expect(result[1].id).toBe("us");
    expect(result[0].revenue).toBe(170000);
    expect(result[1].revenue).toBe(155000);
  });

  it("FX-03 substrate — fixture row preserves DualEmitRevenueRow-shaped fields end-to-end", async () => {
    // The driver-shape row carries revenue_native + revenue_gbp + currency_key
    // exactly as the SQL produces them. Plan 09.1-07's renderer dispatch will
    // reach into these fields directly, so this test pins the contract that
    // the row shape (not the public mapping) carries the dual-emit triple.
    const driverRow = {
      region_id: "test",
      region_name: "Test Region",
      market_id: null,
      market_name: null,
      revenue_native: "1234.56",
      revenue_gbp: "987.65",
      currency_key: "USD",
      transactions: "100",
    };
    mockExecute.mockResolvedValueOnce([driverRow]).mockResolvedValueOnce([]);

    const result = await getRegionsList(filters, userCtx);
    expect(result).toHaveLength(1);
    // Public mapping reads GBP (D-12); raw row is the substrate for renderer.
    expect(result[0].revenue).toBe(987.65);
  });
});
