import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, teardownTestDb, type TestDbContext } from '../helpers/test-db';
import { user } from '@/db/schema';

describe('user.userType', () => {
  let ctx: TestDbContext;
  beforeAll(async () => { ctx = await setupTestDb(); }, 120_000);
  afterAll(async () => { if (ctx) await teardownTestDb(ctx); });

  it('defaults to internal when not specified', async () => {
    const [row] = await ctx.db.insert(user).values({
      id: 'u1', email: 'a@a.test', name: 'A', emailVerified: true,
    }).returning();
    expect(row.userType).toBe('internal');
  });

  it('accepts external as an explicit value', async () => {
    const [row] = await ctx.db.insert(user).values({
      id: 'u2', email: 'b@b.test', name: 'B', emailVerified: true,
      userType: 'external',
    }).returning();
    expect(row.userType).toBe('external');
  });

  it('rejects invalid userType values', async () => {
    await expect(
      ctx.db.insert(user).values({
        id: 'u3', email: 'c@c.test', name: 'C', emailVerified: true,
        userType: 'alien' as any,
      }),
    ).rejects.toThrow();
  });
});
