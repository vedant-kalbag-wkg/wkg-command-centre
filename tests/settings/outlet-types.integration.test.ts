import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import {
  auditLogs,
  locations,
  products,
  regions,
  salesImports,
  salesRecords,
} from "@/db/schema";
import {
  _bulkSetLocationTypeForActor,
  _bulkSetPrimaryRegionForActor,
  _listRegionsForActor,
  _listUnclassifiedOutletsForActor,
  _setLocationTypeForActor,
  _setPrimaryRegionForActor,
} from "@/app/(app)/settings/outlet-types/pipeline";

/**
 * Integration tests for the outlet-types server-action pipeline. Exercises the
 * actor-parameterised `_*ForActor` helpers directly against a Testcontainers
 * Postgres — the `"use server"` wrapper in actions.ts only adds the
 * requireRole('admin') gate + revalidateTag, both of which are Next.js
 * concerns and not covered here.
 */
describe("outlet-types server actions (pipeline)", () => {
  let ctx: TestDbContext;
  let regionId: string;
  let productId: string;
  const ACTOR = { id: "test-actor-id", name: "Test Actor" };

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // FK-ordered cleanup: sales_records → sales_imports → products →
    // locations → regions → audit_logs (audit_logs has no FKs).
    await ctx.db.delete(salesRecords);
    await ctx.db.delete(salesImports);
    await ctx.db.delete(products);
    await ctx.db.delete(locations);
    await ctx.db.delete(regions);
    await ctx.db.delete(auditLogs);

    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK", azureCode: "GB" })
      .returning({ id: regions.id });
    regionId = region.id;

    const [product] = await ctx.db
      .insert(products)
      .values({ name: "Test Product", netsuiteCode: "1001" })
      .returning({ id: products.id });
    productId = product.id;
  });

  test("lists only NULL-type, non-archived outlets", async () => {
    // Seed three locations:
    //  1. classified hotel (should be excluded — locationType NOT NULL)
    //  2. archived NULL-type (should be excluded — archivedAt set)
    //  3. active NULL-type (should be returned)
    // Phase 07-06 — outletCode field on the DTO now sources from
    // customer_code; seed with customerCode so the assertion still has a
    // value to match against.
    const [classified] = await ctx.db
      .insert(locations)
      .values({
        name: "Classified Hotel",
        customerCode: "CLS",
        primaryRegionId: regionId,
        locationType: "hotel",
      })
      .returning({ id: locations.id });

    const [archived] = await ctx.db
      .insert(locations)
      .values({
        name: "Archived Unknown",
        customerCode: "ARC",
        primaryRegionId: regionId,
        archivedAt: new Date("2025-01-01"),
      })
      .returning({ id: locations.id });

    const [unclassified] = await ctx.db
      .insert(locations)
      .values({
        name: "Unclassified Outlet",
        customerCode: "UNC",
        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });

    const rows = await _listUnclassifiedOutletsForActor(ctx.db);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(unclassified.id);
    expect(rows[0].outletCode).toBe("UNC");
    expect(rows[0].reviewReason).toBe("missing_type");
    expect(rows[0].notes).toBeNull();
    // Sanity: classified + archived are NOT in the list.
    const returnedIds = rows.map((r) => r.id);
    expect(returnedIds).not.toContain(classified.id);
    expect(returnedIds).not.toContain(archived.id);
  });

  test("Monday placeholder locations surface with reviewReason='imported_from_monday' + notes populated", async () => {
    // Phase 07-06 — placeholder detection switched from outlet_code prefix
    // (`MONDAY-…`) to (NULL customer_code AND mondayItemId set). Same
    // logical set of rows; the signal is the new combination.
    const [placeholder] = await ctx.db
      .insert(locations)
      .values({
        name: "Example Hotel (no mirror3__1 code)",
        customerCode: null,
        mondayItemId: "xyz123",
        primaryRegionId: regionId,
        notes:
          "Imported from Monday (mondayItemId=xyz123) — no customer code on mirror3__1, needs manual review",
      })
      .returning({ id: locations.id });

    const rows = await _listUnclassifiedOutletsForActor(ctx.db);

    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(placeholder.id);
    // outletCode (sourced from customerCode) is NULL on placeholders.
    expect(rows[0].outletCode).toBeNull();
    expect(rows[0].reviewReason).toBe("imported_from_monday");
    expect(rows[0].notes).toContain("Imported from Monday");
    expect(rows[0].notes).toContain("xyz123");
  });

  test("classified Monday-placeholder row is excluded — classification takes precedence over review reason", async () => {
    // A placeholder that's already been classified by an operator MUST NOT
    // reappear in the needs-review list. The exclusion key is still
    // `locationType IS NULL`; the Monday-placeholder signal is only used
    // to label the review reason.
    await ctx.db.insert(locations).values({
      name: "Already Classified Monday Hotel",
      customerCode: null,
      mondayItemId: "abc789",
      primaryRegionId: regionId,
      locationType: "hotel",
      notes: "Imported from Monday (mondayItemId=abc789)",
    });

    const rows = await _listUnclassifiedOutletsForActor(ctx.db);
    expect(rows).toHaveLength(0);
  });

  test("attaches last-30d revenue + transaction count, excludes older rows", async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: "Outlet With Sales",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });

    const today = new Date();
    const withinWindow1 = new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000);
    const withinWindow2 = new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000);
    const outsideWindow = new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000);

    const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

    // Phase 9.1 FX-02 NOT NULL — GBP identity stamps for all rows.
    await ctx.db.insert(salesRecords).values([
      {
        regionId,
        saleRef: "S1",
        refNo: "R1",
        transactionDate: toDateStr(withinWindow1),
        locationId: loc.id,
        productId,
        netAmount: "100.00",
        netAmountGbp: "100.00",
        vatAmount: "0.00",
        netsuiteCode: "1001",
      },
      {
        regionId,
        saleRef: "S2",
        refNo: "R2",
        transactionDate: toDateStr(withinWindow2),
        locationId: loc.id,
        productId,
        netAmount: "250.50",
        netAmountGbp: "250.50",
        vatAmount: "0.00",
        netsuiteCode: "1001",
      },
      {
        regionId,
        saleRef: "S3",
        refNo: "R3",
        transactionDate: toDateStr(outsideWindow),
        locationId: loc.id,
        productId,
        netAmount: "9999.99",
        netAmountGbp: "9999.99",
        vatAmount: "0.00",
        netsuiteCode: "1001",
      },
    ]);

    const rows = await _listUnclassifiedOutletsForActor(ctx.db);
    expect(rows).toHaveLength(1);
    // Only the 2 in-window rows count — 100 + 250.50 = 350.50
    expect(rows[0].last30dRevenue).toBeCloseTo(350.5, 2);
    expect(rows[0].last30dTransactions).toBe(2);
  });

  test("suggestedType falls back to NULL when only the location name has no other classifier signals", async () => {
    // Phase 07-06 — the classifier's outletCode='IN' / 'BK' shortcuts no
    // longer fire from the locations row (outletCode is null here, sourced
    // from customer_code). The remaining heuristics (name patterns,
    // hotelGroup/numRooms/starRating) don't match this row either, so the
    // suggester returns null — that's the correct contract.
    await ctx.db.insert(locations).values({
      name: "Online Booking",
      primaryRegionId: regionId,
    });

    const rows = await _listUnclassifiedOutletsForActor(ctx.db);
    expect(rows).toHaveLength(1);
    expect(rows[0].suggestedType).toBeNull();
  });

  test("setLocationType updates the row and writes an audit log entry", async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: "Classify Me",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });

    await _setLocationTypeForActor(ctx.db, ACTOR, loc.id, "airport");

    const [updated] = await ctx.db
      .select({ locationType: locations.locationType })
      .from(locations)
      .where(eq(locations.id, loc.id));
    expect(updated.locationType).toBe("airport");

    const audits = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "location"),
          eq(auditLogs.entityId, loc.id),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("set_location_type");
    expect(audits[0].field).toBe("location_type");
    expect(audits[0].oldValue).toBeNull();
    expect(audits[0].newValue).toBe("airport");
    expect(audits[0].actorId).toBe(ACTOR.id);
    expect(audits[0].actorName).toBe(ACTOR.name);
    expect(audits[0].entityName).toBe("Classify Me");
  });

  test("bulkSetLocationType updates all locations and writes one audit row per location", async () => {
    const inserts = await ctx.db
      .insert(locations)
      .values([
        { name: "Loc A", primaryRegionId: regionId },
        { name: "Loc B", primaryRegionId: regionId },
        { name: "Loc C", primaryRegionId: regionId, locationType: "hotel" },
      ])
      .returning({ id: locations.id });

    const ids = inserts.map((r) => r.id);
    await _bulkSetLocationTypeForActor(ctx.db, ACTOR, ids, "hex_kiosk");

    const updated = await ctx.db
      .select({ id: locations.id, locationType: locations.locationType })
      .from(locations);
    for (const row of updated) {
      expect(row.locationType).toBe("hex_kiosk");
    }

    const audits = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityType, "location"));
    expect(audits).toHaveLength(3);
    for (const a of audits) {
      expect(a.action).toBe("set_location_type");
      expect(a.newValue).toBe("hex_kiosk");
    }
    // The third location had oldValue='hotel'; the other two were null.
    const byId = new Map(audits.map((a) => [a.entityId, a]));
    expect(byId.get(inserts[0].id)?.oldValue).toBeNull();
    expect(byId.get(inserts[1].id)?.oldValue).toBeNull();
    expect(byId.get(inserts[2].id)?.oldValue).toBe("hotel");
  });

  test("listUnclassifiedOutlets includes primaryRegionId + primaryRegionCode", async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: "Region-Tagged Outlet",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });

    const rows = await _listUnclassifiedOutletsForActor(ctx.db);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(loc.id);
    expect(rows[0].primaryRegionId).toBe(regionId);
    expect(rows[0].primaryRegionCode).toBe("UK");
  });

  test("listRegions returns all regions ordered by name", async () => {
    // Seed two more regions alongside the default UK from beforeEach.
    await ctx.db.insert(regions).values([
      { name: "Germany", code: "DE", azureCode: "DE" },
      { name: "Spain", code: "ES", azureCode: "ES" },
    ]);

    const list = await _listRegionsForActor(ctx.db);
    // Ordered by name asc — Germany, Spain, United Kingdom.
    expect(list.map((r) => r.code)).toEqual(["DE", "ES", "UK"]);
  });

  test("setPrimaryRegion updates the row and writes a primary_region_id audit entry", async () => {
    const [otherRegion] = await ctx.db
      .insert(regions)
      .values({ name: "Germany", code: "DE", azureCode: "DE" })
      .returning({ id: regions.id });

    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: "Move Me",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });

    await _setPrimaryRegionForActor(ctx.db, ACTOR, loc.id, otherRegion.id);

    const [updated] = await ctx.db
      .select({ primaryRegionId: locations.primaryRegionId })
      .from(locations)
      .where(eq(locations.id, loc.id));
    expect(updated.primaryRegionId).toBe(otherRegion.id);

    const audits = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, "location"),
          eq(auditLogs.entityId, loc.id),
        ),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("set_primary_region");
    expect(audits[0].field).toBe("primary_region_id");
    expect(audits[0].oldValue).toBe(regionId);
    expect(audits[0].newValue).toBe(otherRegion.id);
    expect(audits[0].entityName).toBe("Move Me");
  });

  test("setPrimaryRegion rejects an unknown regionId", async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: "Stay Put",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });

    await expect(
      _setPrimaryRegionForActor(
        ctx.db,
        ACTOR,
        loc.id,
        "00000000-0000-0000-0000-000000000000",
      ),
    ).rejects.toThrow(/Region .* not found/);

    // Underlying row untouched.
    const [after] = await ctx.db
      .select({ primaryRegionId: locations.primaryRegionId })
      .from(locations)
      .where(eq(locations.id, loc.id));
    expect(after.primaryRegionId).toBe(regionId);
  });

  test("setPrimaryRegion surfaces composite-unique conflict cleanly", async () => {
    const [otherRegion] = await ctx.db
      .insert(regions)
      .values({ name: "Germany", code: "DE", azureCode: "DE" })
      .returning({ id: regions.id });

    // Phase 07-06 — composite-unique on (region, customer_code). Seed
    // Q5/UK and Q5/DE so a move UK→DE collides.
    const [ukQ5] = await ctx.db
      .insert(locations)
      .values({
        name: "Q5 in UK",
        customerCode: "Q5",
        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });
    await ctx.db.insert(locations).values({
      name: "Q5 in DE",
      customerCode: "Q5",
      primaryRegionId: otherRegion.id,
    });

    // Error message format: "Cannot move <name>: another location with
    // customer code 'Q5' already exists in the target region".
    await expect(
      _setPrimaryRegionForActor(ctx.db, ACTOR, ukQ5.id, otherRegion.id),
    ).rejects.toThrow(/Q5/);

    // Underlying row + audit log untouched.
    const [after] = await ctx.db
      .select({ primaryRegionId: locations.primaryRegionId })
      .from(locations)
      .where(eq(locations.id, ukQ5.id));
    expect(after.primaryRegionId).toBe(regionId);

    const audits = await ctx.db.select().from(auditLogs);
    expect(audits).toHaveLength(0);
  });

  test("bulkSetPrimaryRegion updates 3 locations + writes 3 audit rows in one INSERT", async () => {
    const [otherRegion] = await ctx.db
      .insert(regions)
      .values({ name: "Germany", code: "DE", azureCode: "DE" })
      .returning({ id: regions.id });

    const inserts = await ctx.db
      .insert(locations)
      .values([
        { name: "Loc A", primaryRegionId: regionId },
        { name: "Loc B", primaryRegionId: regionId },
        { name: "Loc C", primaryRegionId: regionId },
      ])
      .returning({ id: locations.id });

    const ids = inserts.map((r) => r.id);
    const result = await _bulkSetPrimaryRegionForActor(
      ctx.db,
      ACTOR,
      ids,
      otherRegion.id,
    );

    expect(result.conflictingIds).toEqual([]);
    expect(new Set(result.okIds)).toEqual(new Set(ids));

    const updated = await ctx.db
      .select({ id: locations.id, primaryRegionId: locations.primaryRegionId })
      .from(locations);
    for (const row of updated) {
      expect(row.primaryRegionId).toBe(otherRegion.id);
    }

    const audits = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityType, "location"));
    expect(audits).toHaveLength(3);
    for (const a of audits) {
      expect(a.action).toBe("set_primary_region");
      expect(a.field).toBe("primary_region_id");
      expect(a.oldValue).toBe(regionId);
      expect(a.newValue).toBe(otherRegion.id);
    }
  });

  test("bulkSetPrimaryRegion splits ok-ids from conflicting-ids on composite collision", async () => {
    const [otherRegion] = await ctx.db
      .insert(regions)
      .values({ name: "Germany", code: "DE", azureCode: "DE" })
      .returning({ id: regions.id });

    // Phase 07-06 — composite-unique on (region, customer_code). Seed
    // Q5/UK + M3/UK + Q5/DE — moving UK→DE should apply only to M3 and
    // report Q5 as conflicting (Q5 already taken in DE).
    const [ukQ5] = await ctx.db
      .insert(locations)
      .values({
        name: "Q5 UK",
        customerCode: "Q5",
        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });
    const [ukM3] = await ctx.db
      .insert(locations)
      .values({
        name: "M3 UK",
        customerCode: "M3",
        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });
    await ctx.db.insert(locations).values({
      name: "Q5 DE",
      customerCode: "Q5",
      primaryRegionId: otherRegion.id,
    });

    const result = await _bulkSetPrimaryRegionForActor(
      ctx.db,
      ACTOR,
      [ukQ5.id, ukM3.id],
      otherRegion.id,
    );
    expect(result.okIds).toEqual([ukM3.id]);
    expect(result.conflictingIds).toEqual([ukQ5.id]);

    // Q5/UK stays in UK; M3 moves to DE.
    const [q5After] = await ctx.db
      .select({ primaryRegionId: locations.primaryRegionId })
      .from(locations)
      .where(eq(locations.id, ukQ5.id));
    expect(q5After.primaryRegionId).toBe(regionId);
    const [m3After] = await ctx.db
      .select({ primaryRegionId: locations.primaryRegionId })
      .from(locations)
      .where(eq(locations.id, ukM3.id));
    expect(m3After.primaryRegionId).toBe(otherRegion.id);

    // Only M3 has an audit row.
    const audits = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityType, "location"));
    expect(audits).toHaveLength(1);
    expect(audits[0].entityId).toBe(ukM3.id);
    expect(audits[0].action).toBe("set_primary_region");
  });

  test("bulkSetPrimaryRegion with an empty array is a no-op (no writes)", async () => {
    const [otherRegion] = await ctx.db
      .insert(regions)
      .values({ name: "Germany", code: "DE", azureCode: "DE" })
      .returning({ id: regions.id });

    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: "Should Not Move",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });

    const result = await _bulkSetPrimaryRegionForActor(
      ctx.db,
      ACTOR,
      [],
      otherRegion.id,
    );
    expect(result).toEqual({ okIds: [], conflictingIds: [] });

    const [after] = await ctx.db
      .select({ primaryRegionId: locations.primaryRegionId })
      .from(locations)
      .where(eq(locations.id, loc.id));
    expect(after.primaryRegionId).toBe(regionId);

    const audits = await ctx.db.select().from(auditLogs);
    expect(audits).toHaveLength(0);
  });

  test("includeClassified=true surfaces classified rows alongside NULL-type rows; archived stays excluded", async () => {
    // Seed three locations:
    //   - 1 NULL-type (should always show)
    //   - 1 classified hotel (only shows when includeClassified=true)
    //   - 1 archived (always excluded, regardless of the option)
    // Phase 07-06 — outletCode field on the DTO sources from customer_code;
    // seed each row with a distinct customer_code so the assertions below
    // can find them by that label.
    await ctx.db.insert(locations).values([
      {
        name: "NULL Outlet",
        customerCode: "NUL",
        primaryRegionId: regionId,
      },
      {
        name: "Classified Hotel",
        customerCode: "CLS",
        primaryRegionId: regionId,
        locationType: "hotel",
      },
      {
        name: "Archived Outlet",
        customerCode: "ARC",
        primaryRegionId: regionId,
        archivedAt: new Date("2025-01-01"),
      },
    ]);

    // Default — backwards-compatible behaviour: only the NULL-type row.
    const defaultRows = await _listUnclassifiedOutletsForActor(ctx.db);
    expect(defaultRows).toHaveLength(1);
    expect(defaultRows[0].outletCode).toBe("NUL");
    expect(defaultRows[0].reviewReason).toBe("missing_type");
    expect(defaultRows[0].currentType).toBeNull();

    // Explicit `false` matches the default.
    const explicitFalse = await _listUnclassifiedOutletsForActor(ctx.db, {
      includeClassified: false,
    });
    expect(explicitFalse).toHaveLength(1);

    // includeClassified=true → 2 rows (NULL + classified). Archived still
    // excluded because archivedAt IS NOT NULL.
    const expanded = await _listUnclassifiedOutletsForActor(ctx.db, {
      includeClassified: true,
    });
    expect(expanded).toHaveLength(2);
    const byCode = new Map(expanded.map((r) => [r.outletCode, r]));
    expect(byCode.has("ARC")).toBe(false);
    expect(byCode.get("NUL")?.reviewReason).toBe("missing_type");
    expect(byCode.get("NUL")?.currentType).toBeNull();
    expect(byCode.get("CLS")?.reviewReason).toBe("classified");
    expect(byCode.get("CLS")?.currentType).toBe("hotel");
  });

  test("includeClassified=true: a classified MONDAY-* row reports reviewReason='classified' (classification wins over Monday placeholder)", async () => {
    await ctx.db.insert(locations).values({
      name: "Reclassified Monday Hotel",

      primaryRegionId: regionId,
      locationType: "hotel",
      notes: "Imported from Monday (mondayItemId=abc789)",
    });

    const rows = await _listUnclassifiedOutletsForActor(ctx.db, {
      includeClassified: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].reviewReason).toBe("classified");
    expect(rows[0].currentType).toBe("hotel");
  });

  test("bulkSetLocationType with an empty array is a no-op (no writes)", async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: "Should Not Change",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });

    await _bulkSetLocationTypeForActor(ctx.db, ACTOR, [], "hotel");

    const [after] = await ctx.db
      .select({ locationType: locations.locationType })
      .from(locations)
      .where(eq(locations.id, loc.id));
    expect(after.locationType).toBeNull();

    const audits = await ctx.db.select().from(auditLogs);
    expect(audits).toHaveLength(0);
  });
});
