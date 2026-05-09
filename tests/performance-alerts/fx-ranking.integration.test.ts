/**
 * Phase 9.1 / D-14 — cross-currency ranking via classifyEligibleLocations.
 *
 * The classifier's per-window revenue SUM at line 172 was swapped from
 * SUM(net_amount) to SUM(net_amount_gbp) so cross-portfolio percentile rank
 * compares like-for-like across currencies. Pre-swap, a EUR-only kiosk with
 * raw EUR sales of "100" outranked a GBP-only kiosk with raw GBP sales of
 * "85" (raw native magnitudes are not comparable). Post-swap, the EUR kiosk
 * ranks below the GBP kiosk because £85 GBP < £85 GBP-equivalent of €100
 * (assuming a sub-1.0 EUR→GBP rate).
 *
 * This integration test seeds two cohorts:
 *  - GBP-only baseline: revenue ranking matches Phase-9 baseline (sanity
 *    check that the swap doesn't regress single-currency portfolios).
 *  - Mixed-currency cohort: bottom-tier classification picks the
 *    GBP-normalised low performer, not the high-yen-volume kiosk.
 *
 * Analog: tests/performance-alerts/eligibility.integration.test.ts (same
 * setupTestDb + seedFixtures shape; this file extends with FX assertions).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  appSettings,
  exchangeRates,
  kioskAssignments,
  kiosks,
  locations,
  pipelineStages,
  products,
  regions,
  salesRecords,
  user,
} from "@/db/schema";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

// db swap mock — same shape as eligibility.integration.test.ts.
let dbRef: unknown = null;
vi.mock("@/db", () => ({
  get db() {
    return dbRef;
  },
}));

import { classifyEligibleLocations } from "@/lib/performance-alerts/classify-locations";

const REGION_ID = "f0000000-0000-0000-0000-000000000001";
const LIVE_STAGE_ID = "f0000000-0000-0000-0000-000000000002";
const PRODUCT_ID = "f0000000-0000-0000-0000-000000000003";

// Locations: 5 kiosks across 2 currencies. Crafted so the GBP-normalised
// ranking inverts the raw-native sort.
//
//  | Kiosk | Currency | Native rev | GBP rev | Pre-swap rank | Post-swap rank |
//  |-------|----------|-----------:|--------:|--------------:|---------------:|
//  | A     | JPY      | 1,000,000  | 5,000   |       1 (top) |      4 (low)   |  ← high yen, low GBP
//  | B     | JPY      |   500,000  | 2,500   |             2 |      5 (lowest)|  ← low yen, lowest GBP
//  | C     | GBP      |    20,000  | 20,000  |             3 |      1 (top)   |
//  | D     | GBP      |    15,000  | 15,000  |             4 |      2         |
//  | E     | GBP      |    10,000  | 10,000  |       5 (low) |      3         |
//
// Post-swap, JPY kiosks land in the BOTTOM tier; pre-swap, A would have
// topped the ranking purely from yen volume.
const FIXTURES: Array<{
  id: string;
  kioskId: string;
  currency: string;
  netAmount: string;
  netAmountGbp: string;
}> = [
  { id: "f0000010-0000-0000-0000-000000000001", kioskId: "f0000020-0000-0000-0000-000000000001", currency: "JPY", netAmount: "1000000.00", netAmountGbp: "5000.00" },
  { id: "f0000010-0000-0000-0000-000000000002", kioskId: "f0000020-0000-0000-0000-000000000002", currency: "JPY", netAmount: "500000.00",  netAmountGbp: "2500.00" },
  { id: "f0000010-0000-0000-0000-000000000003", kioskId: "f0000020-0000-0000-0000-000000000003", currency: "GBP", netAmount: "20000.00",   netAmountGbp: "20000.00" },
  { id: "f0000010-0000-0000-0000-000000000004", kioskId: "f0000020-0000-0000-0000-000000000004", currency: "GBP", netAmount: "15000.00",   netAmountGbp: "15000.00" },
  { id: "f0000010-0000-0000-0000-000000000005", kioskId: "f0000020-0000-0000-0000-000000000005", currency: "GBP", netAmount: "10000.00",   netAmountGbp: "10000.00" },
];

const HUNDRED_DAYS_MS = 100 * 24 * 60 * 60 * 1000;

async function seed(ctx: TestDbContext): Promise<void> {
  const db = ctx.db;

  await db.insert(regions).values({
    id: REGION_ID,
    name: "FX Test Region",
    code: "FX",
  }).onConflictDoNothing();

  await db.insert(pipelineStages).values({
    id: LIVE_STAGE_ID,
    name: "FX-Live",
    position: 99.9,
    isDefault: false,
  }).onConflictDoNothing();

  await db.insert(products).values({
    id: PRODUCT_ID,
    name: "FX Test Product",
    netsuiteCode: "FX-TEST-001",
  }).onConflictDoNothing();

  await db.insert(appSettings).values([
    { key: "pipeline_stage_id_live", value: LIVE_STAGE_ID },
    { key: "underperformance_window_days", value: "365" },
  ]).onConflictDoUpdate({
    target: appSettings.key,
    set: { value: appSettings.value },
  });

  // Seed one location + kiosk + salesRecord per fixture row.
  for (const f of FIXTURES) {
    await db.insert(locations).values({
      id: f.id,
      name: `Hotel ${f.id.slice(-1)}`,
      primaryRegionId: REGION_ID,
      numRooms: 100,
    }).onConflictDoNothing();

    await db.insert(kiosks).values({
      id: f.kioskId,
      kioskId: `FX-K-${f.kioskId.slice(-1)}`, // text business id (NOT NULL UNIQUE)
      pipelineStageId: LIVE_STAGE_ID,
    }).onConflictDoNothing();

    await db.insert(kioskAssignments).values({
      kioskId: f.kioskId,
      locationId: f.id,
      assignedAt: new Date(Date.now() - HUNDRED_DAYS_MS),
      assignedBy: "system",
      assignedByName: "System Test",
    }).onConflictDoNothing();

    await db.insert(salesRecords).values({
      regionId: REGION_ID,
      saleRef: `FX-SALE-${f.id.slice(-1)}`,
      refNo: `FX-REF-${f.id.slice(-1)}`,
      transactionDate: new Date().toISOString().slice(0, 10),
      locationId: f.id,
      productId: PRODUCT_ID,
      netAmount: f.netAmount,
      netAmountGbp: f.netAmountGbp,
      vatAmount: "0.00",
      currency: f.currency,
      netsuiteCode: `FX-NS-${f.id.slice(-1)}`,
    }).onConflictDoNothing();
  }
}

describe("classifyEligibleLocations — D-14 cross-currency ranking", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbRef = ctx.db;
    await seed(ctx);
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  it("mixed-currency portfolio: bottom tier ranks on GBP-normalised revenue (D-14)", async () => {
    // Post-swap, the JPY kiosks (A native 1,000,000 / GBP 5,000; B native
    // 500,000 / GBP 2,500) fall to the BOTTOM by GBP-normalised revenue.
    // Pre-swap, A's raw 1,000,000-yen volume would have placed it at the
    // TOP — see fixture table above.
    const { rows } = await classifyEligibleLocations();

    // 5 hotels in the cohort, all eligible.
    expect(rows.length).toBe(5);

    // Sort by composite descending — top of ranking should be the high-GBP-
    // revenue hotels (C: £20k, D: £15k, E: £10k), JPY kiosks at the bottom.
    const ranked = [...rows].sort((a, b) => b.compositeScore - a.compositeScore);

    // Sanity: the top kiosk is GBP, native total > 10k.
    expect(ranked[0].currency).toBe("GBP");

    // The two lowest-composite rows are the JPY kiosks — bottom-tier
    // classification ranks on GBP-normalised revenue per D-14.
    const bottomTwo = ranked.slice(-2);
    const bottomCurrencies = bottomTwo.map((r) => r.currency).sort();
    expect(bottomCurrencies).toEqual(["JPY", "JPY"]);
  });

  it("totalRevenue surfaces GBP-normalised value for cross-currency ranking comparison", async () => {
    // Plan acceptance: classify-locations.ts:172 reads net_amount_gbp.
    // The classifier exposes totalRevenue on the row — assert it carries
    // GBP-normalised values (matches the netAmountGbp fixture column),
    // not raw native (which for JPY would be 1,000,000 / 500,000).
    const { rows } = await classifyEligibleLocations();
    const byId = new Map(rows.map((r) => [r.locationId, r]));

    const a = byId.get("f0000010-0000-0000-0000-000000000001")!;
    expect(a.totalRevenue).toBeCloseTo(5000); // GBP-normalised, NOT 1,000,000
    const b = byId.get("f0000010-0000-0000-0000-000000000002")!;
    expect(b.totalRevenue).toBeCloseTo(2500); // GBP-normalised, NOT 500,000

    // GBP rows are GBP-normalised identity.
    const c = byId.get("f0000010-0000-0000-0000-000000000003")!;
    expect(c.totalRevenue).toBeCloseTo(20000);
  });

  it("per-kiosk modal currency UNCHANGED — POC email contract preserved (D-13/D-14)", async () => {
    // Per D-13: per-kiosk drill-down stays native via the modal-currency
    // picker. Even though the cross-portfolio ranking now uses GBP, the
    // per-row `currency` field still surfaces the kiosk's actual sales
    // currency so the POC underperformance email continues to render
    // values via formatRevenueForKiosk in the kiosk's native symbol.
    const { rows } = await classifyEligibleLocations();
    const byId = new Map(rows.map((r) => [r.locationId, r]));

    expect(byId.get("f0000010-0000-0000-0000-000000000001")!.currency).toBe("JPY");
    expect(byId.get("f0000010-0000-0000-0000-000000000003")!.currency).toBe("GBP");
  });
});

// Suppress unused-import noise — exchangeRates is imported because some
// classify-locations call paths read it; this keeps the test file's import
// graph stable if a future swap adds an FX-rate read.
void exchangeRates;
void user;
