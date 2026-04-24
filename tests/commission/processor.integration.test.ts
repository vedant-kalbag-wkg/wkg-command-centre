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
 * isBookingFee = true. Principal rows must NOT produce ledger entries and
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
        outletCode: "OUT-A",
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
        vatAmount: "20.00",
        isBookingFee: true,
        netsuiteCode: "BF-001",
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
        vatAmount: "100.00",
        isBookingFee: false,
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
        grossAmount: commissionLedger.grossAmount,
        commissionAmount: commissionLedger.commissionAmount,
      })
      .from(commissionLedger);

    expect(entries).toHaveLength(1);
    expect(entries[0].salesRecordId).toBe(feeRow.id);
    // net=100 stored in grossAmount column (column not renamed this phase).
    expect(Number(entries[0].grossAmount)).toBeCloseTo(100);
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
      vatAmount: "0.00",
      isBookingFee: false,
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
        vatAmount: "20.00",
        isBookingFee: true,
        netsuiteCode: "BF-002",
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
    await ctx.db.insert(salesRecords).values([
      {
        regionId,
        saleRef: "S-FEE-3",
        refNo: "R-FEE-3",
        transactionDate: "2025-09-03",
        locationId,
        productId,
        netAmount: "200.00",
        vatAmount: "40.00",
        isBookingFee: true,
        netsuiteCode: "BF-003",
      },
      {
        regionId,
        saleRef: "S-PRIN-3",
        refNo: "R-PRIN-3",
        transactionDate: "2025-09-03",
        locationId,
        productId,
        netAmount: "700.00",
        vatAmount: "140.00",
        isBookingFee: false,
        netsuiteCode: "P-003",
      },
    ]);

    const result = await recalculateCommissions(locationProductId, "2025-09");

    expect(result).toEqual({ reversed: 0, recalculated: 1 });

    const entries = await ctx.db
      .select({
        grossAmount: commissionLedger.grossAmount,
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
    expect(Number(entries[0].grossAmount)).toBeCloseTo(200);
    // 10% flat tier → 20.00.
    expect(Number(entries[0].commissionAmount)).toBeCloseTo(20);
  });
});
