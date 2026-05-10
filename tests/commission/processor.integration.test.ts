import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

// ── Mock @/db so the processor's top-level `db` import points at our
// testcontainer-backed drizzle instance. The mock reads a mutable holder so
// setupTestDb() (which must run inside beforeAll) can install the real db
// before any processor call. ────────────────────────────────────────────────
const dbHolder: { db: unknown } = { db: null };

vi.mock("@/db", () => ({
  get db() {
    return dbHolder.db;
  },
}));

// Import AFTER vi.mock. (Hoisting: vi.mock is hoisted above imports, but we
// put the mock declaration first for readability.)
import {
  commissionLedger,
  locationProducts,
  locations,
  products,
  regions,
  salesRecords,
} from "@/db/schema";
import {
  calculateCommissionsForRecords,
  recalculateCommissions,
} from "@/lib/commission/processor";

/**
 * Phase 7 (NetSuite ETL rewrite): commission base = SUM(netAmount) WHERE
 * isWeknowFee = true. Principal rows must NOT produce ledger entries and
 * must NOT contribute to the cumulative-before SUM.
 */
describe("commission processor — booking-fee semantics (integration)", () => {
  let ctx: TestDbContext;
  let regionId: string;
  let locationId: string;
  let productId: string;
  let locationProductId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbHolder.db = ctx.db;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Clear per-test state. Order respects FK dependencies.
    await ctx.db.delete(commissionLedger);
    await ctx.db.delete(salesRecords);
    await ctx.db.delete(locationProducts);
    await ctx.db.delete(locations);
    await ctx.db.delete(products);
    await ctx.db.delete(regions);

    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK" })
      .returning({ id: regions.id });
    regionId = region.id;

    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: "Hotel A",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });
    locationId = loc.id;

    const [prod] = await ctx.db
      .insert(products)
      .values({ name: "London Eye", netsuiteCode: "LE-001" })
      .returning({ id: products.id });
    productId = prod.id;

    // Flat 10% tier for easy arithmetic across the entire revenue range.
    const [lp] = await ctx.db
      .insert(locationProducts)
      .values({
        locationId,
        productId,
        availability: "available",
        commissionTiers: [
          {
            effectiveFrom: "2025-01-01",
            tiers: [{ minRevenue: 0, maxRevenue: null, rate: 0.1 }],
          },
        ],
      })
      .returning({ id: locationProducts.id });
    locationProductId = lp.id;
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 1 — only booking-fee rows produce ledger entries; principal rows
  //          count as skipped.
  // ────────────────────────────────────────────────────────────────────────
  it("produces ledger entries only for booking-fee rows; principal rows are skipped", async () => {
    const [feeRow] = await ctx.db
      .insert(salesRecords)
      .values({
        regionId,
        saleRef: "S-FEE-1",
        refNo: "R-FEE-1",
        transactionDate: "2025-08-05",
        locationId,
        productId,
        netAmount: "100.00",
        netAmountGbp: "100.00", // Phase 9.1 FX-02 NOT NULL — GBP identity.
        vatAmount: "20.00",
        isWeknowFee: true,
        netsuiteCode: "9991",
      })
      .returning({ id: salesRecords.id });

    const [principalRow] = await ctx.db
      .insert(salesRecords)
      .values({
        regionId,
        saleRef: "S-PRIN-1",
        refNo: "R-PRIN-1",
        transactionDate: "2025-08-05",
        locationId,
        productId,
        netAmount: "500.00",
        netAmountGbp: "500.00", // Phase 9.1 FX-02 NOT NULL — GBP identity.
        vatAmount: "100.00",
        isWeknowFee: false,
        netsuiteCode: "P-001",
      })
      .returning({ id: salesRecords.id });

    const result = await calculateCommissionsForRecords([
      feeRow.id,
      principalRow.id,
    ]);

    expect(result).toEqual({ processed: 2, calculated: 1, skipped: 1 });

    const entries = await ctx.db
      .select({
        salesRecordId: commissionLedger.salesRecordId,
        grossAmountGbp: commissionLedger.grossAmountGbp,
        commissionAmount: commissionLedger.commissionAmount,
      })
      .from(commissionLedger);

    expect(entries).toHaveLength(1);
    expect(entries[0].salesRecordId).toBe(feeRow.id);
    // net=100 stored in grossAmountGbp column (PR #40 review observation A —
    // renamed from gross_amount in migration 0049 to match the GBP semantics
    // FX-04 introduced).
    expect(Number(entries[0].grossAmountGbp)).toBeCloseTo(100);
    // 10% flat tier → 10.00 commission.
    expect(Number(entries[0].commissionAmount)).toBeCloseTo(10);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 2 — cumulative-before SUM excludes principal rows. Seed a principal
  //          row with a huge netAmount; verify the subsequent fee row's tier
  //          math is computed from cumulative = 0 (not 999_999).
  // ────────────────────────────────────────────────────────────────────────
  it("cumulative-before SUM does NOT include principal rows", async () => {
    // Tiered config: the first 1000 of revenue pays 5%, everything above pays 20%.
    // If the principal row (999_999) were counted, the fee row would fall in tier 2
    // and pay 20% × 100 = 20. If correctly excluded, it falls in tier 1: 5% × 100 = 5.
    await ctx.db
      .update(locationProducts)
      .set({
        commissionTiers: [
          {
            effectiveFrom: "2025-01-01",
            tiers: [
              { minRevenue: 0, maxRevenue: 1_000, rate: 0.05 },
              { minRevenue: 1_000, maxRevenue: null, rate: 0.2 },
            ],
          },
        ],
      })
      .where(eq(locationProducts.id, locationProductId));

    // Pre-existing principal row in the same month, already committed to the
    // DB (NOT part of the current batch). Must not contribute to cumulative.
    await ctx.db.insert(salesRecords).values({
      regionId,
      saleRef: "S-PRIN-PRE",
      refNo: "R-PRIN-PRE",
      transactionDate: "2025-08-01",
      locationId,
      productId,
      netAmount: "999999.00",
      netAmountGbp: "999999.00", // Phase 9.1 FX-02 NOT NULL — GBP identity.
      vatAmount: "0.00",
      isWeknowFee: false,
      netsuiteCode: "P-PRE",
    });

    const [feeRow] = await ctx.db
      .insert(salesRecords)
      .values({
        regionId,
        saleRef: "S-FEE-2",
        refNo: "R-FEE-2",
        transactionDate: "2025-08-10",
        locationId,
        productId,
        netAmount: "100.00",
        netAmountGbp: "100.00", // Phase 9.1 FX-02 NOT NULL — GBP identity.
        vatAmount: "20.00",
        isWeknowFee: true,
        netsuiteCode: "9991",
      })
      .returning({ id: salesRecords.id });

    const result = await calculateCommissionsForRecords([feeRow.id]);

    expect(result).toEqual({ processed: 1, calculated: 1, skipped: 0 });

    const [entry] = await ctx.db
      .select({
        commissionAmount: commissionLedger.commissionAmount,
        tierBreakdown: commissionLedger.tierBreakdown,
      })
      .from(commissionLedger);

    // Tier 1 (5% on 100) = 5.00. If principal row leaked in, this would be 20.
    expect(Number(entry.commissionAmount)).toBeCloseTo(5);
    expect(entry.tierBreakdown).toHaveLength(1);
    expect(entry.tierBreakdown[0].tierRate).toBeCloseTo(0.05);
  });

  // ────────────────────────────────────────────────────────────────────────
  // Test 3 — recalculateCommissions only reprocesses booking-fee rows in the
  //          month (principal rows are ignored for recalc too).
  // ────────────────────────────────────────────────────────────────────────
  it("recalculateCommissions only recalculates booking-fee rows", async () => {
    // Seed one fee row + one principal row in the same month. Principal must
    // not produce a ledger entry on recalc.
    // Phase 9.1 FX-02 NOT NULL — GBP identity stamps for all rows.
    await ctx.db.insert(salesRecords).values([
      {
        regionId,
        saleRef: "S-FEE-3",
        refNo: "R-FEE-3",
        transactionDate: "2025-09-03",
        locationId,
        productId,
        netAmount: "200.00",
        netAmountGbp: "200.00",
        vatAmount: "40.00",
        isWeknowFee: true,
        netsuiteCode: "9991",
      },
      {
        regionId,
        saleRef: "S-PRIN-3",
        refNo: "R-PRIN-3",
        transactionDate: "2025-09-03",
        locationId,
        productId,
        netAmount: "700.00",
        netAmountGbp: "700.00",
        vatAmount: "140.00",
        isWeknowFee: false,
        netsuiteCode: "P-003",
      },
    ]);

    const result = await recalculateCommissions(locationProductId, "2025-09");

    expect(result).toEqual({ reversed: 0, recalculated: 1 });

    const entries = await ctx.db
      .select({
        grossAmountGbp: commissionLedger.grossAmountGbp,
        commissionAmount: commissionLedger.commissionAmount,
        isReversal: commissionLedger.isReversal,
      })
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.locationProductId, locationProductId),
          eq(commissionLedger.isReversal, false),
        ),
      );

    expect(entries).toHaveLength(1);
    expect(Number(entries[0].grossAmountGbp)).toBeCloseTo(200);
    // 10% flat tier → 20.00.
    expect(Number(entries[0].commissionAmount)).toBeCloseTo(20);
  });

  // ─── Phase 9.1 / D-15 — multi-currency commission base ────────────────────
  //
  // Pre-FX-04: commission tiers were applied to raw native sums, so a EUR-
  // billing kiosk would cross the £10k tier boundary at €11.5k of native
  // sales (an FX-driven over-count). Post-FX-04: cumulative base reads
  // SUM(net_amount_gbp) and the per-row engine call uses netAmountGbp, so
  // the tier-bracket lookup is GBP-denominated end-to-end. This test seeds
  // a multi-currency window (EUR + GBP) and asserts the cumulative base
  // matches the hand-calculated GBP total.
  it("multi-currency commission window: cumulative base matches GBP-normalised total (D-15)", async () => {
    // EUR sale: net €1000, GBP £850 (rate 0.85 at sale time).
    // GBP sale: net £500.
    // Expected GBP cumulative base after both = £1350.
    // 10% flat tier → £85 + £50 = £135 commission across the two.
    await ctx.db.insert(salesRecords).values([
      {
        regionId,
        saleRef: "S-FEE-EUR",
        refNo: "R-FEE-EUR",
        transactionDate: "2025-10-01",
        locationId,
        productId,
        netAmount: "1000.00",
        netAmountGbp: "850.00",
        vatAmount: "0.00",
        currency: "EUR",
        isWeknowFee: true,
        netsuiteCode: "9991",
      },
      {
        regionId,
        saleRef: "S-FEE-GBP",
        refNo: "R-FEE-GBP",
        transactionDate: "2025-10-02",
        locationId,
        productId,
        netAmount: "500.00",
        netAmountGbp: "500.00",
        vatAmount: "0.00",
        currency: "GBP",
        isWeknowFee: true,
        netsuiteCode: "9991",
      },
    ]);

    const ids = await ctx.db
      .select({ id: salesRecords.id })
      .from(salesRecords)
      .where(eq(salesRecords.transactionDate, "2025-10-01"));
    const idsB = await ctx.db
      .select({ id: salesRecords.id })
      .from(salesRecords)
      .where(eq(salesRecords.transactionDate, "2025-10-02"));

    const result = await calculateCommissionsForRecords([
      ...ids.map((r) => r.id),
      ...idsB.map((r) => r.id),
    ]);
    expect(result.calculated).toBe(2);

    const entries = await ctx.db
      .select({
        grossAmountGbp: commissionLedger.grossAmountGbp,
        commissionAmount: commissionLedger.commissionAmount,
      })
      .from(commissionLedger)
      .where(
        and(
          eq(commissionLedger.locationProductId, locationProductId),
          eq(commissionLedger.isReversal, false),
        ),
      );

    // Two ledger rows; commission base stored in GBP-normalised units per D-15.
    expect(entries).toHaveLength(2);
    const gbpTotal = entries.reduce(
      (sum, e) => sum + Number(e.grossAmountGbp),
      0,
    );
    // £850 (EUR-normalised) + £500 (native GBP) = £1350 — matches hand-calc.
    expect(gbpTotal).toBeCloseTo(1350);
    const commissionTotal = entries.reduce(
      (sum, e) => sum + Number(e.commissionAmount),
      0,
    );
    // 10% flat tier on £1350 GBP cumulative base = £135 total commission.
    expect(commissionTotal).toBeCloseTo(135);
  });
});
