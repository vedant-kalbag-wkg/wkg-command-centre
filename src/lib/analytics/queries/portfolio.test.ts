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

// Phase 6 plan 06-05 — `getOutletTiers` now reads outlet-tier thresholds from
// `app_settings` via `getOutletTierThresholdsCached`. Stub it with the default
// 80/50/20 cutoffs so this DB-free unit test stays green without exercising
// `db.select`.
vi.mock("@/lib/analytics/thresholds-server", () => ({
  getOutletTierThresholdsCached: vi
    .fn()
    .mockResolvedValue({ top: 80, mid: 50, bottom: 20 }),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { getOutletTiers, getPortfolioSummary } from "./portfolio";
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
 *
 * Phase 9.1 / FX-03 (D-11/D-12): outlet-tier rows now dual-emit revenue_native
 * + revenue_gbp + currency_key. Public `revenue` field on OutletTierRow binds
 * to the GBP arm so percentile rank and sharePercentage compare on a single base.
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
    revenue_native: "10000",
    revenue_gbp: "10000",
    currency_key: "GBP",
    transactions: "500",
    total_count: 2,
  },
  {
    location_id: "loc-b",
    outlet_code: "HB",
    hotel_name: "Hotel Beta",
    live_date: null,
    hotel_group_name: null,
    kiosk_count: 0,
    num_rooms: null,
    revenue_native: "5000",
    revenue_gbp: "5000",
    currency_key: "GBP",
    transactions: "200",
    total_count: 2,
  },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("getOutletTiers – property-level enrichment (Phase 4.2)", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("maps kioskCount, numRooms, hotelGroupName, and revenue-per-X correctly", async () => {
    mockExecute.mockResolvedValueOnce(outletTierRows);

    const { rows, totalCount } = await getOutletTiers(filters, userCtx);

    expect(rows).toHaveLength(2);
    expect(totalCount).toBe(2);

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

    const { rows } = await getOutletTiers(filters, userCtx);

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
        revenue_native: "1000",
        revenue_gbp: "1000",
        currency_key: "GBP",
        transactions: "10",
        total_count: 1,
      },
    ]);

    const { rows } = await getOutletTiers(filters, userCtx);
    const row = rows[0];
    expect(row.numRooms).toBe(0);
    expect(row.revenuePerRoom).toBeNull();
    // kioskCount > 0 so revenuePerKiosk should still be finite
    expect(row.revenuePerKiosk).toBe(500);
  });

  it("returns an empty result when the query returns no rows", async () => {
    mockExecute.mockResolvedValueOnce([]);

    const { rows, totalCount } = await getOutletTiers(filters, userCtx);
    expect(rows).toHaveLength(0);
    expect(totalCount).toBe(0);
  });

  // ─── FX-03 / D-11 + D-10 — dual-emit cohort assertions ───────────────────
  //
  // Per CONTEXT.md D-10: a single-currency cohort renders native (currency_key
  // set to the ISO code); a multi-currency cohort renders GBP (currency_key
  // null). The SQL contract per D-11 is that EVERY aggregate query returns
  // (revenue_native, revenue_gbp, currency_key) — these tests pin the contract
  // at the unit-level by mocking db.execute with both shapes and asserting
  // the public mapping (D-12 — public `revenue` field is GBP-bound).
  //
  // Plan 09.1-07's renderer dispatch will read currency_key + revenue_native
  // and flip native at the cell level when the cohort is single-currency;
  // until then, the public shape is GBP and the substrate is materialised.
  it("FX-03 / D-11 — single-currency cohort: dual-emit row resolves with currency_key set", async () => {
    // Single-currency cohort (EUR-only outlet): SQL returns revenue_native
    // + revenue_gbp + currency_key='EUR'. Public revenue is GBP-bound (D-12).
    mockExecute.mockResolvedValueOnce([
      {
        location_id: "loc-eur",
        outlet_code: "EU",
        hotel_name: "Hotel Paris",
        live_date: "2025-01-15T00:00:00.000Z",
        hotel_group_name: "Accor",
        kiosk_count: 2,
        num_rooms: 80,
        // Native: 12000 EUR; GBP: 10000 (after FX). currency_key set →
        // single-currency cohort, renderer (09.1-07) will flip to native.
        revenue_native: "12000",
        revenue_gbp: "10000",
        currency_key: "EUR",
        transactions: "300",
        total_count: 1,
      },
    ]);

    const { rows } = await getOutletTiers(filters, userCtx);
    expect(rows).toHaveLength(1);
    // D-12 — public revenue binds to GBP arm so cross-currency tier ranking
    // compares like-for-like; renderer dispatch in 09.1-07 layers native.
    expect(rows[0].revenue).toBe(10000);
    // Substrate sanity: percentile rank operates on GBP — the lone row
    // ranks at 100% by share regardless of native magnitude.
    expect(rows[0].sharePercentage).toBeCloseTo(100, 1);
  });

  it("FX-03 / D-11 — multi-currency cohort: dual-emit row resolves with currency_key null", async () => {
    // Multi-currency cohort: SQL returns revenue_native (sum of mixed-currency
    // raws — semantically meaningless but populated for symmetry) +
    // revenue_gbp (the only meaningful aggregate) + currency_key=null.
    mockExecute.mockResolvedValueOnce([
      {
        location_id: "loc-mix",
        outlet_code: "MX",
        hotel_name: "Multi-Region Hotel",
        live_date: "2025-01-15T00:00:00.000Z",
        hotel_group_name: "Mixed",
        kiosk_count: 4,
        num_rooms: 120,
        // currency_key null → multi-currency cohort. Renderer (09.1-07) will
        // pick GBP via pickRevenueDisplay; revenue_native is undefined-shaped
        // for multi-currency aggregates and consumers must not display it.
        revenue_native: "27500",
        revenue_gbp: "22000",
        currency_key: null,
        transactions: "550",
        total_count: 1,
      },
    ]);

    const { rows } = await getOutletTiers(filters, userCtx);
    expect(rows).toHaveLength(1);
    // D-12 — multi-currency cohort: revenue is GBP-bound; renderer reads
    // currency_key=null and dispatches via formatCurrency (GBP-pinned).
    expect(rows[0].revenue).toBe(22000);
  });

  it("FX-03 / D-12 — outlet tier percentile ranks on GBP (not native) across mixed-currency cohorts", async () => {
    // Three outlets: a EUR-only outlet with 12000 EUR (10000 GBP), a USD-only
    // outlet with 13000 USD (10500 GBP), and a GBP-only outlet with 9500 GBP.
    // If percentile ranked on raw native sums, the order would be USD > EUR >
    // GBP (13000 > 12000 > 9500). Per D-12 the ranking is on GBP, so the
    // order is USD > EUR > GBP (10500 > 10000 > 9500) — coincidentally the
    // same in this case, but the SHARE percentages differ vs. the broken
    // native-sum case (10500/30000 vs 13000/34500).
    mockExecute.mockResolvedValueOnce([
      {
        location_id: "loc-eur",
        outlet_code: "EU",
        hotel_name: "EUR Hotel",
        live_date: null,
        hotel_group_name: null,
        kiosk_count: 2,
        num_rooms: 80,
        revenue_native: "12000",
        revenue_gbp: "10000",
        currency_key: "EUR",
        transactions: "300",
        total_count: 3,
      },
      {
        location_id: "loc-usd",
        outlet_code: "US",
        hotel_name: "USD Hotel",
        live_date: null,
        hotel_group_name: null,
        kiosk_count: 3,
        num_rooms: 100,
        revenue_native: "13000",
        revenue_gbp: "10500",
        currency_key: "USD",
        transactions: "320",
        total_count: 3,
      },
      {
        location_id: "loc-gbp",
        outlet_code: "GB",
        hotel_name: "GBP Hotel",
        live_date: null,
        hotel_group_name: null,
        kiosk_count: 2,
        num_rooms: 60,
        revenue_native: "9500",
        revenue_gbp: "9500",
        currency_key: "GBP",
        transactions: "280",
        total_count: 3,
      },
    ]);

    const { rows } = await getOutletTiers(filters, userCtx);
    // D-12 — sharePercentage uses GBP totals: 10500 + 10000 + 9500 = 30000.
    // EUR share: 10000 / 30000 ≈ 33.33%, NOT 12000 / 34500 ≈ 34.78% (the
    // broken pre-FX value). The tier ranking is currency-agnostic.
    const totalGbp = 30000;
    const eur = rows.find((r) => r.locationId === "loc-eur")!;
    const usd = rows.find((r) => r.locationId === "loc-usd")!;
    const gbp = rows.find((r) => r.locationId === "loc-gbp")!;
    expect(eur.sharePercentage).toBeCloseTo((10000 / totalGbp) * 100, 1);
    expect(usd.sharePercentage).toBeCloseTo((10500 / totalGbp) * 100, 1);
    expect(gbp.sharePercentage).toBeCloseTo((9500 / totalGbp) * 100, 1);
    // USD ranks highest; GBP-only outlet last. (Identical to native ranking
    // in this fixture, but the assertion holds for the GBP-bound contract.)
    expect(usd.percentile).toBeGreaterThan(eur.percentile);
    expect(eur.percentile).toBeGreaterThan(gbp.percentile);
  });

  // FX-03 substrate: getPortfolioSummary returns the GBP-bound aggregate
  // public field `totalRevenue` regardless of cohort currency mix. Single-
  // currency and multi-currency cohorts both flow through the same code
  // path because the SQL query produces dual-emit columns either way.
  it("FX-03 / D-11 — getPortfolioSummary returns GBP-bound totalRevenue for single-currency cohort", async () => {
    mockExecute.mockResolvedValueOnce([
      {
        // FX-03 / D-11 dual-emit shape: native + GBP + currency_key.
        total_revenue_native: "15000",
        total_revenue_gbp: "12000",
        currency_key: "EUR",
        total_transactions: "400",
        total_quantity: "400",
        unique_products: "12",
        unique_outlets: "1",
      },
    ]);

    const summary = await getPortfolioSummary(filters, userCtx);
    // D-12 — public totalRevenue is GBP-bound; renderer (09.1-07) reads
    // currency_key + total_revenue_native for native dispatch.
    expect(summary.totalRevenue).toBe(12000);
    expect(summary.totalTransactions).toBe(400);
    // avgBasketValue = totalRevenue / totalTransactions, both GBP-side, so
    // a EUR-only single-currency cohort still yields a like-for-like avg.
    expect(summary.avgBasketValue).toBeCloseTo(30, 4); // 12000 / 400 = 30
  });

  it("FX-03 / D-11 — getPortfolioSummary returns GBP-bound totalRevenue for multi-currency cohort", async () => {
    mockExecute.mockResolvedValueOnce([
      {
        // Multi-currency: currency_key null. revenue_native is the raw-mixed
        // sum (semantically not displayable); revenue_gbp is the only useful
        // aggregate.
        total_revenue_native: "0",
        total_revenue_gbp: "55000",
        currency_key: null,
        total_transactions: "1100",
        total_quantity: "1100",
        unique_products: "30",
        unique_outlets: "8",
      },
    ]);

    const summary = await getPortfolioSummary(filters, userCtx);
    expect(summary.totalRevenue).toBe(55000);
    expect(summary.totalTransactions).toBe(1100);
    // 55000 / 1100 = 50 (avg basket in GBP).
    expect(summary.avgBasketValue).toBeCloseTo(50, 4);
  });

  it("Phase 4.3 — totalCount reflects unrestricted population (LIMIT-aware)", async () => {
    // Driver simulates a window-counted query: all rows carry the same
    // total_count = 250, but only 200 rows are returned (LIMIT trims them).
    mockExecute.mockResolvedValueOnce(
      Array.from({ length: 200 }, (_, i) => ({
        location_id: `loc-${i}`,
        outlet_code: `H${i}`,
        hotel_name: `Hotel ${i}`,
        live_date: null,
        hotel_group_name: null,
        kiosk_count: 1,
        num_rooms: 50,
        revenue_native: String(1000 - i),
        revenue_gbp: String(1000 - i),
        currency_key: "GBP",
        transactions: "10",
        total_count: 250,
      })),
    );

    const { rows, totalCount } = await getOutletTiers(filters, userCtx);
    expect(rows).toHaveLength(200);
    expect(totalCount).toBe(250);
  });
});
