import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

const dbHolder: { db: unknown } = { db: null };

vi.mock("@/db", () => ({
  get db() {
    return dbHolder.db;
  },
}));

import {
  kioskAssignments,
  kiosks,
  locations,
  outletExclusions,
  regions,
} from "@/db/schema";
import { getActiveLocationIds } from "@/lib/analytics/active-locations";

/**
 * Phase 07-06 — outlet codes live on `kiosks`, not on `locations`. An
 * outlet exclusion now reads as: a location is excluded iff at least one
 * of its CURRENT (active) kiosks has an outlet_code matching an exclusion
 * in the location's primary region. These tests seed kiosk-attached
 * locations and an exclusion targeting the kiosk's code.
 */
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
    await ctx.db.delete(kioskAssignments);
    await ctx.db.delete(kiosks);
    await ctx.db.delete(outletExclusions);
    await ctx.db.delete(locations);
    await ctx.db.delete(regions);
  });

  /** Seed a location with one active kiosk attached to it. */
  async function seedKioskAttached(opts: {
    name: string;
    regionId: string;
    outletCode: string;
    archived?: boolean;
  }): Promise<string> {
    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: opts.name,
        primaryRegionId: opts.regionId,
        archivedAt: opts.archived ? new Date() : null,
      })
      .returning({ id: locations.id });
    const [kiosk] = await ctx.db
      .insert(kiosks)
      .values({
        kioskId: `KSK-${opts.name}-${opts.outletCode}`,
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

  it("returns only active, non-excluded locations (excludes archived and kiosk-outlet-excluded)", async () => {
    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK" })
      .returning({ id: regions.id });

    const activeId = await seedKioskAttached({
      name: "Hotel Active",
      regionId: region.id,
      outletCode: "ACT-1",
    });

    await seedKioskAttached({
      name: "Hotel Archived",
      regionId: region.id,
      outletCode: "ARC-1",
      archived: true,
    });

    await seedKioskAttached({
      name: "Hotel Excluded",
      regionId: region.id,
      outletCode: "EXC-1",
    });

    await ctx.db.insert(outletExclusions).values({
      outletCode: "EXC-1",
      patternType: "exact",
      regionId: region.id,
      label: "test",
    });

    const ids = await getActiveLocationIds();
    expect(ids).toEqual([activeId]);
  });

  it("region-scopes exclusions — UK exclusion of 'TEST' does not exclude AU 'TEST' (Task 1.9)", async () => {
    // Two regions, two locations each with a kiosk whose outlet_code is
    // 'TEST', plus an exclusion that targets 'TEST' in UK only. The AU
    // location must remain active; only the UK one should be excluded.
    const [uk, au] = await ctx.db
      .insert(regions)
      .values([
        { name: "United Kingdom", code: "UK" },
        { name: "Australia", code: "AU" },
      ])
      .returning({ id: regions.id });

    await seedKioskAttached({
      name: "UK TEST Hotel",
      regionId: uk.id,
      outletCode: "TEST",
    });

    const auActiveId = await seedKioskAttached({
      name: "AU TEST Hotel",
      regionId: au.id,
      outletCode: "TEST",
    });

    await ctx.db.insert(outletExclusions).values({
      outletCode: "TEST",
      patternType: "exact",
      regionId: uk.id,
      label: "UK only",
    });

    const ids = await getActiveLocationIds();
    expect(ids).toEqual([auActiveId]);
  });

  it("locations with no kiosk assignments are NOT excluded by an outlet exclusion", async () => {
    // A location without any kiosk assignment cannot be matched by an outlet
    // exclusion (the exclusion subquery joins through kiosk_assignments and
    // finds nothing). It stays active.
    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK" })
      .returning({ id: regions.id });

    const [bareLoc] = await ctx.db
      .insert(locations)
      .values({ name: "Hotel No Kiosks", primaryRegionId: region.id })
      .returning({ id: locations.id });

    await ctx.db.insert(outletExclusions).values({
      outletCode: "ANYTHING",
      patternType: "exact",
      regionId: region.id,
      label: "should not match",
    });

    const ids = await getActiveLocationIds();
    expect(ids).toContain(bareLoc.id);
  });
});
