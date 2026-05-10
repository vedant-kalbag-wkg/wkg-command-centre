// Phase 9.1 Plan 09.1-05 Task 1 — extends the sales CSV pipeline integration
// coverage to assert the FX-02 contract:
//
//   - D-04 (GBP identity): currency='GBP' rows MUST have net_amount_gbp = net_amount,
//     stamped without any DB call to exchange_rates (rate-lookup.ts shortcut).
//   - D-05 (carry-forward): non-GBP rows are converted via the most-recent rate
//     row at-or-before transaction_date in exchange_rates. BoE quote shape
//     means rate_to_gbp = foreign-per-GBP, so net_amount_gbp = net_amount / rate.
//   - D-03 (unknown currency hard-fail): a CSV row with a currency outside
//     BOE_SUPPORTED_CURRENCIES makes _commitImportForActor THROW; the
//     transaction rolls back so no salesRecords land.
//   - D-07 (stale-rate hard-fail): a row whose nearest exchange_rate is > 7
//     days older than transaction_date makes _commitImportForActor THROW.
//
// Path note: this file lives under tests/sales/ to match the integration
// project glob (tests/**/*.integration.test.ts) — same routing fix applied
// in plan 09.1-04 for fx-rates-fetch-daily.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../helpers/test-db";
import {
  exchangeRates,
  kioskAssignments,
  kiosks,
  locations,
  products,
  productCodeFallbacks,
  regions,
  salesBlobIngestions,
  salesImports,
  salesRecords,
  user,
} from "@/db/schema";
import {
  _commitImportForActor,
  _stageImportForActor,
  type ImportActor,
} from "@/app/(app)/settings/data-import/sales/pipeline";
import type { SalesDataSource } from "@/lib/sales/source";
import { createHash } from "node:crypto";

const ETL_ACTOR_ID = "00000000-0000-0000-0000-000000000001";
const ACTOR: ImportActor = { id: ETL_ACTOR_ID, name: "Test Pipeline FX" };

const HEADER = [
  "Saleref", "Ref No", "Code", "Product Name", "Category Code", "Category Name",
  "agent", "Outlet Code", "Outlet Name", "Date", "Time", "Customer Code",
  "Customer Name", "supp_nam", "API Product Name", "City", "Country",
  "Business Division", "VAT Rate", "Net Amt", "VAT Amt", "Currency",
].join(",");

function csv(rows: string[][]): string {
  return [HEADER, ...rows.map((r) => r.join(","))].join("\n");
}

class StringSource implements SalesDataSource {
  constructor(private readonly text: string, private readonly tag: string) {}
  async pull() {
    const bytes = Buffer.from(this.text, "utf8");
    const sourceHash = createHash("sha256").update(bytes).digest("hex");
    return {
      filename: `${this.tag}.csv`,
      sourceLabel: `string:${this.tag}`,
      bytes,
      sourceHash: `${sourceHash}-${this.tag}`,
    };
  }
}

describe("pipeline FX-02 stamping (integration)", () => {
  let ctx: TestDbContext;
  let regionId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
    const [etl] = await ctx.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, ETL_ACTOR_ID));
    if (!etl) throw new Error("ETL actor seed missing — check migration 0018");
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    await ctx.db.delete(salesRecords);
    await ctx.db.delete(salesBlobIngestions);
    await ctx.db.delete(salesImports);
    await ctx.db.delete(exchangeRates);
    await ctx.db.delete(productCodeFallbacks);
    await ctx.db.delete(products);
    await ctx.db.delete(kioskAssignments);
    await ctx.db.delete(kiosks);
    await ctx.db.delete(locations);
    await ctx.db.delete(regions);

    const [r] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK", azureCode: "GB" })
      .returning({ id: regions.id });
    regionId = r.id;

    const [loc] = await ctx.db
      .insert(locations)
      .values({ name: "Staycity Greenwich", primaryRegionId: regionId })
      .returning({ id: locations.id });
    const [kiosk] = await ctx.db
      .insert(kiosks)
      .values({ kioskId: "KSK-Q5-FX", outletCode: "Q5" })
      .returning({ id: kiosks.id });
    await ctx.db.insert(kioskAssignments).values({
      kioskId: kiosk.id,
      locationId: loc.id,
      assignedBy: ETL_ACTOR_ID,
      assignedByName: "Test Pipeline FX",
    });
  });

  // Returns importId from a successful stage.
  async function stage(text: string, tag: string): Promise<string> {
    const stageResult = await _stageImportForActor(
      new StringSource(text, tag),
      ACTOR,
      ctx.db,
      { regionId, feeCodeFallbacks: new Map() },
    );
    return stageResult.importId;
  }

  it("D-04 + D-05: stamps net_amount_gbp identity for GBP and carry-forward divide for non-GBP", async () => {
    // Seed USD + EUR rates dated 2026-05-08.
    // BoE quote semantics: rate_to_gbp = foreign-per-GBP. 1 GBP buys 1.25 USD.
    // Convert: net_amount_gbp = net_amount / rate_to_gbp.
    await ctx.db.insert(exchangeRates).values([
      { currency: "USD", rateDate: "2026-05-08", rateToGbp: "1.2500" },
      { currency: "EUR", rateDate: "2026-05-08", rateToGbp: "1.1800" },
    ]);

    const text = csv([
      // GBP — identity → net_amount_gbp = 12.48
      ["5578141", "G-1", "4603", "Uber API", "TRNSCAR", "UBER", "Digital Sale",
       "Q5", "Staycity Greenwich", "8-May-26", "10:00:00", "2580",
       "Staycity Greenwich", "Uber API", "UberX", "London", "GB",
       "UberSSM", "20", "12.48", "2.50", "GBP"],
      // USD — 100 / 1.25 = 80.00
      ["5578142", "U-1", "4603", "Uber API", "TRNSCAR", "UBER", "Digital Sale",
       "Q5", "Staycity Greenwich", "8-May-26", "10:00:00", "2580",
       "Staycity Greenwich", "Uber API", "UberX", "London", "GB",
       "UberSSM", "20", "100.00", "20.00", "USD"],
      // EUR — 118 / 1.18 = 100.00
      ["5578143", "E-1", "4603", "Uber API", "TRNSCAR", "UBER", "Digital Sale",
       "Q5", "Staycity Greenwich", "8-May-26", "10:00:00", "2580",
       "Staycity Greenwich", "Uber API", "UberX", "London", "GB",
       "UberSSM", "20", "118.00", "20.00", "EUR"],
    ]);

    const importId = await stage(text, "happy-mixed");
    await _commitImportForActor(importId, ACTOR, ctx.db);

    const rows = await ctx.db
      .select({
        currency: salesRecords.currency,
        netAmount: salesRecords.netAmount,
        netAmountGbp: salesRecords.netAmountGbp,
      })
      .from(salesRecords)
      .where(eq(salesRecords.importId, importId));
    expect(rows).toHaveLength(3);

    const byCcy = new Map(rows.map((r) => [r.currency, r]));
    expect(byCcy.get("GBP")?.netAmountGbp).toBe("12.48");
    expect(byCcy.get("USD")?.netAmountGbp).toBe("80.00");
    expect(byCcy.get("EUR")?.netAmountGbp).toBe("100.00");

    // None should be NULL after a successful commit.
    const nulls = await ctx.db.execute(
      sql`SELECT COUNT(*)::int AS n FROM sales_records WHERE net_amount_gbp IS NULL`,
    );
    expect((nulls.rows[0] as { n: number }).n).toBe(0);
  });

  it("D-07: throws on stale FX rate (> 7 days) and rolls back the transaction", async () => {
    // USD rate dated 2026-04-01, transaction_date 2026-05-08 → 37 days stale.
    await ctx.db.insert(exchangeRates).values({
      currency: "USD",
      rateDate: "2026-04-01",
      rateToGbp: "1.2500",
    });

    const text = csv([
      ["5578142", "U-stale", "4603", "Uber API", "TRNSCAR", "UBER", "Digital Sale",
       "Q5", "Staycity Greenwich", "8-May-26", "10:00:00", "2580",
       "Staycity Greenwich", "Uber API", "UberX", "London", "GB",
       "UberSSM", "20", "100.00", "20.00", "USD"],
    ]);

    const importId = await stage(text, "stale-rate");
    await expect(
      _commitImportForActor(importId, ACTOR, ctx.db),
    ).rejects.toThrow(/Stale FX rate|stale|7/i);

    // No rows committed — transaction rolled back.
    const rows = await ctx.db
      .select()
      .from(salesRecords)
      .where(eq(salesRecords.importId, importId));
    expect(rows).toHaveLength(0);
  });

  it("D-03: throws on unknown currency outside BOE_SUPPORTED_CURRENCIES", async () => {
    // Use 'XYZ' — not in BOE_SUPPORTED_CURRENCIES. The CSV parser case-folds
    // to upper but doesn't validate against the BoE set; that gate lives in
    // pipeline.ts at commit time.
    const text = csv([
      ["5578142", "X-1", "4603", "Uber API", "TRNSCAR", "UBER", "Digital Sale",
       "Q5", "Staycity Greenwich", "8-May-26", "10:00:00", "2580",
       "Staycity Greenwich", "Uber API", "UberX", "London", "GB",
       "UberSSM", "20", "100.00", "20.00", "XYZ"],
    ]);

    const importId = await stage(text, "unknown-ccy");
    await expect(
      _commitImportForActor(importId, ACTOR, ctx.db),
    ).rejects.toThrow(/Unknown currency.*XYZ|XYZ/);

    const rows = await ctx.db
      .select()
      .from(salesRecords)
      .where(eq(salesRecords.importId, importId));
    expect(rows).toHaveLength(0);
  });

  it("D-03: throws when no FX rate exists at-or-before transaction_date", async () => {
    // No exchange_rates rows seeded for USD — the lookup returns null.
    const text = csv([
      ["5578142", "U-norate", "4603", "Uber API", "TRNSCAR", "UBER", "Digital Sale",
       "Q5", "Staycity Greenwich", "8-May-26", "10:00:00", "2580",
       "Staycity Greenwich", "Uber API", "UberX", "London", "GB",
       "UberSSM", "20", "100.00", "20.00", "USD"],
    ]);

    const importId = await stage(text, "no-rate");
    await expect(
      _commitImportForActor(importId, ACTOR, ctx.db),
    ).rejects.toThrow(/No FX rate|USD/);
  });
});
