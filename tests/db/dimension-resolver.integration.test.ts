import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import {
  kioskAssignments,
  kiosks,
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
 * Phase 07-06 — region-scoped resolver, customer_code first then kiosk
 * outlet_code fallback.
 *
 * Resolution passes asserted by these tests:
 *   - Pass 0: `salesRow.customerCode` → `locations.customer_code` (region-scoped)
 *   - Pass 1: `salesRow.outletCode` → `kiosks.outlet_code` →
 *             `kiosk_assignments.location_id` (region-scoped, active assignment)
 *   - Pass 2 (sentinel): unset; tests use the strict path that errors on
 *             unmatched rows.
 *
 * Products + providers semantics are unchanged from Phase 3 (netsuite_code
 * primary, name fallback with back-fill, auto-create on miss).
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
    await ctx.db.delete(kioskAssignments);
    await ctx.db.delete(kiosks);
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

  /**
   * Helper: seed a kiosk-attached location so Pass 1 can resolve via outlet
   * code. `customerCode` is left null so Pass 0 doesn't fire unless the
   * caller explicitly sets it via `over.customerCode`.
   */
  async function seedKioskAttachedLocation(opts: {
    name: string;
    regionId: string;
    outletCode: string;
    customerCode?: string | null;
  }): Promise<string> {
    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: opts.name,
        primaryRegionId: opts.regionId,
        customerCode: opts.customerCode ?? null,
      })
      .returning({ id: locations.id });
    // kioskId must be globally unique. Compose from name + outletCode so
    // tests can seed the same outletCode under multiple regions without
    // colliding on the kiosks_kiosk_id_unique constraint.
    const [kiosk] = await ctx.db
      .insert(kiosks)
      .values({
        kioskId: `KSK-${opts.name.replace(/\s+/g, "_")}-${opts.outletCode}`,
        outletCode: opts.outletCode,
      })
      .returning({ id: kiosks.id });
    await ctx.db.insert(kioskAssignments).values({
      kioskId: kiosk.id,
      locationId: loc.id,
      assignedBy: "test",
      assignedByName: "Integration Test",
    });
    return loc.id;
  }

  const row = (over: Partial<DimensionInput> = {}): DimensionInput => ({
    rowNumber: 1,
    outletCode: "Q5",
    customerCode: null,
    productName: "Uber API",
    netsuiteCode: "4603",
    categoryCode: "TRNSCAR",
    categoryName: "UBER",
    apiProductName: "UberX",
    providerName: "UberSSM",
    ...over,
  });

  // ───────────────────────────────────────────────────────────────────────
  // Pass 0 — customer_code lookup (Phase 07-06 NEW)
  // ───────────────────────────────────────────────────────────────────────

  it("Pass 0: resolves via customer_code when set on the sales row", async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: "Staycity Greenwich",
        primaryRegionId: ukRegionId,
        customerCode: "RPS-2357",
      })
      .returning({ id: locations.id });
    await ctx.db.insert(products).values({ name: "Uber API", netsuiteCode: "4603" });

    const [result] = await resolveDimensions(
      ctx.db,
      [row({ customerCode: "RPS-2357" })],
      { regionId: ukRegionId },
    );
    expect(result).toMatchObject({ rowNumber: 1, locationId: loc.id });
  });

  it("Pass 0 fires even when outlet_code matches no kiosk in the region", async () => {
    // The row's outletCode 'NOPE' has no kiosk anywhere — Pass 1 would fail.
    // But customer_code matches a location, so Pass 0 wins and resolves.
    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: "Customer-First Hotel",
        primaryRegionId: ukRegionId,
        customerCode: "RPS-1111",
      })
      .returning({ id: locations.id });
    await ctx.db.insert(products).values({ name: "Uber API", netsuiteCode: "4603" });

    const [result] = await resolveDimensions(
      ctx.db,
      [row({ outletCode: "NOPE", customerCode: "RPS-1111" })],
      { regionId: ukRegionId },
    );
    expect(result).toMatchObject({ rowNumber: 1, locationId: loc.id });
  });

  it("Pass 0 is region-scoped: same customer_code in two regions stays distinct", async () => {
    const [ukLoc] = await ctx.db
      .insert(locations)
      .values({
        name: "London Customer",
        primaryRegionId: ukRegionId,
        customerCode: "RPS-9000",
      })
      .returning({ id: locations.id });
    const [deLoc] = await ctx.db
      .insert(locations)
      .values({
        name: "Berlin Customer",
        primaryRegionId: deRegionId,
        customerCode: "RPS-9000",
      })
      .returning({ id: locations.id });
    await ctx.db.insert(products).values({ name: "Uber API", netsuiteCode: "4603" });

    const [ukResult] = await resolveDimensions(
      ctx.db,
      [row({ customerCode: "RPS-9000" })],
      { regionId: ukRegionId },
    );
    expect(ukResult).toMatchObject({ locationId: ukLoc.id });

    const [deResult] = await resolveDimensions(
      ctx.db,
      [row({ rowNumber: 2, customerCode: "RPS-9000" })],
      { regionId: deRegionId },
    );
    expect(deResult).toMatchObject({ locationId: deLoc.id });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Pass 1 — kiosks.outlet_code → kiosk_assignments.location_id
  // ───────────────────────────────────────────────────────────────────────

  it("Pass 1: resolves via kiosk outlet_code when customer_code is null", async () => {
    const locId = await seedKioskAttachedLocation({
      name: "Kiosk Hotel",
      regionId: ukRegionId,
      outletCode: "Q5",
      customerCode: null,
    });
    await ctx.db.insert(products).values({ name: "Uber API", netsuiteCode: "4603" });

    const [result] = await resolveDimensions(
      ctx.db,
      [row({ outletCode: "Q5", customerCode: null })],
      { regionId: ukRegionId },
    );
    expect(result).toMatchObject({ rowNumber: 1, locationId: locId });
  });

  it("Pass 1 is region-scoped: same outlet code in two regions stays distinct", async () => {
    const ukLocId = await seedKioskAttachedLocation({
      name: "London Q5",
      regionId: ukRegionId,
      outletCode: "Q5",
    });
    const deLocId = await seedKioskAttachedLocation({
      name: "Berlin Q5",
      regionId: deRegionId,
      outletCode: "Q5",
    });
    await ctx.db.insert(products).values({ name: "Uber API", netsuiteCode: "4603" });

    const [ukResult] = await resolveDimensions(
      ctx.db,
      [row()],
      { regionId: ukRegionId },
    );
    expect(ukResult).toMatchObject({ locationId: ukLocId });

    const [deResult] = await resolveDimensions(
      ctx.db,
      [row({ rowNumber: 2 })],
      { regionId: deRegionId },
    );
    expect(deResult).toMatchObject({ locationId: deLocId });
  });

  it("Pass 1 only matches active kiosk_assignments (unassigned_at IS NULL)", async () => {
    // Seed a location + kiosk + ENDED assignment. Resolving Q5 must miss.
    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: "Past Tenant", primaryRegionId: ukRegionId })
      .returning({ id: locations.id });
    const [kiosk] = await ctx.db
      .insert(kiosks)
      .values({ kioskId: "KSK-Q5-OLD", outletCode: "Q5" })
      .returning({ id: kiosks.id });
    await ctx.db.insert(kioskAssignments).values({
      kioskId: kiosk.id,
      locationId: loc.id,
      assignedBy: "test",
      assignedByName: "Test",
      unassignedAt: new Date(),
    });
    await ctx.db.insert(products).values({ name: "Uber API", netsuiteCode: "4603" });

    const [result] = await resolveDimensions(
      ctx.db,
      [row()],
      { regionId: ukRegionId },
    );
    expect(result).toHaveProperty("errors");
  });

  // ───────────────────────────────────────────────────────────────────────
  // Pass 2 — sentinel fallback / strict error
  // ───────────────────────────────────────────────────────────────────────

  it("flags unknown outlet+customer_code in the given region with an outletCode error", async () => {
    // No locations at all. Resolving must produce an outletCode error
    // mentioning both the missing code and the region.
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
    expect(outletErr!.message).toMatch(new RegExp(`${ukRegionId}|UK`));
  });

  it("routes unmatched outlet codes to sentinelLocationId when set", async () => {
    const [sentinel] = await ctx.db
      .insert(locations)
      .values({ name: "LOCATION_NEEDED", primaryRegionId: ukRegionId })
      .returning({ id: locations.id });
    await ctx.db.insert(products).values({ name: "Uber API", netsuiteCode: "4603" });

    const [result] = await resolveDimensions(
      ctx.db,
      [row({ outletCode: "Z9" })],
      { regionId: ukRegionId, sentinelLocationId: sentinel.id },
    );
    expect(result).toMatchObject({ locationId: sentinel.id });
  });

  // ───────────────────────────────────────────────────────────────────────
  // Product + provider resolution (unchanged from Phase 3)
  // ───────────────────────────────────────────────────────────────────────

  it("resolves products by netsuiteCode even when productName differs", async () => {
    await seedKioskAttachedLocation({
      name: "Hotel A",
      regionId: ukRegionId,
      outletCode: "Q5",
    });

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
    await seedKioskAttachedLocation({
      name: "Hotel A",
      regionId: ukRegionId,
      outletCode: "Q5",
    });

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
    expect(updated.categoryCode).toBe("TRNSCAR");
    expect(updated.categoryName).toBe("UBER");
  });

  it("auto-creates a product when neither netsuiteCode nor name match", async () => {
    await seedKioskAttachedLocation({
      name: "Hotel A",
      regionId: ukRegionId,
      outletCode: "Q5",
    });

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
    await seedKioskAttachedLocation({
      name: "Hotel A",
      regionId: ukRegionId,
      outletCode: "Q5",
    });
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
    await seedKioskAttachedLocation({
      name: "Hotel A",
      regionId: ukRegionId,
      outletCode: "Q5",
    });
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
});
