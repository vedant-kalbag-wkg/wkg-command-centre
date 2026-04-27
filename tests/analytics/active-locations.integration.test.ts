import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

const dbHolder: { db: unknown } = { db: null };

vi.mock("@/db", () => ({
  get db() {
    return dbHolder.db;
  },
}));

import { locations, outletExclusions, regions } from "@/db/schema";
import { getActiveLocationIds } from "@/lib/analytics/active-locations";

describe("getActiveLocationIds (integration)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbHolder.db = ctx.db;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    await ctx.db.delete(outletExclusions);
    await ctx.db.delete(locations);
    await ctx.db.delete(regions);
  });

  it("returns only active, non-excluded locations (excludes archived and outlet-excluded)", async () => {
    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK" })
      .returning({ id: regions.id });

    const [active] = await ctx.db
      .insert(locations)
      .values({
        name: "Hotel Active",
        outletCode: "ACT-1",
        primaryRegionId: region.id,
      })
      .returning({ id: locations.id });

    await ctx.db.insert(locations).values({
      name: "Hotel Archived",
      outletCode: "ARC-1",
      primaryRegionId: region.id,
      archivedAt: new Date(),
    });

    await ctx.db.insert(locations).values({
      name: "Hotel Excluded",
      outletCode: "EXC-1",
      primaryRegionId: region.id,
    });

    await ctx.db.insert(outletExclusions).values({
      outletCode: "EXC-1",
      patternType: "exact",
      regionId: region.id,
      label: "test",
    });

    const ids = await getActiveLocationIds();

    expect(ids).toEqual([active.id]);
  });

  it("region-scopes exclusions — UK exclusion of 'TEST' does not exclude AU 'TEST' (Task 1.9)", async () => {
    // Two regions, two locations sharing the same outlet_code 'TEST', plus
    // an exclusion that targets 'TEST' in UK only. The AU location must
    // remain active; only the UK one should be excluded.
    const [uk, au] = await ctx.db
      .insert(regions)
      .values([
        { name: "United Kingdom", code: "UK" },
        { name: "Australia", code: "AU" },
      ])
      .returning({ id: regions.id });

    await ctx.db.insert(locations).values({
      name: "UK TEST Hotel",
      outletCode: "TEST",
      primaryRegionId: uk.id,
    });

    const [auActive] = await ctx.db
      .insert(locations)
      .values({
        name: "AU TEST Hotel",
        outletCode: "TEST",
        primaryRegionId: au.id,
      })
      .returning({ id: locations.id });

    await ctx.db.insert(outletExclusions).values({
      outletCode: "TEST",
      patternType: "exact",
      regionId: uk.id,
      label: "UK only",
    });

    const ids = await getActiveLocationIds();

    expect(ids).toEqual([auActive.id]);
  });
});
