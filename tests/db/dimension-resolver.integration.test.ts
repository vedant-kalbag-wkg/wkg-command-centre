import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import { locations, products, providers as providersTable } from "@/db/schema";
import { resolveDimensions, type DimensionInput } from "@/lib/csv/dimension-resolver";

describe("resolveDimensions (integration)", () => {
  let ctx: TestDbContext;
  let locationAId: string;
  let locationBId: string;
  let productXId: string;
  let productYId: string;
  let providerZId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    await ctx.db.delete(providersTable);
    await ctx.db.delete(products);
    await ctx.db.delete(locations);

    const [locA] = await ctx.db
      .insert(locations)
      .values({ name: "Hotel A", outletCode: "OUT-A" })
      .returning({ id: locations.id });
    locationAId = locA.id;

    const [locB] = await ctx.db
      .insert(locations)
      .values({ name: "Hotel B", outletCode: "OUT-B" })
      .returning({ id: locations.id });
    locationBId = locB.id;

    const [prodX] = await ctx.db
      .insert(products)
      .values({ name: "London Eye" })
      .returning({ id: products.id });
    productXId = prodX.id;

    const [prodY] = await ctx.db
      .insert(products)
      .values({ name: "Shard View" })
      .returning({ id: products.id });
    productYId = prodY.id;

    const [provZ] = await ctx.db
      .insert(providersTable)
      .values({ name: "AttractionsCo" })
      .returning({ id: providersTable.id });
    providerZId = provZ.id;
  });

  const row = (over: Partial<DimensionInput>): DimensionInput => ({
    rowNumber: 1,
    outletCode: "OUT-A",
    productName: "London Eye",
    providerName: "AttractionsCo",
    ...over,
  });

  it("resolves all three dimensions for valid rows", async () => {
    const result = await resolveDimensions(ctx.db, [
      row({ rowNumber: 1 }),
      row({ rowNumber: 2, outletCode: "OUT-B", productName: "Shard View" }),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      rowNumber: 1,
      locationId: locationAId,
      productId: productXId,
      providerId: providerZId,
    });
    expect(result[1]).toMatchObject({
      rowNumber: 2,
      locationId: locationBId,
      productId: productYId,
      providerId: providerZId,
    });
  });

  it("returns null providerId when providerName is null (valid)", async () => {
    const result = await resolveDimensions(ctx.db, [row({ providerName: null })]);
    expect(result[0]).toMatchObject({
      rowNumber: 1,
      locationId: locationAId,
      productId: productXId,
      providerId: null,
    });
  });

  it("flags unknown outletCode as row-level error", async () => {
    const result = await resolveDimensions(ctx.db, [row({ outletCode: "OUT-BOGUS" })]);
    expect(result[0]).toEqual({
      rowNumber: 1,
      errors: [{ field: "outletCode", message: expect.stringContaining("OUT-BOGUS") }],
    });
  });

  it("flags unknown productName as row-level error", async () => {
    const result = await resolveDimensions(ctx.db, [row({ productName: "Ghost Attraction" })]);
    expect(result[0]).toEqual({
      rowNumber: 1,
      errors: [{ field: "productName", message: expect.stringContaining("Ghost Attraction") }],
    });
  });

  it("flags unknown providerName as row-level error (when non-null)", async () => {
    const result = await resolveDimensions(ctx.db, [row({ providerName: "Phantom Inc" })]);
    expect(result[0]).toEqual({
      rowNumber: 1,
      errors: [{ field: "providerName", message: expect.stringContaining("Phantom Inc") }],
    });
  });

  it("accumulates multiple errors on the same row", async () => {
    const result = await resolveDimensions(ctx.db, [
      row({ outletCode: "X", productName: "Y", providerName: "Z" }),
    ]);
    expect(result[0]).toHaveProperty("errors");
    if ("errors" in result[0]) {
      expect(result[0].errors).toHaveLength(3);
    }
  });

  it("matches productName case-insensitively", async () => {
    const result = await resolveDimensions(ctx.db, [row({ productName: "london eye" })]);
    expect(result[0]).toMatchObject({ productId: productXId });
  });

  it("matches providerName case-insensitively", async () => {
    const result = await resolveDimensions(ctx.db, [row({ providerName: "attractionsco" })]);
    expect(result[0]).toMatchObject({ providerId: providerZId });
  });

  it("matches outletCode exactly (case-sensitive)", async () => {
    const result = await resolveDimensions(ctx.db, [row({ outletCode: "out-a" })]);
    expect(result[0]).toHaveProperty("errors");
  });

  it("handles empty input", async () => {
    const result = await resolveDimensions(ctx.db, []);
    expect(result).toEqual([]);
  });

  it("issues exactly 3 SELECT queries regardless of input size (batched)", async () => {
    const queries: string[] = [];
    // Intercept via pool
    const originalQuery = ctx.pool.query.bind(ctx.pool);
    (ctx.pool as unknown as { query: typeof originalQuery }).query = ((
      text: unknown,
      ...rest: unknown[]
    ) => {
      const sql = typeof text === "string" ? text : (text as { text: string }).text;
      if (sql.toUpperCase().startsWith("SELECT")) queries.push(sql);
      return originalQuery(text as Parameters<typeof originalQuery>[0], ...(rest as []));
    }) as typeof originalQuery;

    try {
      const rows: DimensionInput[] = Array.from({ length: 10 }, (_, i) => row({ rowNumber: i + 1 }));
      await resolveDimensions(ctx.db, rows);
      expect(queries.length).toBe(3);
    } finally {
      (ctx.pool as unknown as { query: typeof originalQuery }).query = originalQuery;
    }
  });
});
