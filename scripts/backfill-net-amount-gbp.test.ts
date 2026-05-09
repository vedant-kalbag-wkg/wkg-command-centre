// Phase 9.1 Plan 09.1-01 Task 3 — RED-stage integration test for the
// historical net_amount_gbp backfill. Drives FX-02 backfill correctness:
// idempotency (D-04 IS NULL filter), GBP identity shortcut (D-04), USD
// rate * net_amount stamping (D-05), and D-07 hard-fail when no rate
// within 7 days. Wave 3 plan 09.1-05 ships
// `scripts/backfill-net-amount-gbp.ts` and turns these GREEN.
//
// Analog: tests/etl/azure-etl.integration.test.ts — same setupTestDb +
// real Postgres + mocked dependencies pattern. Backfill is a one-shot
// script, not a long-running cron, but the test shape is identical to the
// ETL integration suite.
//
// Vitest project routing (Wave 3 follow-up): `vitest.config.ts` integration
// project includes `tests/**/*.integration.test.ts`. This file's path
// (`scripts/backfill-net-amount-gbp.test.ts`) was specified by
// `09.1-01-PLAN.md` Task 3 `<files>`. Wave 3 plan 09.1-05 must EITHER:
//   (a) move this file to `tests/sales/backfill-net-amount-gbp.integration.test.ts`
//       (preferred — matches existing glob), OR
//   (b) extend `vitest.config.ts` integration include to cover
//       `scripts/**/*.test.ts`.
// RED state today via `npx vitest run --project unit
// scripts/backfill-net-amount-gbp.test.ts` because the failing import
// (`./backfill-net-amount-gbp` does not exist) surfaces before any
// project-specific setup.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../tests/helpers/test-db";

// `salesRecords` exists today; `exchangeRates` is added in Wave 1 plan
// 09.1-02 migration 0046+. The `net_amount_gbp` column on `salesRecords`
// is added in Wave 1 plan 09.1-02 migration 0047. Both imports/columns
// are part of the layered RED gate.
import { exchangeRates, salesRecords } from "@/db/schema";

// SUT — Wave 3 plan 09.1-05 creates this script as a CLI:
//   `npx tsx --env-file=.env.neon-dev scripts/backfill-net-amount-gbp.ts [--dry-run]`
// It must export a testable `runBackfill({ dryRun?, batchSize? })` core
// function that the test below drives directly (mirrors
// scripts/backfill-reversals.ts's `main()`-with-extracted-core pattern).
import { runBackfill } from "./backfill-net-amount-gbp";

describe("backfill-net-amount-gbp integration (Wave 0 RED scaffolding)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Clear sales_records + exchange_rates between tests for deterministic
    // assertions. Wave 1 migration adds net_amount_gbp as nullable.
    await ctx.db.execute(sql`TRUNCATE TABLE sales_records CASCADE`);
    await ctx.db.execute(sql`TRUNCATE TABLE exchange_rates`);
  });

  it("D-04 idempotency: leaves net_amount_gbp = NULL count at 0 after backfill", async () => {
    // Seed a small mixed-currency set: 50 GBP + 50 USD rows. The GBP
    // rows take the identity path; the USD rows take the rate-lookup
    // path. After backfill, every row is stamped — none stay NULL.
    await seedSalesRecords(ctx, 50, "GBP", "2026-05-08");
    await seedSalesRecords(ctx, 50, "USD", "2026-05-08");
    await seedExchangeRate(ctx, "USD", "2026-05-08", "1.2500");

    await runBackfill({ dryRun: false });

    const nullCount = await ctx.db.execute(
      sql`SELECT COUNT(*)::int AS n FROM sales_records WHERE net_amount_gbp IS NULL`,
    );
    expect((nullCount.rows[0] as { n: number }).n).toBe(0);
  });

  it("D-04 GBP identity: net_amount_gbp = net_amount exactly for currency='GBP' (no rate lookup)", async () => {
    await seedSalesRecord(ctx, "GBP", "2026-05-08", "100.00");
    await runBackfill({ dryRun: false });

    const rows = await ctx.db.select().from(salesRecords);
    expect(rows).toHaveLength(1);
    // Numeric equality via SQL comparison to avoid precision drift.
    const eqCheck = await ctx.db.execute(
      sql`SELECT COUNT(*)::int AS n FROM sales_records WHERE currency = 'GBP' AND net_amount_gbp = net_amount`,
    );
    expect((eqCheck.rows[0] as { n: number }).n).toBe(1);
  });

  it("D-05 USD stamp: net_amount_gbp = net_amount * (1/rate_to_gbp) rounded to 2 decimal places", async () => {
    // BoE quote shape: rate is foreign-per-GBP (e.g. USD: 1.25 means
    // 1 GBP buys 1.25 USD). To convert a USD net_amount to GBP, divide
    // by the BoE quote → 100 USD / 1.25 = 80 GBP.
    await seedSalesRecord(ctx, "USD", "2026-05-08", "100.00");
    await seedExchangeRate(ctx, "USD", "2026-05-08", "1.2500");

    await runBackfill({ dryRun: false });

    const rows = await ctx.db.select().from(salesRecords);
    expect(rows).toHaveLength(1);
    expect(rows[0].netAmountGbp).toBe("80.00");
  });

  it("D-04 idempotent re-run: backfill on already-stamped rows is a no-op (WHERE net_amount_gbp IS NULL)", async () => {
    await seedSalesRecord(ctx, "USD", "2026-05-08", "100.00");
    await seedExchangeRate(ctx, "USD", "2026-05-08", "1.2500");

    const result1 = await runBackfill({ dryRun: false });
    expect(result1.updated).toBe(1);

    // Second run — already-stamped rows are filtered by the WHERE clause.
    const result2 = await runBackfill({ dryRun: false });
    expect(result2.updated).toBe(0);
  });

  it("D-07 hard-fail: throws when a USD row's transaction_date has no rate within 7 days (no silent identity)", async () => {
    // 2026-04-01 USD row, but the seeded USD rate is 2026-05-08 — that's
    // 37 days FORWARD, which carry-forward cannot reach (lookup is
    // rate_date <= transaction_date). Backfill MUST throw, not silently
    // stamp net_amount_gbp = net_amount. Per D-03 ("fail loudly").
    await seedSalesRecord(ctx, "USD", "2026-04-01", "100.00");
    await seedExchangeRate(ctx, "USD", "2026-05-08", "1.2500");

    await expect(runBackfill({ dryRun: false })).rejects.toThrow(/USD|stale|no rate/i);

    // After the throw, the offending row is NOT stamped.
    const rows = await ctx.db.select().from(salesRecords).where(eq(salesRecords.currency, "USD"));
    expect(rows[0].netAmountGbp).toBeNull();
  });
});

// --------------------------------------------------------------------------
// Helpers — minimal seed utilities. Real shape lands in Wave 1 plan 09.1-02
// once the `salesRecords.netAmountGbp` column is in the schema. For now
// these are signature-only so the SUT contract is clear.
// --------------------------------------------------------------------------

async function seedSalesRecord(
  _ctx: TestDbContext,
  _currency: string,
  _txnDate: string,
  _netAmount: string,
): Promise<void> {
  // Wave 1 implementation: insert a minimal salesRecords row with the
  // mandatory FK chain (region → location → kiosk → import) seeded once
  // per `setupTestDb` and reused. See tests/etl/azure-etl.integration.test.ts
  // for the canonical FK seeding pattern.
  throw new Error("seedSalesRecord not implemented — Wave 1 plan 09.1-02");
}

async function seedSalesRecords(
  ctx: TestDbContext,
  count: number,
  currency: string,
  txnDate: string,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await seedSalesRecord(ctx, currency, txnDate, "100.00");
  }
}

async function seedExchangeRate(
  _ctx: TestDbContext,
  _currency: string,
  _rateDate: string,
  _rateToGbp: string,
): Promise<void> {
  throw new Error("seedExchangeRate not implemented — Wave 1 plan 09.1-02");
}
