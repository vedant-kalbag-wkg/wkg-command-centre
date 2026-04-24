import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../helpers/test-db";
import {
  auditLogs,
  locations,
  products,
  productCodeFallbacks,
  regions,
  salesRecords,
} from "@/db/schema";
import { updateFeeCodeFallback } from "@/lib/sales/config/fee-fallbacks";

describe("updateFeeCodeFallback (integration)", () => {
  let ctx: TestDbContext;
  let regionId: string;
  let locationId: string;
  let productId: string;
  let fallbackId: string;

  const actor = { id: "actor-1", name: "Test Actor" };

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Order respects FK dependencies.
    await ctx.db.delete(salesRecords);
    await ctx.db.delete(auditLogs);
    await ctx.db.delete(productCodeFallbacks);
    await ctx.db.delete(products);
    await ctx.db.delete(locations);
    await ctx.db.delete(regions);

    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK" })
      .returning({ id: regions.id });
    regionId = region.id;

    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: "Test Hotel", outletCode: "TH1", primaryRegionId: regionId })
      .returning({ id: locations.id });
    locationId = loc.id;

    const [prod] = await ctx.db
      .insert(products)
      .values({ name: "Booking Fee", netsuiteCode: "9991" })
      .returning({ id: products.id });
    productId = prod.id;

    const [fallback] = await ctx.db
      .insert(productCodeFallbacks)
      .values({ productName: "Booking Fee", netsuiteCode: "9991" })
      .returning({ id: productCodeFallbacks.id });
    fallbackId = fallback.id;

    // Seed 3 salesRecords pointing at the product w/ the fallback code.
    for (let i = 0; i < 3; i++) {
      await ctx.db.insert(salesRecords).values({
        regionId,
        saleRef: `SR-${i}`,
        refNo: `REF-${i}`,
        transactionDate: "2026-01-0" + (i + 1),
        locationId,
        productId,
        netAmount: "10.00",
        vatAmount: "2.00",
        isBookingFee: true,
        netsuiteCode: "9991",
      });
    }
  });

  it("propagates 9991 → 9993 across fallback row, product, and sales records, writing one audit log", async () => {
    const result = await updateFeeCodeFallback(
      ctx.db,
      actor,
      "Booking Fee",
      "9993",
    );

    expect(result).toEqual({ updatedProducts: 1, updatedSalesRecords: 3 });

    const [fb] = await ctx.db
      .select({ netsuiteCode: productCodeFallbacks.netsuiteCode })
      .from(productCodeFallbacks)
      .where(eq(productCodeFallbacks.id, fallbackId));
    expect(fb.netsuiteCode).toBe("9993");

    const [prod] = await ctx.db
      .select({ netsuiteCode: products.netsuiteCode })
      .from(products)
      .where(eq(products.id, productId));
    expect(prod.netsuiteCode).toBe("9993");

    const updatedSales = await ctx.db
      .select({ netsuiteCode: salesRecords.netsuiteCode })
      .from(salesRecords)
      .where(eq(salesRecords.productId, productId));
    expect(updatedSales).toHaveLength(3);
    for (const row of updatedSales) {
      expect(row.netsuiteCode).toBe("9993");
    }

    const logs = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "product_code_fallback"),
          eq(auditLogs.entityId, fallbackId),
        ),
      );
    expect(logs).toHaveLength(1);
    const [log] = logs;
    expect(log.action).toBe("update");
    expect(log.field).toBe("netsuite_code");
    expect(log.oldValue).toBe("9991");
    expect(log.newValue).toBe("9993");
    expect(log.metadata).toMatchObject({
      updatedProducts: 1,
      updatedSalesRecords: 3,
    });
  });

  it("is an idempotent no-op when called again with the same value", async () => {
    await updateFeeCodeFallback(ctx.db, actor, "Booking Fee", "9993");
    const logsBefore = await ctx.db.select().from(auditLogs);
    expect(logsBefore).toHaveLength(1);

    const result = await updateFeeCodeFallback(
      ctx.db,
      actor,
      "Booking Fee",
      "9993",
    );
    expect(result).toEqual({ updatedProducts: 0, updatedSalesRecords: 0 });

    const logsAfter = await ctx.db.select().from(auditLogs);
    expect(logsAfter).toHaveLength(1);
  });

  it("throws when called with an unknown productName", async () => {
    await expect(
      updateFeeCodeFallback(ctx.db, actor, "Nonexistent Product", "9999"),
    ).rejects.toThrow(/No fallback configured.*Nonexistent Product/);
  });

  it("updates the fallback row and writes audit even when no product/salesRecords exist yet", async () => {
    // beforeEach seeded a product + 3 salesRecords + a fallback. Drop the
    // downstream rows so only the fallback remains (mirrors a fresh config
    // change before any sales have landed).
    await ctx.db.delete(salesRecords);
    await ctx.db.delete(products);

    const result = await updateFeeCodeFallback(
      ctx.db,
      actor,
      "Booking Fee",
      "9993",
    );

    expect(result).toEqual({ updatedProducts: 0, updatedSalesRecords: 0 });

    const [fallback] = await ctx.db
      .select()
      .from(productCodeFallbacks)
      .where(eq(productCodeFallbacks.productName, "Booking Fee"));
    expect(fallback.netsuiteCode).toBe("9993");

    const logs = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, fallback.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].oldValue).toBe("9991");
    expect(logs[0].newValue).toBe("9993");
    expect(logs[0].metadata).toEqual({
      updatedProducts: 0,
      updatedSalesRecords: 0,
    });
  });

  it("throws when products.netsuiteCode has drifted from the fallback", async () => {
    // beforeEach seeded product+fallback at 9991. Drift the product to 9999
    // (and drop salesRecords so they don't hold the old code via FK).
    await ctx.db.delete(salesRecords);
    await ctx.db
      .update(products)
      .set({ netsuiteCode: "9999" })
      .where(eq(products.name, "Booking Fee"));

    await expect(
      updateFeeCodeFallback(ctx.db, actor, "Booking Fee", "9993"),
    ).rejects.toThrow(/drifted/);

    // Verify rollback: fallback still at 9991, product still at 9999, no audit entry.
    const [fallback] = await ctx.db
      .select()
      .from(productCodeFallbacks)
      .where(eq(productCodeFallbacks.productName, "Booking Fee"));
    expect(fallback.netsuiteCode).toBe("9991");

    const [product] = await ctx.db
      .select()
      .from(products)
      .where(eq(products.name, "Booking Fee"));
    expect(product.netsuiteCode).toBe("9999");

    const logs = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityName, "Booking Fee"));
    expect(logs).toHaveLength(0);
  });
});
