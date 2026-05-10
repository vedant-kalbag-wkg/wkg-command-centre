// Phase 9.1 Plan 09.1-01 Task 3 — RED-stage integration test for the
// historical net_amount_gbp backfill. Drives FX-02 backfill correctness:
// idempotency (D-04 IS NULL filter), GBP identity shortcut (D-04), USD
// rate lookup stamping (D-05), and D-07 hard-fail when no rate within 7
// days. Wave 3 plan 09.1-05 ships scripts/backfill-net-amount-gbp.ts
// and turns these GREEN.
//
// Path note: this file lives under tests/sales/ to match the integration
// project glob (tests/**/*.integration.test.ts) — relocated from
// scripts/backfill-net-amount-gbp.test.ts during plan 09.1-05 Task 3
// execution per the Wave 0 RED-stage header's preferred option (a). Same
// routing fix applied in plan 09.1-04 for fx-rates-fetch-daily.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

import {
  exchangeRates,
  kioskAssignments,
  kiosks,
  locations,
  products,
  regions,
  salesImports,
  salesRecords,
  user,
} from "@/db/schema";
import { runBackfill } from "../../scripts/backfill-net-amount-gbp";

const ETL_ACTOR_ID = "00000000-0000-0000-0000-000000000001";

describe("backfill-net-amount-gbp integration (Wave 0 RED scaffolding)", () => {
  let ctx: TestDbContext;
  let regionId: string;
  let locationId: string;
  let productId: string;
  let importId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
    const [etl] = await ctx.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, ETL_ACTOR_ID));
    if (!etl) throw new Error("ETL actor seed missing — check migration 0018");
    // The backfill's contract is "rows that existed BEFORE 0048's NOT NULL
    // flip have net_amount_gbp = NULL → fill them in". Recreating that
    // pre-flip shape in a test means temporarily dropping the NOT NULL
    // constraint so seeds can leave net_amount_gbp NULL. This mirrors the
    // production sequence: 0047 added the column nullable → backfill
    // populated every row → 0048 flipped to NOT NULL.
    await ctx.db.execute(
      sql`ALTER TABLE sales_records ALTER COLUMN net_amount_gbp DROP NOT NULL`,
    );
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Order respects FK dependencies. TRUNCATE CASCADE on sales_records so
    // we don't have to chain through every dependent table.
    await ctx.db.execute(sql`TRUNCATE TABLE sales_records CASCADE`);
    await ctx.db.execute(sql`TRUNCATE TABLE exchange_rates`);
    await ctx.db.delete(salesImports);
    await ctx.db.delete(kioskAssignments);
    await ctx.db.delete(kiosks);
    await ctx.db.delete(products);
    await ctx.db.delete(locations);
    await ctx.db.delete(regions);

    const [r] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK", azureCode: "GB" })
      .returning({ id: regions.id });
    regionId = r.id;

    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: "Test Hotel", primaryRegionId: regionId })
      .returning({ id: locations.id });
    locationId = loc.id;

    const [kiosk] = await ctx.db
      .insert(kiosks)
      .values({ kioskId: "KSK-BF-1", outletCode: "BF" })
      .returning({ id: kiosks.id });
    await ctx.db.insert(kioskAssignments).values({
      kioskId: kiosk.id,
      locationId: loc.id,
      assignedBy: ETL_ACTOR_ID,
      assignedByName: "Backfill Test",
    });

    const [prod] = await ctx.db
      .insert(products)
      .values({ name: "Test Product", netsuiteCode: "9999" })
      .returning({ id: products.id });
    productId = prod.id;

    const [imp] = await ctx.db
      .insert(salesImports)
      .values({
        filename: "backfill-test.csv",
        sourceHash: `bf-test-${Date.now()}-${Math.random()}`,
        uploadedBy: ETL_ACTOR_ID,
        rowCount: 0,
        status: "committed" as const,
        regionId,
      })
      .returning({ id: salesImports.id });
    importId = imp.id;
  });

  it("D-04 idempotency: leaves net_amount_gbp = NULL count at 0 after backfill", async () => {
    // 50 GBP + 50 USD rows, all with net_amount_gbp IS NULL initially.
    await seedSalesRecords(50, "GBP", "2026-05-08", "100.00");
    await seedSalesRecords(50, "USD", "2026-05-08", "100.00");
    await seedExchangeRate("USD", "2026-05-08", "1.2500");

    await runBackfill({ dryRun: false, pool: ctx.pool });

    const nullCount = await ctx.db.execute(
      sql`SELECT COUNT(*)::int AS n FROM sales_records WHERE net_amount_gbp IS NULL`,
    );
    expect((nullCount.rows[0] as { n: number }).n).toBe(0);
  });

  it("D-04 GBP identity: net_amount_gbp = net_amount exactly for currency='GBP' (no rate lookup)", async () => {
    await seedSalesRecord("GBP", "2026-05-08", "100.00");
    await runBackfill({ dryRun: false, pool: ctx.pool });

    const rows = await ctx.db.select().from(salesRecords);
    expect(rows).toHaveLength(1);
    const eqCheck = await ctx.db.execute(
      sql`SELECT COUNT(*)::int AS n FROM sales_records
          WHERE currency = 'GBP' AND net_amount_gbp = net_amount`,
    );
    expect((eqCheck.rows[0] as { n: number }).n).toBe(1);
  });

  it("D-05 USD stamp: net_amount_gbp = net_amount / rate_to_gbp rounded to 2dp", async () => {
    // BoE: rate is foreign-per-GBP (1 GBP buys 1.25 USD).
    // 100 USD / 1.25 = 80 GBP.
    await seedSalesRecord("USD", "2026-05-08", "100.00");
    await seedExchangeRate("USD", "2026-05-08", "1.2500");

    await runBackfill({ dryRun: false, pool: ctx.pool });

    const rows = await ctx.db.select().from(salesRecords);
    expect(rows).toHaveLength(1);
    expect(rows[0].netAmountGbp).toBe("80.00");
  });

  it("D-04 idempotent re-run: backfill on already-stamped rows is a no-op", async () => {
    await seedSalesRecord("USD", "2026-05-08", "100.00");
    await seedExchangeRate("USD", "2026-05-08", "1.2500");

    const result1 = await runBackfill({ dryRun: false, pool: ctx.pool });
    expect(result1.updated).toBe(1);

    const result2 = await runBackfill({ dryRun: false, pool: ctx.pool });
    expect(result2.updated).toBe(0);
  });

  it("D-07 hard-fail: throws when a USD row's transaction_date has no rate within 7 days", async () => {
    // Row at 2026-04-01; rate at 2026-05-08 (37 days FORWARD) — carry-forward
    // can only look BACKWARD (rate_date <= transaction_date), so the lookup
    // returns null and the backfill must throw, not silently identity-stamp.
    await seedSalesRecord("USD", "2026-04-01", "100.00");
    await seedExchangeRate("USD", "2026-05-08", "1.2500");

    await expect(
      runBackfill({ dryRun: false, pool: ctx.pool }),
    ).rejects.toThrow(/USD|stale|no rate|no FX rate/i);

    const rows = await ctx.db
      .select()
      .from(salesRecords)
      .where(eq(salesRecords.currency, "USD"));
    expect(rows[0].netAmountGbp).toBeNull();
  });

  // ─── Phase 9.1 gap closure (CR-05) — same-date cursor advancement ─────────
  //
  // Pre-fix: the cursor query cast `id::text` in the WHERE tuple comparison
  // AND in the ORDER BY. UUIDs ordered lexicographically are NOT identical
  // to UUIDs ordered as native uuid (the byte-comparison forms can disagree
  // for some UUID variants). Combined with chunkSize=1, a same-date cursor
  // boundary could revisit or skip rows depending on which of (text-sort,
  // uuid-sort) the ORDER BY committed to vs. what the WHERE tuple carried
  // into the next chunk.
  //
  // Post-fix: WHERE compares on the uuid column directly with `$2::uuid`
  // bind, ORDER BY orders on the uuid column directly. The SELECT projection
  // still casts `id::text` for JS-side type ergonomics, but that cast is
  // wire-format only and does not affect plan/skip behaviour.
  //
  // This spec drives the contract: chunkSize=1 forces the cursor to advance
  // through each row individually via the WHERE tuple comparison, and both
  // seeded rows must end up with non-NULL net_amount_gbp.
  it("CR-05: cursor advances correctly across a same-date boundary regardless of uuid-vs-text sort order", async () => {
    // Two UUIDs sharing the same transaction_date. Picking values whose
    // canonical uuid order is well-defined ('1ab...' < 'a000...' both as
    // text and as uuid byte-comparison, so the test ALSO works under the
    // pre-fix lexical ORDER BY) — what's load-bearing is the chunkSize=1
    // round-trip: every cursor advance goes through the WHERE tuple
    // comparison, which under the pre-fix shape forced a seq-scan and
    // could skip rows on some uuid byte-patterns. Post-fix: uuid-typed
    // bind, planner uses the (transaction_date, id) PK index path, both
    // rows land with non-NULL net_amount_gbp.
    const id1 = "1ab00000-0000-0000-0000-000000000000";
    const id2 = "a0000000-0000-0000-0000-000000000000";
    const txnDate = "2026-05-08";
    await seedSalesRecordWithId(id1, "GBP", txnDate, "100.00");
    await seedSalesRecordWithId(id2, "GBP", txnDate, "200.00");

    const result = await runBackfill({
      dryRun: false,
      pool: ctx.pool,
      batchSize: 1,
    });
    expect(result.updated).toBe(2);

    // Both rows must show non-NULL GBP after the run.
    const stamped = await ctx.db.execute(
      sql`SELECT id::text AS id, net_amount_gbp::text AS gbp
          FROM sales_records WHERE id IN (${id1}::uuid, ${id2}::uuid)
          ORDER BY id`,
    );
    expect(stamped.rows).toHaveLength(2);
    for (const r of stamped.rows as Array<{ id: string; gbp: string | null }>) {
      expect(r.gbp).not.toBeNull();
    }
  });

  // ──────────────────────────────────────────────────────────────────────
  // Helpers — minimal seed utilities.
  // ──────────────────────────────────────────────────────────────────────

  async function seedSalesRecord(
    currency: string,
    txnDate: string,
    netAmount: string,
  ): Promise<void> {
    await ctx.db.insert(salesRecords).values({
      regionId,
      saleRef: `SR-${currency}-${txnDate}-${Math.random().toString(36).slice(2, 10)}`,
      refNo: `REF-${currency}-${Math.random().toString(36).slice(2, 10)}`,
      transactionDate: txnDate,
      locationId,
      productId,
      netAmount,
      vatAmount: "0.00",
      currency,
      isWeknowFee: false,
      netsuiteCode: "9999",
      importId,
    });
  }

  // CR-05 helper: insert with an explicit id so the spec can pin uuid values
  // whose text-collation order is well-defined relative to natural uuid sort.
  async function seedSalesRecordWithId(
    id: string,
    currency: string,
    txnDate: string,
    netAmount: string,
  ): Promise<void> {
    await ctx.db.insert(salesRecords).values({
      id,
      regionId,
      saleRef: `SR-${id.slice(0, 8)}`,
      refNo: `REF-${id.slice(0, 8)}`,
      transactionDate: txnDate,
      locationId,
      productId,
      netAmount,
      vatAmount: "0.00",
      currency,
      isWeknowFee: false,
      netsuiteCode: "9999",
      importId,
    });
  }

  async function seedSalesRecords(
    count: number,
    currency: string,
    txnDate: string,
    netAmount: string,
  ): Promise<void> {
    for (let i = 0; i < count; i++) {
      await seedSalesRecord(currency, txnDate, netAmount);
    }
  }

  async function seedExchangeRate(
    currency: string,
    rateDate: string,
    rateToGbp: string,
  ): Promise<void> {
    await ctx.db.insert(exchangeRates).values({
      currency,
      rateDate,
      rateToGbp,
    });
  }
});
