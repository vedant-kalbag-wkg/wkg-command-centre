import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { setupTestDb, teardownTestDb, type TestDbContext } from '../helpers/test-db';
import { user, locations, products, providers, salesRecords, salesImports, importStagings } from '@/db/schema';

describe('sales tables', () => {
  let ctx: TestDbContext;
  let locationId: string;
  let productId: string;
  let providerId: string;
  let userId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
    const [u] = await ctx.db.insert(user).values({ id: 'importer-1', email: 'imp@t.t', name: 'Imp', emailVerified: true }).returning();
    userId = u.id;
    const [loc] = await ctx.db.insert(locations).values({ name: 'Test Hotel' }).returning();
    locationId = loc.id;
    const [prod] = await ctx.db.insert(products).values({ name: 'Uber API' }).returning();
    productId = prod.id;
    const [prov] = await ctx.db.insert(providers).values({ name: 'Uber' }).returning();
    providerId = prov.id;
  }, 120_000);
  afterAll(async () => { if (ctx) await teardownTestDb(ctx); });

  it('inserts and round-trips a salesRecord', async () => {
    const [row] = await ctx.db.insert(salesRecords).values({
      saleRef: 'SR-0001',
      refNo: '7JA4543371',
      transactionDate: '2025-12-21',
      transactionTime: '13:35:16',
      locationId, productId, providerId,
      quantity: 1,
      grossAmount: '5.97',
      netAmount: '5.97',
      bookingFee: '1.07',
      saleCommission: '2.09',
      currency: 'GBP',
      customerCode: '2752',
    }).returning();
    expect(row.saleRef).toBe('SR-0001');
    expect(String(row.grossAmount)).toBe('5.97');
  });

  it('rejects salesRecord with bogus locationId', async () => {
    await expect(
      ctx.db.insert(salesRecords).values({
        saleRef: 'SR-BAD-LOC', transactionDate: '2025-12-21',
        locationId: '00000000-0000-0000-0000-000000000000',
        productId, grossAmount: '1.00',
      }),
    ).rejects.toThrow();
  });

  it('rejects salesRecord with bogus productId', async () => {
    await expect(
      ctx.db.insert(salesRecords).values({
        saleRef: 'SR-BAD-PROD', transactionDate: '2025-12-21',
        locationId,
        productId: '00000000-0000-0000-0000-000000000000',
        grossAmount: '1.00',
      }),
    ).rejects.toThrow();
  });

  it('enforces unique (saleRef, transactionDate)', async () => {
    await ctx.db.insert(salesRecords).values({
      saleRef: 'SR-DUP', transactionDate: '2025-12-22',
      locationId, productId, grossAmount: '2.00',
    });
    await expect(
      ctx.db.insert(salesRecords).values({
        saleRef: 'SR-DUP', transactionDate: '2025-12-22',
        locationId, productId, grossAmount: '3.00',
      }),
    ).rejects.toThrow();
  });

  it('salesImports: accepts valid status, rejects invalid', async () => {
    const [imp] = await ctx.db.insert(salesImports).values({
      filename: 'jan.csv', sourceHash: 'abc123', uploadedBy: userId, status: 'staging',
    }).returning();
    expect(imp.status).toBe('staging');
    await expect(
      ctx.db.insert(salesImports).values({
        filename: 'bad.csv', sourceHash: 'xyz', uploadedBy: userId, status: 'weird' as any,
      }),
    ).rejects.toThrow();
  });

  it('importStagings cascades delete when salesImports row removed', async () => {
    const [imp] = await ctx.db.insert(salesImports).values({
      filename: 'feb.csv', sourceHash: 'def456', uploadedBy: userId,
    }).returning();
    await ctx.db.insert(importStagings).values({
      importId: imp.id, rowNumber: 1, rawRow: { col: 'val' }, status: 'pending',
    });
    let rows = await ctx.db.select().from(importStagings).where(eq(importStagings.importId, imp.id));
    expect(rows.length).toBe(1);
    await ctx.db.delete(salesImports).where(eq(salesImports.id, imp.id));
    rows = await ctx.db.select().from(importStagings).where(eq(importStagings.importId, imp.id));
    expect(rows.length).toBe(0);
  });
});
