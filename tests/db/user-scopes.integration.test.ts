import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, teardownTestDb, type TestDbContext } from '../helpers/test-db';
import { user, userScopes } from '@/db/schema';

describe('userScopes', () => {
  let ctx: TestDbContext;
  beforeAll(async () => { ctx = await setupTestDb(); }, 120_000);
  afterAll(async () => { if (ctx) await teardownTestDb(ctx); });

  it('allows multiple scope rows per user (union semantics)', async () => {
    await ctx.db.insert(user).values({
      id: 'u1', email: 'a@a.test', name: 'A', emailVerified: true,
    });
    await ctx.db.insert(userScopes).values([
      { userId: 'u1', dimensionType: 'hotel_group', dimensionId: '42' },
      { userId: 'u1', dimensionType: 'region', dimensionId: '7' },
    ]);
    const rows = await ctx.db.select().from(userScopes).where(eq(userScopes.userId, 'u1'));
    expect(rows.length).toBe(2);
  });

  it('rejects invalid dimensionType values', async () => {
    await ctx.db.insert(user).values({
      id: 'u-invalid', email: 'inv@t.t', name: 'Inv', emailVerified: true,
    });
    await expect(
      ctx.db.insert(userScopes).values({
        userId: 'u-invalid', dimensionType: 'alien' as any, dimensionId: '1',
      }),
    ).rejects.toThrow();
  });

  it('enforces uniqueness on (userId, dimensionType, dimensionId)', async () => {
    await ctx.db.insert(user).values({
      id: 'u-uniq', email: 'uniq@t.t', name: 'Uniq', emailVerified: true,
    });
    await ctx.db.insert(userScopes).values({
      userId: 'u-uniq', dimensionType: 'provider', dimensionId: '9',
    });
    await expect(
      ctx.db.insert(userScopes).values({
        userId: 'u-uniq', dimensionType: 'provider', dimensionId: '9',
      }),
    ).rejects.toThrow();
  });

  it('cascades delete on user removal', async () => {
    await ctx.db.insert(user).values({
      id: 'u2', email: 'b@b.test', name: 'B', emailVerified: true,
    });
    await ctx.db.insert(userScopes).values({
      userId: 'u2', dimensionType: 'provider', dimensionId: '9',
    });
    await ctx.db.delete(user).where(eq(user.id, 'u2'));
    const leftover = await ctx.db.select().from(userScopes).where(eq(userScopes.userId, 'u2'));
    expect(leftover.length).toBe(0);
  });
});
