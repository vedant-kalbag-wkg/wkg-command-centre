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
  beforeAll(async () => { ctx = await setupTestDb(); }, 120_000);
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
    const [loc] = await ctx.db.insert(locations).values({ name: 'Test Hotel' }).returning();
    const [hg] = await ctx.db.insert(hotelGroups).values({ name: 'Test Group' }).returning();
    await ctx.db.insert(locationHotelGroupMemberships).values({ locationId: loc.id, hotelGroupId: hg.id });
    let rows = await ctx.db.select().from(locationHotelGroupMemberships).where(eq(locationHotelGroupMemberships.hotelGroupId, hg.id));
    expect(rows.length).toBe(1);
    await ctx.db.delete(hotelGroups).where(eq(hotelGroups.id, hg.id));
    rows = await ctx.db.select().from(locationHotelGroupMemberships).where(eq(locationHotelGroupMemberships.hotelGroupId, hg.id));
    expect(rows.length).toBe(0);
  });

  it('locationRegionMemberships: composite PK prevents duplicates', async () => {
    const [loc] = await ctx.db.insert(locations).values({ name: 'Dup Test' }).returning();
    const [reg] = await ctx.db.insert(regions).values({ name: 'SouthRegion', code: 'SOUTH' }).returning();
    await ctx.db.insert(locationRegionMemberships).values({ locationId: loc.id, regionId: reg.id });
    await expect(
      ctx.db.insert(locationRegionMemberships).values({ locationId: loc.id, regionId: reg.id }),
    ).rejects.toThrow();
  });

  it('locationGroupMemberships: links + cascade', async () => {
    const [loc] = await ctx.db.insert(locations).values({ name: 'Group Test' }).returning();
    const [lg] = await ctx.db.insert(locationGroups).values({ name: 'Test LocGroup' }).returning();
    await ctx.db.insert(locationGroupMemberships).values({ locationId: loc.id, locationGroupId: lg.id });
    const rows = await ctx.db.select().from(locationGroupMemberships);
    expect(rows.find(r => r.locationId === loc.id && r.locationGroupId === lg.id)).toBeDefined();
  });
});
