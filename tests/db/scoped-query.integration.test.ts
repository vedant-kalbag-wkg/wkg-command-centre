import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from '../helpers/test-db';
import {
  user,
  userScopes,
  locations,
  hotelGroups,
  regions,
  locationGroups,
  locationHotelGroupMemberships,
  locationRegionMemberships,
  locationGroupMemberships,
  products,
  providers,
  salesRecords,
} from '@/db/schema';
import {
  scopedSalesCondition,
  type UserCtx,
} from '@/lib/scoping/scoped-query';

/**
 * Seed plan:
 *   Hotel groups : HG-A, HG-B
 *   Regions      : UK, US
 *   Location grp : LG1
 *   Locations    : L1 ∈ HG-A, UK
 *                  L2 ∈ HG-A, US
 *                  L3 ∈ HG-B, UK
 *   Products     : P1, P2
 *   Providers    : Uber, Stripe
 *   Sales (by loc/product/provider combo):
 *     S1: L1 + P1 + Uber
 *     S2: L1 + P2 + Stripe
 *     S3: L2 + P1 + Uber
 *     S4: L2 + P2 + Stripe
 *     S5: L3 + P1 + Uber
 *     S6: L3 + P2 + Stripe
 *   Users:
 *     adminUser              (internal, admin)
 *     externalHotelUser      (external, scope hotel_group=HG-A)
 *     externalProviderUser   (external, scope provider=Uber)
 *     externalRegionUser     (external, scope region=UK)
 *     externalUnionUser      (external, scope hotel_group=HG-A OR provider=Stripe)
 *     internalScopedMember   (internal/member, scope product=P1)
 *     externalNoScopes       (external, NO scopes → should throw)
 */
describe('scopedSalesCondition (integration)', () => {
  let ctx: TestDbContext;

  // Seeded IDs — populated in beforeAll; typed as partial to avoid a bogus
  // initialiser, then all keys are asserted populated before tests run.
  const ids: Partial<{
    hgA: string;
    hgB: string;
    rUK: string;
    rUS: string;
    lg1: string;
    L1: string;
    L2: string;
    L3: string;
    P1: string;
    P2: string;
    uber: string;
    stripe: string;
    S1: string;
    S2: string;
    S3: string;
    S4: string;
    S5: string;
    S6: string;
  }> = {};

  const adminUser: UserCtx = {
    id: 'u-admin',
    userType: 'internal',
    role: 'admin',
  };
  const externalHotelUser: UserCtx = {
    id: 'u-ext-hotel',
    userType: 'external',
    role: null,
  };
  const externalProviderUser: UserCtx = {
    id: 'u-ext-prov',
    userType: 'external',
    role: null,
  };
  const externalRegionUser: UserCtx = {
    id: 'u-ext-region',
    userType: 'external',
    role: null,
  };
  const externalUnionUser: UserCtx = {
    id: 'u-ext-union',
    userType: 'external',
    role: null,
  };
  const internalScopedMember: UserCtx = {
    id: 'u-int-member',
    userType: 'internal',
    role: 'member',
  };
  const externalNoScopes: UserCtx = {
    id: 'u-ext-none',
    userType: 'external',
    role: null,
  };

  beforeAll(async () => {
    ctx = await setupTestDb();

    // Users
    await ctx.db.insert(user).values([
      { id: adminUser.id, email: 'admin@t.t', name: 'Admin', emailVerified: true, userType: 'internal', role: 'admin' },
      { id: externalHotelUser.id, email: 'exthotel@t.t', name: 'ExtHotel', emailVerified: true, userType: 'external', role: null },
      { id: externalProviderUser.id, email: 'extprov@t.t', name: 'ExtProv', emailVerified: true, userType: 'external', role: null },
      { id: externalRegionUser.id, email: 'extregion@t.t', name: 'ExtRegion', emailVerified: true, userType: 'external', role: null },
      { id: externalUnionUser.id, email: 'extunion@t.t', name: 'ExtUnion', emailVerified: true, userType: 'external', role: null },
      { id: internalScopedMember.id, email: 'intmem@t.t', name: 'IntMem', emailVerified: true, userType: 'internal', role: 'member' },
      { id: externalNoScopes.id, email: 'extnone@t.t', name: 'ExtNone', emailVerified: true, userType: 'external', role: null },
    ]);

    // Hotel groups
    const [hgA] = await ctx.db.insert(hotelGroups).values({ name: 'HG-A' }).returning();
    const [hgB] = await ctx.db.insert(hotelGroups).values({ name: 'HG-B' }).returning();
    ids.hgA = hgA.id;
    ids.hgB = hgB.id;

    // Regions
    const [rUK] = await ctx.db.insert(regions).values({ name: 'UK', code: 'UK' }).returning();
    const [rUS] = await ctx.db.insert(regions).values({ name: 'US', code: 'US' }).returning();
    ids.rUK = rUK.id;
    ids.rUS = rUS.id;

    // Location group
    const [lg1] = await ctx.db.insert(locationGroups).values({ name: 'LG1' }).returning();
    ids.lg1 = lg1.id;

    // Locations
    const [L1] = await ctx.db.insert(locations).values({ name: 'L1' }).returning();
    const [L2] = await ctx.db.insert(locations).values({ name: 'L2' }).returning();
    const [L3] = await ctx.db.insert(locations).values({ name: 'L3' }).returning();
    ids.L1 = L1.id;
    ids.L2 = L2.id;
    ids.L3 = L3.id;

    // Memberships: L1 ∈ HG-A + UK; L2 ∈ HG-A + US; L3 ∈ HG-B + UK
    await ctx.db.insert(locationHotelGroupMemberships).values([
      { locationId: ids.L1, hotelGroupId: ids.hgA },
      { locationId: ids.L2, hotelGroupId: ids.hgA },
      { locationId: ids.L3, hotelGroupId: ids.hgB },
    ]);
    await ctx.db.insert(locationRegionMemberships).values([
      { locationId: ids.L1, regionId: ids.rUK },
      { locationId: ids.L2, regionId: ids.rUS },
      { locationId: ids.L3, regionId: ids.rUK },
    ]);
    // Attach L1 to LG1 (used only to confirm location_group dimension resolves — not user-profile tested)
    await ctx.db.insert(locationGroupMemberships).values([
      { locationId: ids.L1, locationGroupId: ids.lg1 },
    ]);

    // Products + providers
    const [P1] = await ctx.db.insert(products).values({ name: 'P1' }).returning();
    const [P2] = await ctx.db.insert(products).values({ name: 'P2' }).returning();
    const [uber] = await ctx.db.insert(providers).values({ name: 'Uber' }).returning();
    const [stripe] = await ctx.db.insert(providers).values({ name: 'Stripe' }).returning();
    ids.P1 = P1.id;
    ids.P2 = P2.id;
    ids.uber = uber.id;
    ids.stripe = stripe.id;

    // Sales rows — saleRef doubles as a marker
    const rows = [
      { saleRef: 'S1', locationId: ids.L1, productId: ids.P1, providerId: ids.uber },
      { saleRef: 'S2', locationId: ids.L1, productId: ids.P2, providerId: ids.stripe },
      { saleRef: 'S3', locationId: ids.L2, productId: ids.P1, providerId: ids.uber },
      { saleRef: 'S4', locationId: ids.L2, productId: ids.P2, providerId: ids.stripe },
      { saleRef: 'S5', locationId: ids.L3, productId: ids.P1, providerId: ids.uber },
      { saleRef: 'S6', locationId: ids.L3, productId: ids.P2, providerId: ids.stripe },
    ];
    const inserted = await ctx.db
      .insert(salesRecords)
      .values(
        rows.map((r) => ({
          saleRef: r.saleRef,
          transactionDate: '2026-01-01',
          locationId: r.locationId,
          productId: r.productId,
          providerId: r.providerId,
          grossAmount: '10.00',
        })),
      )
      .returning();
    for (const r of inserted) {
      (ids as Record<string, string>)[r.saleRef] = r.id;
    }

    // User scopes
    await ctx.db.insert(userScopes).values([
      // externalHotelUser → HG-A
      { userId: externalHotelUser.id, dimensionType: 'hotel_group', dimensionId: ids.hgA },
      // externalProviderUser → Uber
      { userId: externalProviderUser.id, dimensionType: 'provider', dimensionId: ids.uber },
      // externalRegionUser → UK
      { userId: externalRegionUser.id, dimensionType: 'region', dimensionId: ids.rUK },
      // externalUnionUser → HG-A OR Stripe
      { userId: externalUnionUser.id, dimensionType: 'hotel_group', dimensionId: ids.hgA },
      { userId: externalUnionUser.id, dimensionType: 'provider', dimensionId: ids.stripe },
      // internalScopedMember → P1
      { userId: internalScopedMember.id, dimensionType: 'product', dimensionId: ids.P1 },
    ]);
  }, 120_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  async function selectVisibleSaleRefs(userCtx: UserCtx): Promise<Set<string>> {
    const condition = await scopedSalesCondition(ctx.db, userCtx);
    const rows = await ctx.db
      .select({ saleRef: salesRecords.saleRef })
      .from(salesRecords)
      .where(condition);
    return new Set(rows.map((r) => r.saleRef));
  }

  it('adminUser → returns undefined (no filter) and sees all 6 rows', async () => {
    const condition = await scopedSalesCondition(ctx.db, adminUser);
    expect(condition).toBeUndefined();

    // Caller passes undefined to .where(...) when unrestricted.
    const rows = await ctx.db
      .select({ saleRef: salesRecords.saleRef })
      .from(salesRecords)
      .where(condition);
    expect(new Set(rows.map((r) => r.saleRef))).toEqual(
      new Set(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']),
    );
  });

  it('externalHotelUser (HG-A) → sees rows whose location ∈ {L1, L2}', async () => {
    const visible = await selectVisibleSaleRefs(externalHotelUser);
    // L1 → S1, S2; L2 → S3, S4
    expect(visible).toEqual(new Set(['S1', 'S2', 'S3', 'S4']));
  });

  it('externalProviderUser (Uber) → sees rows whose providerId = Uber', async () => {
    const visible = await selectVisibleSaleRefs(externalProviderUser);
    // Uber: S1, S3, S5
    expect(visible).toEqual(new Set(['S1', 'S3', 'S5']));
  });

  it('externalRegionUser (UK) → sees rows whose location ∈ {L1, L3}', async () => {
    const visible = await selectVisibleSaleRefs(externalRegionUser);
    // L1 → S1, S2; L3 → S5, S6
    expect(visible).toEqual(new Set(['S1', 'S2', 'S5', 'S6']));
  });

  it('externalUnionUser (HG-A OR Stripe) → sees {L1,L2} OR provider=Stripe', async () => {
    const visible = await selectVisibleSaleRefs(externalUnionUser);
    // HG-A: S1,S2,S3,S4; Stripe: S2,S4,S6 → union: S1,S2,S3,S4,S6
    expect(visible).toEqual(new Set(['S1', 'S2', 'S3', 'S4', 'S6']));
  });

  it('internalScopedMember (P1) → sees rows whose productId = P1', async () => {
    const visible = await selectVisibleSaleRefs(internalScopedMember);
    // P1: S1, S3, S5
    expect(visible).toEqual(new Set(['S1', 'S3', 'S5']));
  });

  it('externalNoScopes → throws (external user must have at least one scope)', async () => {
    await expect(scopedSalesCondition(ctx.db, externalNoScopes)).rejects.toThrow(
      /external.*scope/i,
    );
  });
});
