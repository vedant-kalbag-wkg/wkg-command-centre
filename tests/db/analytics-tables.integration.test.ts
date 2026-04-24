import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, teardownTestDb, type TestDbContext } from '../helpers/test-db';
import {
  user,
  locations,
  regions,
  outletExclusions,
  analyticsPresets,
  analyticsSavedViews,
  eventCategories,
  businessEvents,
  weatherCache,
  eventLog,
} from '@/db/schema';

describe('remaining analytics tables (M1 Task 1.8)', () => {
  let ctx: TestDbContext;
  let userId: string;
  let locationId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
    const [u] = await ctx.db
      .insert(user)
      .values({ id: 'analytics-user-1', email: 'a@t.t', name: 'Analyst', emailVerified: true })
      .returning();
    userId = u.id;
    // Migration 0018 seeds canonical regions (UK/IE/DE/ES/CZ); pick UK here.
    const [uk] = await ctx.db
      .select()
      .from(regions)
      .where(eq(regions.code, 'UK'));
    const [loc] = await ctx.db
      .insert(locations)
      .values({
        name: 'Weather Test Hotel',
        outletCode: 'ANALYTICS-WEATHER',
        primaryRegionId: uk.id,
      })
      .returning();
    locationId = loc.id;
  }, 120_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  // ----- outletExclusions -----
  it('outletExclusions: insert + unique (outletCode, patternType)', async () => {
    await ctx.db
      .insert(outletExclusions)
      .values({ outletCode: 'EXCL-001', patternType: 'exact', label: 'test outlet', createdBy: userId });
    await expect(
      ctx.db.insert(outletExclusions).values({ outletCode: 'EXCL-001', patternType: 'exact' }),
    ).rejects.toThrow();
    // Same code with a different patternType is allowed
    await ctx.db
      .insert(outletExclusions)
      .values({ outletCode: 'EXCL-001', patternType: 'regex' });
  });

  it('outletExclusions: rejects invalid patternType', async () => {
    await expect(
      ctx.db
        .insert(outletExclusions)
        .values({ outletCode: 'EXCL-BAD', patternType: 'fuzzy' as unknown as 'exact' }),
    ).rejects.toThrow();
  });

  // ----- analyticsPresets -----
  it('analyticsPresets: insert + FK to user', async () => {
    const [p] = await ctx.db
      .insert(analyticsPresets)
      .values({
        name: 'Preset A',
        ownerId: userId,
        config: { dimension: 'revenue', filters: { region: ['UK'] } },
        isShared: false,
      })
      .returning();
    expect(p.ownerId).toBe(userId);
    expect(p.isShared).toBe(false);

    await expect(
      ctx.db.insert(analyticsPresets).values({
        name: 'Bad Preset',
        ownerId: 'non-existent-user',
        config: {},
      }),
    ).rejects.toThrow();
  });

  // ----- analyticsSavedViews -----
  it('analyticsSavedViews: insert + viewType enum validation', async () => {
    const [v] = await ctx.db
      .insert(analyticsSavedViews)
      .values({
        name: 'My Trend View',
        ownerId: userId,
        viewType: 'trend',
        config: { metric: 'revenue' },
      })
      .returning();
    expect(v.viewType).toBe('trend');

    await expect(
      ctx.db.insert(analyticsSavedViews).values({
        name: 'Bad View',
        ownerId: userId,
        viewType: 'bogus' as unknown as 'trend',
        config: {},
      }),
    ).rejects.toThrow();
  });

  it('analyticsSavedViews: cascade delete when user removed', async () => {
    const [u] = await ctx.db
      .insert(user)
      .values({ id: 'tmp-view-owner', email: 'v@t.t', name: 'VOwner', emailVerified: true })
      .returning();
    await ctx.db.insert(analyticsSavedViews).values({
      name: 'VTemp',
      ownerId: u.id,
      viewType: 'pivot',
      config: {},
    });
    await ctx.db.delete(user).where(eq(user.id, u.id));
    const rows = await ctx.db
      .select()
      .from(analyticsSavedViews)
      .where(eq(analyticsSavedViews.ownerId, u.id));
    expect(rows.length).toBe(0);
  });

  // ----- eventCategories -----
  it('eventCategories: insert + unique name', async () => {
    await ctx.db
      .insert(eventCategories)
      .values({ name: 'Promotion', color: '#00A6D3', isCore: true });
    await expect(
      ctx.db.insert(eventCategories).values({ name: 'Promotion' }),
    ).rejects.toThrow();
  });

  // ----- businessEvents -----
  it('businessEvents: FK to eventCategories + insert', async () => {
    const [cat] = await ctx.db
      .insert(eventCategories)
      .values({ name: 'Holiday' })
      .returning();
    const [ev] = await ctx.db
      .insert(businessEvents)
      .values({
        title: 'Christmas Day',
        description: 'Peak holiday',
        categoryId: cat.id,
        startDate: '2026-12-25',
        endDate: '2026-12-25',
        scopeType: 'global',
        createdBy: userId,
      })
      .returning();
    expect(ev.categoryId).toBe(cat.id);
    expect(ev.scopeType).toBe('global');

    await expect(
      ctx.db.insert(businessEvents).values({
        title: 'Bad Scope',
        categoryId: cat.id,
        startDate: '2026-12-25',
        scopeType: 'planet' as unknown as 'global',
      }),
    ).rejects.toThrow();
  });

  it('businessEvents: rejects bogus categoryId', async () => {
    await expect(
      ctx.db.insert(businessEvents).values({
        title: 'Orphan',
        categoryId: '00000000-0000-0000-0000-000000000000',
        startDate: '2026-01-01',
      }),
    ).rejects.toThrow();
  });

  // ----- weatherCache -----
  it('weatherCache: PK on cacheKey prevents duplicates', async () => {
    await ctx.db.insert(weatherCache).values({
      cacheKey: `loc:${locationId}:2026-01-15`,
      dateFrom: '2026-01-15',
      dateTo: '2026-01-15',
      data: { tempC: 8 },
      isForecast: false,
    });
    await expect(
      ctx.db.insert(weatherCache).values({
        cacheKey: `loc:${locationId}:2026-01-15`,
        dateFrom: '2026-01-15',
        dateTo: '2026-01-15',
        data: { tempC: 9 },
      }),
    ).rejects.toThrow();
  });

  // ----- eventLog -----
  it('eventLog: insert + FK to user (nullable)', async () => {
    const [row] = await ctx.db
      .insert(eventLog)
      .values({
        userId,
        actionType: 'viewed_portfolio',
        metadata: { page: '/dashboard' },
      })
      .returning();
    expect(row.actionType).toBe('viewed_portfolio');
    expect(row.userId).toBe(userId);

    // userId nullable: allow logging anonymous / system events
    const [anon] = await ctx.db
      .insert(eventLog)
      .values({ actionType: 'exported_csv', metadata: { format: 'csv' } })
      .returning();
    expect(anon.userId).toBeNull();

    await expect(
      ctx.db.insert(eventLog).values({
        userId: 'no-such-user',
        actionType: 'viewed_portfolio',
      }),
    ).rejects.toThrow();
  });
});
