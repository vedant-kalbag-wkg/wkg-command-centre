/**
 * Integration test for Phase 2 Tasks 2.1 + 2.2 — `total_rooms` aggregation.
 *
 * Both `getLocationGroupsList` (location-groups.ts:97) and the location-group
 * breakdown inside `getRegionDetail` (regions.ts:230) used to compute
 * `total_rooms` over a `sales_records → locations → memberships` JOIN. Each
 * location's `num_rooms` was therefore multiplied by its sales-row count
 * (regions.ts) or deduped by VALUE rather than by location id (location-
 * groups.ts via SUM(DISTINCT)). The visible symptom: Heathrow displayed
 * 1,790,000 rooms instead of ~3,000.
 *
 * The fix isolates the SUM in a scalar subquery that walks
 * `location_group_memberships → locations` exactly once per member, scoped to
 * the request's active-location set. These tests feed the queries fixtures
 * that would have triggered the historical bug shapes and assert the
 * post-fix outputs match the deployable-footprint definition (num_rooms
 * summed per active member, regardless of sales volume).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createMongoAbility } from "@casl/ability";
import type { AppAbility } from "@/lib/casl/types";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

// vi.hoisted survives mock hoisting — required because location-groups.ts
// captures `db` at module top level (`const dbAny = db as any`), so the mock
// factory must produce a value before that capture runs.
const dbHolder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/db", () => ({
  get db() {
    return dbHolder.db;
  },
}));

// Tests run as an "internal admin" user — short-circuit the scoping helper so
// we don't need to seed the userScopes table. The queries we test here own
// their own filter shape; the scope predicate is verified elsewhere.
vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

import {
  locations,
  locationGroups,
  locationGroupMemberships,
  locationRegionMemberships,
  outletExclusions,
  products,
  regions,
  salesRecords,
} from "@/db/schema";
import { getLocationGroupsList } from "@/lib/analytics/queries/location-groups";
import { getRegionDetail } from "@/lib/analytics/queries/regions";
import type { AnalyticsFilters } from "@/lib/analytics/types";
import type { UserCtx } from "@/lib/scoping/scoped-query";

const filters: AnalyticsFilters = {
  dateFrom: "2025-01-01",
  dateTo: "2025-12-31",
};

const userCtx: UserCtx = {
  id: "test-user",
  userType: "internal",
  role: "admin",
  ability: createMongoAbility([]) as AppAbility,
};

describe("num_rooms aggregation (Tasks 2.1 + 2.2)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbHolder.db = ctx.db;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Cleanup in FK-safe order.
    await ctx.db.delete(salesRecords);
    await ctx.db.delete(locationGroupMemberships);
    await ctx.db.delete(locationRegionMemberships);
    await ctx.db.delete(locationGroups);
    await ctx.db.delete(outletExclusions);
    await ctx.db.delete(locations);
    await ctx.db.delete(products);
    await ctx.db.delete(regions);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Task 2.1 — getLocationGroupsList
  // ─────────────────────────────────────────────────────────────────────────

  it("Task 2.1: sums num_rooms per active member (not SUM(DISTINCT) over sales JOIN)", async () => {
    // Three hotels in one group with rooms (100, 100, 200) — the historical
    // SUM(DISTINCT) would dedupe by VALUE → 300 (lost the second '100').
    // Each hotel has many sales rows so a bare SUM over the JOIN would also
    // explode. Correct answer: 100 + 100 + 200 = 400.
    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK" })
      .returning({ id: regions.id });

    const [product] = await ctx.db
      .insert(products)
      .values({ name: "Test Tour", netsuiteCode: "TT-1" })
      .returning({ id: products.id });

    const insertedLocations = await ctx.db
      .insert(locations)
      .values([
        { name: "H100a", primaryRegionId: region.id, numRooms: 100 },
        { name: "H100b", primaryRegionId: region.id, numRooms: 100 },
        { name: "H200", primaryRegionId: region.id, numRooms: 200 },
      ])
      .returning({ id: locations.id });

    const [group] = await ctx.db
      .insert(locationGroups)
      .values({ name: "Test Group" })
      .returning({ id: locationGroups.id });

    await ctx.db.insert(locationGroupMemberships).values(
      insertedLocations.map((l) => ({ locationId: l.id, locationGroupId: group.id })),
    );

    // Many sales rows per location to amplify any fan-out bug.
    const salesRows = insertedLocations.flatMap((loc, i) =>
      Array.from({ length: 5 }, (_, j) => ({
        regionId: region.id,
        saleRef: `SR-${i}-${j}`,
        refNo: `RN-${i}-${j}`,
        transactionDate: "2025-06-15",
        locationId: loc.id,
        productId: product.id,
        netAmount: "10.00",
        netAmountGbp: "10.00",
        vatAmount: "0.00",
        netsuiteCode: "TT-1",
      })),
    );
    await ctx.db.insert(salesRecords).values(salesRows);

    const result = await getLocationGroupsList(filters, userCtx);
    const ours = result.find((g) => g.id === group.id);

    expect(ours).toBeDefined();
    expect(ours!.totalRooms).toBe(400);
    // Sanity: hotel_count should be 3, not 15 (3 × 5 sales rows).
    expect(ours!.hotelCount).toBe(3);
  });

  it("Task 2.1: excludes archived hotels from the rooms sum", async () => {
    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK" })
      .returning({ id: regions.id });

    const [product] = await ctx.db
      .insert(products)
      .values({ name: "Test Tour", netsuiteCode: "TT-2" })
      .returning({ id: products.id });

    const [active, archived] = await ctx.db
      .insert(locations)
      .values([
        { name: "Active Hotel", primaryRegionId: region.id, numRooms: 100 },
        {
          name: "Archived Hotel",

          primaryRegionId: region.id,
          numRooms: 250,
          archivedAt: new Date(),
        },
      ])
      .returning({ id: locations.id });

    const [group] = await ctx.db
      .insert(locationGroups)
      .values({ name: "Mixed Group" })
      .returning({ id: locationGroups.id });

    await ctx.db.insert(locationGroupMemberships).values([
      { locationId: active.id, locationGroupId: group.id },
      { locationId: archived.id, locationGroupId: group.id },
    ]);

    // Only the active hotel has sales (archived ones won't show in the
    // sales-driven outer aggregate either way — but its rooms must still be
    // excluded from total_rooms via the archived_at filter in the subquery).
    await ctx.db.insert(salesRecords).values({
      regionId: region.id,
      saleRef: "SR-A",
      refNo: "RN-A",
      transactionDate: "2025-06-15",
      locationId: active.id,
      productId: product.id,
      netAmount: "10.00",
      netAmountGbp: "10.00",
      vatAmount: "0.00",
      netsuiteCode: "TT-2",
    });

    const result = await getLocationGroupsList(filters, userCtx);
    const ours = result.find((g) => g.id === group.id);

    expect(ours).toBeDefined();
    // Archived hotel's 250 rooms must NOT contribute. Active hotel: 100.
    expect(ours!.totalRooms).toBe(100);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Task 2.2 — getRegionDetail location-group breakdown
  // ─────────────────────────────────────────────────────────────────────────

  it("Task 2.2: region location-group breakdown shows per-group rooms with no fan-out", async () => {
    // Two location groups, each containing ONE hotel of 100 rooms. The
    // historical SUM(num_rooms) over the sales JOIN would multiply by the
    // location's sales-row count (here: 10). Correct answer: each group → 100.
    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK" })
      .returning({ id: regions.id });

    const [product] = await ctx.db
      .insert(products)
      .values({ name: "Test Tour", netsuiteCode: "TT-3" })
      .returning({ id: products.id });

    const [hotelA, hotelB] = await ctx.db
      .insert(locations)
      .values([
        { name: "Hotel A", primaryRegionId: region.id, numRooms: 100 },
        { name: "Hotel B", primaryRegionId: region.id, numRooms: 100 },
      ])
      .returning({ id: locations.id });

    await ctx.db.insert(locationRegionMemberships).values([
      { locationId: hotelA.id, regionId: region.id },
      { locationId: hotelB.id, regionId: region.id },
    ]);

    const [groupA, groupB] = await ctx.db
      .insert(locationGroups)
      .values([{ name: "Group A" }, { name: "Group B" }])
      .returning({ id: locationGroups.id, name: locationGroups.name });

    await ctx.db.insert(locationGroupMemberships).values([
      { locationId: hotelA.id, locationGroupId: groupA.id },
      { locationId: hotelB.id, locationGroupId: groupB.id },
    ]);

    // 10 sales per hotel — pre-fix this would have inflated rooms 10×.
    const salesRows = [hotelA, hotelB].flatMap((loc, i) =>
      Array.from({ length: 10 }, (_, j) => ({
        regionId: region.id,
        saleRef: `SR-${i}-${j}`,
        refNo: `RN-${i}-${j}`,
        transactionDate: "2025-06-15",
        locationId: loc.id,
        productId: product.id,
        netAmount: "10.00",
        netAmountGbp: "10.00",
        vatAmount: "0.00",
        netsuiteCode: "TT-3",
      })),
    );
    await ctx.db.insert(salesRecords).values(salesRows);

    const detail = await getRegionDetail([region.id], filters, userCtx);

    const breakdownByName = new Map(
      detail.locationGroupBreakdown.map((b) => [b.name, b.totalRooms]),
    );

    expect(breakdownByName.get(groupA.name)).toBe(100);
    expect(breakdownByName.get(groupB.name)).toBe(100);
  });

  it("Task 2.2: region location-group breakdown excludes archived hotels", async () => {
    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK" })
      .returning({ id: regions.id });

    const [product] = await ctx.db
      .insert(products)
      .values({ name: "Test Tour", netsuiteCode: "TT-4" })
      .returning({ id: products.id });

    const [active, archived] = await ctx.db
      .insert(locations)
      .values([
        { name: "Active", primaryRegionId: region.id, numRooms: 100 },
        {
          name: "Archived",

          primaryRegionId: region.id,
          numRooms: 999,
          archivedAt: new Date(),
        },
      ])
      .returning({ id: locations.id });

    await ctx.db.insert(locationRegionMemberships).values([
      { locationId: active.id, regionId: region.id },
      { locationId: archived.id, regionId: region.id },
    ]);

    const [group] = await ctx.db
      .insert(locationGroups)
      .values({ name: "Mixed Group" })
      .returning({ id: locationGroups.id, name: locationGroups.name });

    await ctx.db.insert(locationGroupMemberships).values([
      { locationId: active.id, locationGroupId: group.id },
      { locationId: archived.id, locationGroupId: group.id },
    ]);

    // Only active hotel has sales — needed to make the group appear in the
    // outer sales-driven aggregate at all.
    await ctx.db.insert(salesRecords).values({
      regionId: region.id,
      saleRef: "SR-A",
      refNo: "RN-A",
      transactionDate: "2025-06-15",
      locationId: active.id,
      productId: product.id,
      netAmount: "10.00",
      netAmountGbp: "10.00",
      vatAmount: "0.00",
      netsuiteCode: "TT-4",
    });

    const detail = await getRegionDetail([region.id], filters, userCtx);

    const ours = detail.locationGroupBreakdown.find((b) => b.name === group.name);
    expect(ours).toBeDefined();
    expect(ours!.totalRooms).toBe(100);
  });
});
