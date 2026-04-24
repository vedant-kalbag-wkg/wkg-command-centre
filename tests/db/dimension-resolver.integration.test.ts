import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import {
  locations,
  products,
  providers as providersTable,
  regions,
} from "@/db/schema";
import {
  resolveDimensions,
  type DimensionInput,
} from "@/lib/csv/dimension-resolver";

/**
 * Phase 3 — region-scoped resolver.
 *
 * The resolver now:
 *   1. Scopes outlet lookup by `regionId`.
 *   2. Resolves products by `netsuiteCode` first, then falls back to `name`
 *      (and back-fills the code on the matched product row).
 *   3. Auto-creates products/providers when nothing matches.
 */
describe("resolveDimensions (integration)", () => {
  let ctx: TestDbContext;
  let ukRegionId: string;
  let deRegionId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Clear per-test state. Order respects FK dependencies.
    await ctx.db.delete(providersTable);
    await ctx.db.delete(products);
    await ctx.db.delete(locations);
    await ctx.db.delete(regions);

    const [uk] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK" })
      .returning({ id: regions.id });
    ukRegionId = uk.id;

    const [de] = await ctx.db
      .insert(regions)
      .values({ name: "Germany", code: "DE" })
      .returning({ id: regions.id });
    deRegionId = de.id;
  });

  const row = (over: Partial<DimensionInput> = {}): DimensionInput => ({
    rowNumber: 1,
    outletCode: "Q5",
    productName: "Uber API",
    netsuiteCode: "4603",
    categoryCode: "TRNSCAR",
    categoryName: "UBER",
    apiProductName: "UberX",
    providerName: "UberSSM",
    ...over,
  });

  it("scopes outlet resolution by regionId (same code, different regions)", async () => {
    const [ukLoc] = await ctx.db
      .insert(locations)
      .values({ name: "Staycity Greenwich", outletCode: "Q5", primaryRegionId: ukRegionId })
      .returning({ id: locations.id });
    const [deLoc] = await ctx.db
      .insert(locations)
      .values({ name: "Berlin Hotel", outletCode: "Q5", primaryRegionId: deRegionId })
      .returning({ id: locations.id });

    // Seed a product so the product pass doesn't error out while we test outlet.
    await ctx.db
      .insert(products)
      .values({ name: "Uber API", netsuiteCode: "4603" });

    const [ukResult] = await resolveDimensions(
      ctx.db,
      [row({ rowNumber: 1 })],
      { regionId: ukRegionId },
    );
    expect(ukResult).toMatchObject({ rowNumber: 1, locationId: ukLoc.id });

    const [deResult] = await resolveDimensions(
      ctx.db,
      [row({ rowNumber: 2 })],
      { regionId: deRegionId },
    );
    expect(deResult).toMatchObject({ rowNumber: 2, locationId: deLoc.id });
  });

  it("flags unknown outlet in the given region with an error mentioning both code and region", async () => {
    // Seed a Q5 location only in UK. Resolving 'Z9' in UK must fail with the
    // outlet code and region in the message.
    await ctx.db
      .insert(locations)
      .values({ name: "Staycity Greenwich", outletCode: "Q5", primaryRegionId: ukRegionId });
    await ctx.db.insert(products).values({ name: "Uber API", netsuiteCode: "4603" });

    const [result] = await resolveDimensions(
      ctx.db,
      [row({ outletCode: "Z9" })],
      { regionId: ukRegionId },
    );

    expect(result).toHaveProperty("errors");
    if (!("errors" in result)) throw new Error("expected errors shape");
    const outletErr = result.errors.find((e) => e.field === "outletCode");
    expect(outletErr).toBeDefined();
    expect(outletErr!.message).toContain("Z9");
    // Either region id or region code is acceptable — spec says id is fine.
    expect(outletErr!.message).toMatch(new RegExp(`${ukRegionId}|UK`));
  });

  it("resolves products by netsuiteCode even when productName differs", async () => {
    await ctx.db
      .insert(locations)
      .values({ name: "Staycity Greenwich", outletCode: "Q5", primaryRegionId: ukRegionId });

    const [seeded] = await ctx.db
      .insert(products)
      .values({ name: "Uber API V1", netsuiteCode: "4603" })
      .returning({ id: products.id });

    const [result] = await resolveDimensions(
      ctx.db,
      [row({ productName: "Different Name", netsuiteCode: "4603" })],
      { regionId: ukRegionId },
    );

    expect(result).toMatchObject({ productId: seeded.id });
  });

  it("falls back to name match when netsuiteCode is unknown, and back-fills the code", async () => {
    await ctx.db
      .insert(locations)
      .values({ name: "Staycity Greenwich", outletCode: "Q5", primaryRegionId: ukRegionId });

    const [seeded] = await ctx.db
      .insert(products)
      .values({ name: "Uber API", netsuiteCode: null })
      .returning({ id: products.id });

    const [result] = await resolveDimensions(
      ctx.db,
      [row({ productName: "Uber API", netsuiteCode: "4603" })],
      { regionId: ukRegionId },
    );

    expect(result).toMatchObject({ productId: seeded.id });

    const [updated] = await ctx.db
      .select({
        id: products.id,
        netsuiteCode: products.netsuiteCode,
        categoryCode: products.categoryCode,
        categoryName: products.categoryName,
      })
      .from(products)
      .where(eq(products.id, seeded.id));

    expect(updated.netsuiteCode).toBe("4603");
    // null-fields should have been filled in from the input. (apiProductName
    // is denormalised on salesRecords, not on products, so it's not part of
    // the product back-fill.)
    expect(updated.categoryCode).toBe("TRNSCAR");
    expect(updated.categoryName).toBe("UBER");
  });

  it("auto-creates a product when neither netsuiteCode nor name match", async () => {
    await ctx.db
      .insert(locations)
      .values({ name: "Staycity Greenwich", outletCode: "Q5", primaryRegionId: ukRegionId });

    const [result] = await resolveDimensions(
      ctx.db,
      [
        row({
          productName: "Brand New Product",
          netsuiteCode: "9876",
          categoryCode: "NEWCAT",
          categoryName: "New Category",
          apiProductName: "NewAPI",
        }),
      ],
      { regionId: ukRegionId },
    );

    expect(result).toHaveProperty("productId");

    const rows = await ctx.db
      .select({
        id: products.id,
        name: products.name,
        netsuiteCode: products.netsuiteCode,
        categoryCode: products.categoryCode,
        categoryName: products.categoryName,
      })
      .from(products)
      .where(eq(products.netsuiteCode, "9876"));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Brand New Product",
      netsuiteCode: "9876",
      categoryCode: "NEWCAT",
      categoryName: "New Category",
    });
    if ("productId" in result) {
      expect(result.productId).toBe(rows[0].id);
    }
  });

  it("auto-creates a provider when the providerName doesn't exist", async () => {
    await ctx.db
      .insert(locations)
      .values({ name: "Staycity Greenwich", outletCode: "Q5", primaryRegionId: ukRegionId });
    await ctx.db.insert(products).values({ name: "Uber API", netsuiteCode: "4603" });

    const [result] = await resolveDimensions(
      ctx.db,
      [row({ providerName: "BrandNewProvider" })],
      { regionId: ukRegionId },
    );

    expect(result).toHaveProperty("providerId");

    const rows = await ctx.db
      .select({ id: providersTable.id, name: providersTable.name })
      .from(providersTable)
      .where(eq(providersTable.name, "BrandNewProvider"));

    expect(rows).toHaveLength(1);
    if ("providerId" in result) {
      expect(result.providerId).toBe(rows[0].id);
    }
  });

  it("treats null providerName as valid (no provider on the row)", async () => {
    await ctx.db
      .insert(locations)
      .values({ name: "Staycity Greenwich", outletCode: "Q5", primaryRegionId: ukRegionId });
    await ctx.db.insert(products).values({ name: "Uber API", netsuiteCode: "4603" });

    const [result] = await resolveDimensions(
      ctx.db,
      [row({ providerName: null })],
      { regionId: ukRegionId },
    );

    expect(result).toMatchObject({ providerId: null });
  });

  it("handles empty input", async () => {
    const result = await resolveDimensions(ctx.db, [], { regionId: ukRegionId });
    expect(result).toEqual([]);
  });

  it("prevents cross-region outlet resolution even when only the other region has the code", async () => {
    // Only DE has Q5 — resolving in UK must error, not quietly return DE's location.
    const [deLoc] = await ctx.db
      .insert(locations)
      .values({ name: "Berlin Hotel", outletCode: "Q5", primaryRegionId: deRegionId })
      .returning({ id: locations.id });
    await ctx.db.insert(products).values({ name: "Uber API", netsuiteCode: "4603" });

    const [ukResult] = await resolveDimensions(
      ctx.db,
      [row()],
      { regionId: ukRegionId },
    );
    expect(ukResult).toHaveProperty("errors");

    const [deResult] = await resolveDimensions(
      ctx.db,
      [row()],
      { regionId: deRegionId },
    );
    expect(deResult).toMatchObject({ locationId: deLoc.id });

    // Sanity: silence unused
    void and;
  });
});
