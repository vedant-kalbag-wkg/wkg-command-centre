// Phase 9.1 gap closure (WR-05) — commission processor's cumulative-base
// subquery must not hit Postgres's 65,535 bind-parameter ceiling on a
// heavy-month recalc. Pre-fix shape:
//
//   NOT IN (${sql.join(salesRecordIds.map(id => sql`${id}::uuid`), sql`, `)})
//
// emitted one bind per id; a 95k+ batch hit the ceiling and threw
// `bind message has 65535 parameters but 95000 were supplied`. Post-fix
// shape `NOT (x = ANY($1::uuid[]))` uses a single bind regardless of
// array length.
//
// This spec drives a 70,000-id batch through calculateCommissionsForRecords
// to confirm no PG bind-overflow error fires. Test runs <30s — the seed uses
// a single bulk INSERT via generate_series so testcontainers stays cheap.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

// Mock @/db so the processor's top-level `db` import points at our
// testcontainer-backed drizzle instance. Mirrors the pattern in
// processor.integration.test.ts.
const dbHolder: { db: unknown } = { db: null };

vi.mock("@/db", () => ({
  get db() {
    return dbHolder.db;
  },
}));

import {
  locationProducts,
  locations,
  products,
  regions,
  salesRecords,
} from "@/db/schema";
import { calculateCommissionsForRecords } from "@/lib/commission/processor";

describe("commission processor — WR-05 bind-param ceiling fix (integration)", () => {
  let ctx: TestDbContext;
  let regionId: string;
  let locationId: string;
  let productId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbHolder.db = ctx.db;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Clear per-test state. Order respects FK dependencies.
    await ctx.db.execute(sql`TRUNCATE TABLE sales_records CASCADE`);
    await ctx.db.delete(locationProducts);
    await ctx.db.delete(locations);
    await ctx.db.delete(products);
    await ctx.db.delete(regions);

    const [region] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK" })
      .returning({ id: regions.id });
    regionId = region.id;

    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: "Hotel A", primaryRegionId: regionId })
      .returning({ id: locations.id });
    locationId = loc.id;

    const [prod] = await ctx.db
      .insert(products)
      .values({ name: "London Eye", netsuiteCode: "LE-001" })
      .returning({ id: products.id });
    productId = prod.id;

    await ctx.db.insert(locationProducts).values({
      locationId,
      productId,
      availability: "available",
      commissionTiers: [
        {
          effectiveFrom: "2025-01-01",
          tiers: [{ minRevenue: 0, maxRevenue: null, rate: 0.1 }],
        },
      ],
    });
  });

  it("calculateCommissionsForRecords handles a 70,000-id batch without bind-param overflow (WR-05)", async () => {
    // Pre-fix: this throws `bind message has 65535 parameters but 70000
    // were supplied` because the cumulative-base subquery binds one
    // parameter per id via sql.join(salesRecordIds.map(...)).
    //
    // Post-fix: the cumulative-base subquery uses `= ANY($1::uuid[])` —
    // a single bind regardless of array length. The call must complete
    // without error.
    //
    // Fixture: 70k fee rows in a single batch import via bulk INSERT
    // ... SELECT FROM generate_series. Each row has the minimum columns
    // the processor's SELECT touches. Same (locationId, productId,
    // transactionDate-month) so all rows go through the same group →
    // single cumulative-base subquery call → bind-ceiling exposure
    // surfaces or doesn't.
    const N = 70_000;

    // Bulk-insert N rows at the same (locationId, productId, month) so
    // they cluster into a single processing group. saleRef and refNo
    // need uniqueness — derive from generate_series index.
    await ctx.db.execute(sql`
      INSERT INTO sales_records (
        region_id, sale_ref, ref_no, transaction_date, location_id,
        product_id, net_amount, net_amount_gbp, vat_amount, currency,
        is_weknow_fee, netsuite_code
      )
      SELECT
        ${regionId}::uuid,
        'WR05-' || gs::text,
        'REF-WR05-' || gs::text,
        '2025-08-15'::date,
        ${locationId}::uuid,
        ${productId}::uuid,
        '1.00'::numeric,
        '1.00'::numeric,
        '0.00'::numeric,
        'GBP',
        true,
        '9991'
      FROM generate_series(1, ${N}) AS gs
    `);

    // Fetch all ids — the processor's cumulative-base subquery will
    // receive this entire array as the NOT-IN exclusion list.
    const allIds = await ctx.db
      .select({ id: salesRecords.id })
      .from(salesRecords);
    expect(allIds.length).toBe(N);

    const ids = allIds.map((r) => r.id);

    // The assertion is "completes without throwing the PG bind-overflow
    // error". Post-fix this also calculates commissions for every row
    // (calculated === N), but the load-bearing assertion is no error.
    await expect(
      calculateCommissionsForRecords(ids),
    ).resolves.toMatchObject({ processed: N });
  }, 90_000); // bulk insert + commission calc takes ~10-30s on a fresh container
});
