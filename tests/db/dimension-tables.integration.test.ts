import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, teardownTestDb, type TestDbContext } from '../helpers/test-db';
import {
  hotelGroups, regions, locationGroups,
  locations,
  locationHotelGroupMemberships, locationRegionMemberships, locationGroupMemberships,
} from '@/db/schema';

describe('analytics dimension tables', () => {
  let ctx: TestDbContext;
  let ukRegionId: string;
  beforeAll(async () => {
    ctx = await setupTestDb();
    // Migration 0018 seeds canonical regions (UK/IE/DE/ES/CZ); pick UK here.
    const [uk] = await ctx.db
      .select()
      .from(regions)
      .where(eq(regions.code, 'UK'));
    ukRegionId = uk.id;
  }, 120_000);
  afterAll(async () => { if (ctx) await teardownTestDb(ctx); });

  it('hotelGroups: insert + unique name + self-FK for nesting', async () => {
    const [parent] = await ctx.db.insert(hotelGroups).values({ name: 'Dalata Hotels' }).returning();
    const [child] = await ctx.db.insert(hotelGroups).values({ name: 'Maldron Brighton Group', parentGroupId: parent.id }).returning();
    expect(child.parentGroupId).toBe(parent.id);
    await expect(
      ctx.db.insert(hotelGroups).values({ name: 'Dalata Hotels' }),
    ).rejects.toThrow();
  });

  it('regions: insert + unique name', async () => {
    await ctx.db.insert(regions).values({ name: 'UK', code: 'GB' });
    await expect(
      ctx.db.insert(regions).values({ name: 'UK', code: 'GB2' }),
    ).rejects.toThrow();
  });

  it('locationGroups: insert + unique name', async () => {
    await ctx.db.insert(locationGroups).values({ name: 'City Centre Hotels' });
    await expect(
      ctx.db.insert(locationGroups).values({ name: 'City Centre Hotels' }),
    ).rejects.toThrow();
  });

  it('locationHotelGroupMemberships: links location to hotelGroup with cascade delete', async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: 'Test Hotel', outletCode: 'DIM-HG', primaryRegionId: ukRegionId })
      .returning();
    const [hg] = await ctx.db.insert(hotelGroups).values({ name: 'Test Group' }).returning();
    await ctx.db.insert(locationHotelGroupMemberships).values({ locationId: loc.id, hotelGroupId: hg.id });
    let rows = await ctx.db.select().from(locationHotelGroupMemberships).where(eq(locationHotelGroupMemberships.hotelGroupId, hg.id));
    expect(rows.length).toBe(1);
    await ctx.db.delete(hotelGroups).where(eq(hotelGroups.id, hg.id));
    rows = await ctx.db.select().from(locationHotelGroupMemberships).where(eq(locationHotelGroupMemberships.hotelGroupId, hg.id));
    expect(rows.length).toBe(0);
  });

  it('locationRegionMemberships: composite PK prevents duplicates', async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: 'Dup Test', outletCode: 'DIM-DUP', primaryRegionId: ukRegionId })
      .returning();
    const [reg] = await ctx.db.insert(regions).values({ name: 'SouthRegion', code: 'SOUTH' }).returning();
    await ctx.db.insert(locationRegionMemberships).values({ locationId: loc.id, regionId: reg.id });
    await expect(
      ctx.db.insert(locationRegionMemberships).values({ locationId: loc.id, regionId: reg.id }),
    ).rejects.toThrow();
  });

  // D5 PR-6 Part A — UNIQUE(location_id) layered on top of composite PK
  // ensures every location belongs to at most one region (migration 0029).
  it('locationRegionMemberships: UNIQUE(location_id) prevents two-region membership', async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: 'OneRegion Test', outletCode: 'DIM-ONE-REG', primaryRegionId: ukRegionId })
      .returning();
    const [other] = await ctx.db.insert(regions).values({ name: 'OtherRegion', code: 'OTHER' }).returning();
    await ctx.db.insert(locationRegionMemberships).values({ locationId: loc.id, regionId: ukRegionId });
    await expect(
      ctx.db.insert(locationRegionMemberships).values({ locationId: loc.id, regionId: other.id }),
    ).rejects.toThrow();
  });

  it('locationGroupMemberships: links + cascade', async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: 'Group Test', outletCode: 'DIM-GRP', primaryRegionId: ukRegionId })
      .returning();
    const [lg] = await ctx.db.insert(locationGroups).values({ name: 'Test LocGroup' }).returning();
    await ctx.db.insert(locationGroupMemberships).values({ locationId: loc.id, locationGroupId: lg.id });
    const rows = await ctx.db.select().from(locationGroupMemberships);
    expect(rows.find(r => r.locationId === loc.id && r.locationGroupId === lg.id)).toBeDefined();
  });

  // D5 PR-6 Part B — UNIQUE(location_id) layered on top of composite PK
  // ensures every location belongs to at most one location group
  // (migration 0030).
  it('locationGroupMemberships: UNIQUE(location_id) prevents two-group membership', async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: 'OneGroup Test', outletCode: 'DIM-ONE-LG', primaryRegionId: ukRegionId })
      .returning();
    const [lg1] = await ctx.db.insert(locationGroups).values({ name: 'OneGroup A' }).returning();
    const [lg2] = await ctx.db.insert(locationGroups).values({ name: 'OneGroup B' }).returning();
    await ctx.db.insert(locationGroupMemberships).values({ locationId: loc.id, locationGroupId: lg1.id });
    await expect(
      ctx.db.insert(locationGroupMemberships).values({ locationId: loc.id, locationGroupId: lg2.id }),
    ).rejects.toThrow();
  });

  // D5 PR-6 Part C — comma-encoded JV hotel_groups are split into proper N:N
  // memberships against the constituent standalone groups, and the JV row is
  // archived via the new `archived_at` column (migration 0031). Hotel groups
  // STAY N:N (legitimate JV cases exist) — there is intentionally no
  // UNIQUE(location_id) on location_hotel_group_memberships.
  it('hotelGroups: JV split preserves memberships to both constituents and archives the JV', async () => {
    const [marriott] = await ctx.db
      .insert(hotelGroups).values({ name: 'PartC Marriott' }).returning();
    const [splendid] = await ctx.db
      .insert(hotelGroups).values({ name: 'PartC Splendid' }).returning();
    const [jv] = await ctx.db
      .insert(hotelGroups).values({ name: 'PartC Marriott, PartC Splendid' }).returning();

    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: 'JV Test Hotel', outletCode: 'DIM-JV', primaryRegionId: ukRegionId })
      .returning();
    await ctx.db
      .insert(locationHotelGroupMemberships)
      .values({ locationId: loc.id, hotelGroupId: jv.id });

    // Simulate the script: add memberships to each constituent, drop the JV
    // membership, archive the JV row.
    for (const hgId of [marriott.id, splendid.id]) {
      await ctx.db
        .insert(locationHotelGroupMemberships)
        .values({ locationId: loc.id, hotelGroupId: hgId })
        .onConflictDoNothing();
    }
    await ctx.db
      .delete(locationHotelGroupMemberships)
      .where(eq(locationHotelGroupMemberships.hotelGroupId, jv.id));
    await ctx.db
      .update(hotelGroups)
      .set({ archivedAt: new Date() })
      .where(eq(hotelGroups.id, jv.id));

    // Location is now membered to BOTH constituents (N:N preserved).
    const memberships = await ctx.db
      .select()
      .from(locationHotelGroupMemberships)
      .where(eq(locationHotelGroupMemberships.locationId, loc.id));
    const hgIds = memberships.map((m) => m.hotelGroupId).sort();
    expect(hgIds).toEqual([marriott.id, splendid.id].sort());

    // JV row is archived.
    const [jvAfter] = await ctx.db
      .select()
      .from(hotelGroups)
      .where(eq(hotelGroups.id, jv.id));
    expect(jvAfter.archivedAt).not.toBeNull();
  });

  // D5 PR-6 Part C — explicit invariant: hotel groups are N:N. A location
  // CAN belong to two hotel groups simultaneously (this is the JV case the
  // split is preserving).
  it('hotelGroups: stay N:N — same location may belong to two groups', async () => {
    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: 'NN Test Hotel', outletCode: 'DIM-HG-NN', primaryRegionId: ukRegionId })
      .returning();
    const [a] = await ctx.db.insert(hotelGroups).values({ name: 'NN Group A' }).returning();
    const [b] = await ctx.db.insert(hotelGroups).values({ name: 'NN Group B' }).returning();
    await ctx.db.insert(locationHotelGroupMemberships).values({ locationId: loc.id, hotelGroupId: a.id });
    // This MUST succeed (no UNIQUE(location_id) on hotel-group memberships).
    await ctx.db.insert(locationHotelGroupMemberships).values({ locationId: loc.id, hotelGroupId: b.id });
    const rows = await ctx.db
      .select()
      .from(locationHotelGroupMemberships)
      .where(eq(locationHotelGroupMemberships.locationId, loc.id));
    expect(rows.length).toBe(2);
  });
});
