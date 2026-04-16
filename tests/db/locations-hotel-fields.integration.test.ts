import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, type TestDbContext } from '../helpers/test-db';
import { locations } from '@/db/schema';

describe('locations hotel dimension fields', () => {
  let ctx: TestDbContext;
  beforeAll(async () => { ctx = await setupTestDb(); }, 120_000);
  afterAll(async () => { if (ctx) await teardownTestDb(ctx); });

  it('stores hotel dimension fields and round-trips values', async () => {
    const [loc] = await ctx.db.insert(locations).values({
      name: 'Maldron Brighton',
      numRooms: 226,
      starRating: 4,
      hotelAddress: 'Cannon Place, Brighton, UK',
      liveDate: new Date('2025-12-15'),
      launchPhase: 'Phase 3',
      keyContactName: 'Gioutzin',
      keyContactEmail: 'gkiamili@maldronhotels.com',
      financeContact: 'accounts.brighton@maldronhotels.com',
      maintenanceFee: '41.67' as any, // numeric comes back as string
    }).returning();

    expect(loc.numRooms).toBe(226);
    expect(loc.starRating).toBe(4);
    expect(loc.hotelAddress).toBe('Cannon Place, Brighton, UK');
    expect(loc.launchPhase).toBe('Phase 3');
    expect(loc.keyContactEmail).toBe('gkiamili@maldronhotels.com');
    expect(String(loc.maintenanceFee)).toBe('41.67');
  });

  it('accepts null for all hotel dimension fields', async () => {
    const [loc] = await ctx.db.insert(locations).values({
      name: 'Bare Minimum Location',
    }).returning();
    expect(loc.numRooms).toBeNull();
    expect(loc.starRating).toBeNull();
    expect(loc.hotelAddress).toBeNull();
    expect(loc.launchPhase).toBeNull();
  });
});
