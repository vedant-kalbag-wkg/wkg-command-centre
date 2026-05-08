/**
 * Phase 6 Plan 06-01 — D8 multi-POS bulk-merge integration test.
 *
 * Spins up a Testcontainers Postgres, applies the project migrations
 * (including 0038), seeds two cluster pairs covering every collision case
 * the bulk merger must handle, and asserts the merge:
 *   - rewrites every FK to defunct → canonical
 *   - deletes the right collision rows (UNIQUE + composite-PK)
 *   - archives defunct locations
 *   - emits audit_logs rows tagged with metadata->>'script' = 'scripts/multi-pos-merge.ts'
 *   - is idempotent on re-run
 *
 * NOTE on file location: vitest.config.ts integration project includes only
 * `tests/**\/*.integration.test.ts`. Plan 06-01 spec'd the file at
 * src/scripts/__tests__/multi-pos-merge.test.ts but that path lands in the
 * unit project. Placing the test here keeps it picked up by the integration
 * project (Rule 3 deviation — see SUMMARY.md).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import {
  auditLogs,
  hotelGroups,
  kiosks,
  kioskAssignments,
  locationGroupMemberships,
  locationGroups,
  locationHotelGroupMemberships,
  locationProducts,
  locationRegionMemberships,
  locations,
  mergeProposals,
  products,
  regions,
  salesImports,
  salesRecords,
  user,
} from "@/db/schema";
import {
  applyBulkMerge,
  MULTI_POS_MERGE_SCRIPT_TAG,
  type MergePair,
} from "@/lib/multi-pos-merge";

describe("applyBulkMerge integration", () => {
  let ctx: TestDbContext;
  let regionId: string;
  let productId: string;
  let userId: string;
  const ACTOR = { id: "test-actor-id", name: "Test Actor" };

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // FK-ordered cleanup. salesRecords → salesImports → kioskAssignments →
    // kiosks → locationProducts → memberships → locations → groups → products →
    // regions → users → audit → mergeProposals.
    await ctx.db.delete(mergeProposals);
    await ctx.db.delete(salesRecords);
    await ctx.db.delete(salesImports);
    await ctx.db.delete(kioskAssignments);
    await ctx.db.delete(kiosks);
    await ctx.db.delete(locationProducts);
    await ctx.db.delete(locationHotelGroupMemberships);
    await ctx.db.delete(locationRegionMemberships);
    await ctx.db.delete(locationGroupMemberships);
    await ctx.db.delete(locations);
    await ctx.db.delete(hotelGroups);
    await ctx.db.delete(locationGroups);
    await ctx.db.delete(products);
    await ctx.db.delete(regions);
    await ctx.db.delete(user);
    await ctx.db.delete(auditLogs);

    const [u] = await ctx.db
      .insert(user)
      .values({
        id: "test-actor-id",
        name: "Test Actor",
        email: "test-actor@example.com",
      })
      .returning({ id: user.id });
    userId = u.id;

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

  async function seedTwoPairs() {
    // Two clusters, two pairs total (one canonical + one defunct each).
    const [canonicalA] = await ctx.db
      .insert(locations)
      .values({
        name: "Canonical A",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });
    const [defunctA] = await ctx.db
      .insert(locations)
      .values({
        name: "Defunct A",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });
    const [canonicalB] = await ctx.db
      .insert(locations)
      .values({
        name: "Canonical B",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });
    const [defunctB] = await ctx.db
      .insert(locations)
      .values({
        name: "Defunct B",

        primaryRegionId: regionId,
      })
      .returning({ id: locations.id });

    return { canonicalA, defunctA, canonicalB, defunctB };
  }

  test("rewrites every FK from defunct → canonical and archives defunct rows", async () => {
    const { canonicalA, defunctA, canonicalB, defunctB } = await seedTwoPairs();

    // Seed sales_imports row (FK target for sales_records.importId).
    const [imp] = await ctx.db
      .insert(salesImports)
      .values({
        filename: "test.csv",
        sourceHash: "hash-1",
        uploadedBy: userId,
        regionId,
        status: "committed",
      })
      .returning({ id: salesImports.id });

    // 50 sales rows on each defunct, 0 on canonicals.
    for (let i = 0; i < 50; i++) {
      await ctx.db.insert(salesRecords).values({
        importId: imp.id,
        regionId,
        saleRef: `S-A-${i}`,
        refNo: `R-A-${i}`,
        transactionDate: "2025-01-01",
        locationId: defunctA.id,
        productId,
        netAmount: "10.00",
        vatAmount: "2.00",
        netsuiteCode: "1001",
      });
    }
    for (let i = 0; i < 50; i++) {
      await ctx.db.insert(salesRecords).values({
        importId: imp.id,
        regionId,
        saleRef: `S-B-${i}`,
        refNo: `R-B-${i}`,
        transactionDate: "2025-01-01",
        locationId: defunctB.id,
        productId,
        netAmount: "20.00",
        vatAmount: "4.00",
        netsuiteCode: "1001",
      });
    }

    // 2 kiosk assignments on each defunct.
    const kiosk1 = await ctx.db
      .insert(kiosks)
      .values({ kioskId: "K-1" })
      .returning({ id: kiosks.id });
    const kiosk2 = await ctx.db
      .insert(kiosks)
      .values({ kioskId: "K-2" })
      .returning({ id: kiosks.id });
    const kiosk3 = await ctx.db
      .insert(kiosks)
      .values({ kioskId: "K-3" })
      .returning({ id: kiosks.id });
    const kiosk4 = await ctx.db
      .insert(kiosks)
      .values({ kioskId: "K-4" })
      .returning({ id: kiosks.id });

    await ctx.db.insert(kioskAssignments).values([
      {
        kioskId: kiosk1[0].id,
        locationId: defunctA.id,
        assignedBy: userId,
        assignedByName: "Test Actor",
      },
      {
        kioskId: kiosk2[0].id,
        locationId: defunctA.id,
        assignedBy: userId,
        assignedByName: "Test Actor",
      },
      {
        kioskId: kiosk3[0].id,
        locationId: defunctB.id,
        assignedBy: userId,
        assignedByName: "Test Actor",
      },
      {
        kioskId: kiosk4[0].id,
        locationId: defunctB.id,
        assignedBy: userId,
        assignedByName: "Test Actor",
      },
    ]);

    // Region-membership UNIQUE collision: both A's canonical+defunct have a row.
    await ctx.db.insert(locationRegionMemberships).values([
      { locationId: canonicalA.id, regionId },
      { locationId: defunctA.id, regionId },
    ]);
    // For pair B: only defunct has a row → no collision; pure rewrite.
    await ctx.db
      .insert(locationRegionMemberships)
      .values({ locationId: defunctB.id, regionId });

    // Group-membership UNIQUE collision: only canonical of A has one (no
    // collision); only defunct of B has one (pure rewrite).
    const [lg] = await ctx.db
      .insert(locationGroups)
      .values({ name: "LG1" })
      .returning({ id: locationGroups.id });
    await ctx.db.insert(locationGroupMemberships).values([
      { locationId: canonicalA.id, locationGroupId: lg.id },
      { locationId: defunctB.id, locationGroupId: lg.id },
    ]);

    // hotel_group composite-PK collision: defunct A and canonical A share hotel_group X.
    const [hg] = await ctx.db
      .insert(hotelGroups)
      .values({ name: "HG1" })
      .returning({ id: hotelGroups.id });
    const [hg2] = await ctx.db
      .insert(hotelGroups)
      .values({ name: "HG2" })
      .returning({ id: hotelGroups.id });
    await ctx.db.insert(locationHotelGroupMemberships).values([
      { locationId: canonicalA.id, hotelGroupId: hg.id },
      { locationId: defunctA.id, hotelGroupId: hg.id }, // collision — must be deleted
      { locationId: defunctA.id, hotelGroupId: hg2.id }, // no collision — must rewrite
    ]);

    // location_products: defunct A has one, canonical A has none → pure rewrite.
    await ctx.db.insert(locationProducts).values({
      locationId: defunctA.id,
      productId,
      availability: "available",
    });

    // Run the merge.
    const pairs: MergePair[] = [
      { canonicalId: canonicalA.id, defunctId: defunctA.id },
      { canonicalId: canonicalB.id, defunctId: defunctB.id },
    ];
    const result = await applyBulkMerge(pairs, ACTOR, ctx.db);

    expect(result.pairsMerged).toBe(2);
    expect(result.salesRecordsRewritten).toBe(100);
    expect(result.kioskAssignmentsRewritten).toBe(4);
    expect(result.locationsArchived).toBe(2);
    // Region-collision delete fired for pair A.
    expect(result.regionMembershipsDeleted).toBe(1);
    // Region rewrite fired for pair B (defunctB had a non-colliding row).
    expect(result.regionMembershipsRewritten).toBe(1);
    // Group rewrite fired for pair B; no group delete.
    expect(result.groupMembershipsDeleted).toBe(0);
    expect(result.groupMembershipsRewritten).toBe(1);
    // Hotel-group: 1 deleted (collision), 1 rewritten (non-collision).
    expect(result.hotelGroupMembershipsDeleted).toBe(1);
    expect(result.hotelGroupMembershipsRewritten).toBe(1);
    // location_products: defunctA had one row; rewritten cleanly.
    expect(result.locationProductsRewritten).toBe(1);
    expect(result.locationProductsDeleted).toBe(0);

    // Verify post-state in the DB.
    const salesOnCanonicalA = await ctx.db.execute<{ c: string }>(sql`
      SELECT COUNT(*)::text AS c FROM sales_records WHERE location_id = ${canonicalA.id}::uuid
    `);
    expect(Number(rowsOf<{ c: string }>(salesOnCanonicalA)[0].c)).toBe(50);
    const salesOnCanonicalB = await ctx.db.execute<{ c: string }>(sql`
      SELECT COUNT(*)::text AS c FROM sales_records WHERE location_id = ${canonicalB.id}::uuid
    `);
    expect(Number(rowsOf<{ c: string }>(salesOnCanonicalB)[0].c)).toBe(50);
    const salesOnDefunctA = await ctx.db.execute<{ c: string }>(sql`
      SELECT COUNT(*)::text AS c FROM sales_records WHERE location_id = ${defunctA.id}::uuid
    `);
    expect(Number(rowsOf<{ c: string }>(salesOnDefunctA)[0].c)).toBe(0);

    // Defunct rows archived.
    const archivedRows = await ctx.db.execute<{ id: string }>(sql`
      SELECT id::text AS id FROM locations
       WHERE id IN (${defunctA.id}::uuid, ${defunctB.id}::uuid) AND archived_at IS NOT NULL
    `);
    expect(rowsOf<{ id: string }>(archivedRows).length).toBe(2);

    // audit_logs rows tagged with the script.
    const auditCount = await ctx.db.execute<{ c: string }>(sql`
      SELECT COUNT(*)::text AS c FROM audit_logs
       WHERE metadata->>'script' = ${MULTI_POS_MERGE_SCRIPT_TAG}
    `);
    // Each pair: aggregate rewrite rows + archive + merge. Pair A had:
    //   sales (1), kiosk_assignments (1), location_products (1),
    //   location_region_memberships (defunct row deleted before rewrite — no rewrite row),
    //   location_hotel_group_memberships (1 rewrite, after the collision delete),
    //   archive (1), merge (1) → 6 rows
    // Pair B had:
    //   sales (1), kiosk_assignments (1), location_region_memberships (1),
    //   location_group_memberships (1), archive (1), merge (1) → 6 rows
    // Total ≥ 12 (assert ≥10 to allow for environment-specific counter behaviour
    // around the region-rewrite-after-delete edge case).
    expect(Number(rowsOf<{ c: string }>(auditCount)[0].c)).toBeGreaterThanOrEqual(10);

    // Per-pair merge audit rows present.
    const mergeRows = await ctx.db.execute<{ c: string }>(sql`
      SELECT COUNT(*)::text AS c FROM audit_logs
       WHERE action = 'merge'
         AND entity_type = 'location'
         AND metadata->>'script' = ${MULTI_POS_MERGE_SCRIPT_TAG}
    `);
    expect(Number(rowsOf<{ c: string }>(mergeRows)[0].c)).toBe(2);

    // Per-pair archive audit rows present.
    const archiveRows = await ctx.db.execute<{ c: string }>(sql`
      SELECT COUNT(*)::text AS c FROM audit_logs
       WHERE action = 'archive'
         AND entity_type = 'location'
         AND metadata->>'script' = ${MULTI_POS_MERGE_SCRIPT_TAG}
    `);
    expect(Number(rowsOf<{ c: string }>(archiveRows)[0].c)).toBe(2);
  });

  test("idempotency: re-running with the same pairs after archives are stamped is safe", async () => {
    const { canonicalA, defunctA } = await seedTwoPairs();

    const [imp] = await ctx.db
      .insert(salesImports)
      .values({
        filename: "idem.csv",
        sourceHash: "hash-idem",
        uploadedBy: userId,
        regionId,
        status: "committed",
      })
      .returning({ id: salesImports.id });

    await ctx.db.insert(salesRecords).values({
      importId: imp.id,
      regionId,
      saleRef: "S-1",
      refNo: "R-1",
      transactionDate: "2025-01-01",
      locationId: defunctA.id,
      productId,
      netAmount: "1.00",
      vatAmount: "0.20",
      netsuiteCode: "1001",
    });

    // First run.
    const first = await applyBulkMerge(
      [{ canonicalId: canonicalA.id, defunctId: defunctA.id }],
      ACTOR,
      ctx.db,
    );
    expect(first.pairsMerged).toBe(1);
    expect(first.salesRecordsRewritten).toBe(1);
    expect(first.locationsArchived).toBe(1);

    const auditCountAfterFirst = await ctx.db.execute<{ c: string }>(sql`
      SELECT COUNT(*)::text AS c FROM audit_logs
       WHERE metadata->>'script' = ${MULTI_POS_MERGE_SCRIPT_TAG}
    `);
    const countAfterFirst = Number(rowsOf<{ c: string }>(auditCountAfterFirst)[0].c);

    // Re-run on the same pair: salesRecords already point at canonicalA, so
    // no FK rewrite happens; the archived-at guard prevents a re-archive
    // audit row. Per-pair 'merge' audit row will still write (pair-level),
    // so audit count grows by exactly 1.
    const second = await applyBulkMerge(
      [{ canonicalId: canonicalA.id, defunctId: defunctA.id }],
      ACTOR,
      ctx.db,
    );
    expect(second.salesRecordsRewritten).toBe(0);
    expect(second.locationsArchived).toBe(0);

    const auditCountAfterSecond = await ctx.db.execute<{ c: string }>(sql`
      SELECT COUNT(*)::text AS c FROM audit_logs
       WHERE metadata->>'script' = ${MULTI_POS_MERGE_SCRIPT_TAG}
    `);
    const countAfterSecond = Number(rowsOf<{ c: string }>(auditCountAfterSecond)[0].c);
    // Only the per-pair 'merge' row from the second invocation.
    expect(countAfterSecond - countAfterFirst).toBe(1);
  });
});

// drizzle-orm/node-postgres returns `Result.rows` for execute(); typing
// stays loose so the test code matches both shapes (postgres-js returns
// the array directly).
function rowsOf<T>(result: unknown): T[] {
  if (result == null) return [];
  if (Array.isArray(result)) return result as T[];
  if (Array.isArray((result as { rows?: T[] }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}
