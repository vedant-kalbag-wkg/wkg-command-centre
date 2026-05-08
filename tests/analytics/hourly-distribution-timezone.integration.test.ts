/**
 * D6 / Task 2.12 — Hourly Distribution must bucket sales by each location's
 * IANA timezone, not by naïve UTC.
 *
 * Setup: two locations in different zones (UK Europe/London,
 * AU Australia/Sydney). One sales row each at the SAME UTC instant
 * (2025-06-15 09:00 UTC). At that instant:
 *   - London is BST (UTC+1) → local hour = 10
 *   - Sydney is AEST (UTC+10) → local hour = 19
 *
 * The aggregated query must therefore return TWO distinct buckets (10 and 19)
 * with one transaction in each. If the query were still naïve UTC, both rows
 * would collapse into bucket 9 with two transactions.
 *
 * We exercise the same SQL fragment getHourlyDistribution emits (the
 * `EXTRACT(HOUR FROM (... AT TIME ZONE 'UTC') AT TIME ZONE
 *  l.iana_timezone)` shape), but issue it directly through the test container
 * so the test stays independent of the userCtx / scoping infrastructure.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import { locations, regions, products, salesRecords } from "@/db/schema";

describe("Hourly Distribution — per-location IANA timezone bucketing (D6)", () => {
  let ctx: TestDbContext;
  let ukLocId: string;
  let auLocId: string;
  let productId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();

    // Migration 0018 seeds the canonical regions; pull UK + AU.
    const [uk] = await ctx.db.select().from(regions).where(eq(regions.code, "UK"));
    const [au] = await ctx.db.select().from(regions).where(eq(regions.code, "AU"));
    expect(uk).toBeDefined();
    expect(au).toBeDefined();

    // Two locations explicitly tagged with their IANA zones. Migration 0033
    // backfills these for canonical regions, but we set them inline so the
    // test reads the contract from this file rather than another migration.
    const [london] = await ctx.db
      .insert(locations)
      .values({
        name: "London Test Hotel",
        outletCode: "TZ-LON",
        primaryRegionId: uk.id,
        ianaTimezone: "Europe/London",
      })
      .returning();
    const [sydney] = await ctx.db
      .insert(locations)
      .values({
        name: "Sydney Test Hotel",
        outletCode: "TZ-SYD",
        primaryRegionId: au.id,
        ianaTimezone: "Australia/Sydney",
      })
      .returning();
    ukLocId = london.id;
    auLocId = sydney.id;

    // One product to satisfy sales_records.product_id NOT NULL FK.
    // products has only `name` (unique) + optional categoryCode/categoryName.
    const [product] = await ctx.db
      .insert(products)
      .values({
        name: "TZ Test Product",
        categoryName: "Snack",
      })
      .returning();
    productId = product.id;

    // One transaction at each location, recorded at the same UTC instant
    // (2025-06-15 09:00 UTC). Both transaction_date + transaction_time below
    // are stored as the UTC clock face — matching what the NetSuite ETL
    // writes. salesRecords has several NOT NULL columns beyond the obvious
    // ones (saleRef / refNo / vatAmount / netsuiteCode); seed minimal values.
    await ctx.db.insert(salesRecords).values([
      {
        locationId: ukLocId,
        productId,
        transactionDate: "2025-06-15",
        transactionTime: "09:00:00",
        netAmount: "10.00",
        vatAmount: "0.00",
        netsuiteCode: "9999",
        saleRef: "TZ-LON-1",
        refNo: "TZ-LON-1",
        regionId: uk.id,
      },
      {
        locationId: auLocId,
        productId,
        transactionDate: "2025-06-15",
        transactionTime: "09:00:00",
        netAmount: "10.00",
        vatAmount: "0.00",
        netsuiteCode: "9999",
        saleRef: "TZ-SYD-1",
        refNo: "TZ-SYD-1",
        regionId: au.id,
      },
    ]);
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  it("buckets by local hour: London → 10 (BST), Sydney → 19 (AEST)", async () => {
    // Mirror the SQL shape getHourlyDistribution emits — the only meaningful
    // bit for this test is the AT-TIME-ZONE expression. Filter by our two
    // test locations to ignore any seeded fixture sales the migrations may
    // have created.
    const rows = await ctx.db.execute(sql`
      SELECT
        EXTRACT(HOUR FROM
          ((${salesRecords.transactionDate} + ${salesRecords.transactionTime}) AT TIME ZONE 'UTC')
          AT TIME ZONE ${locations.ianaTimezone}
        )::int AS hour,
        COUNT(*)::int AS txn_count
      FROM ${salesRecords}
        INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
      WHERE ${salesRecords.locationId} IN (${ukLocId}, ${auLocId})
      GROUP BY 1
      ORDER BY 1
    `);

    // ctx.db.execute returns either { rows } or a Result depending on driver;
    // node-postgres yields { rows }.
    const data = (rows as unknown as { rows: Array<{ hour: number; txn_count: number }> }).rows;
    const byHour = new Map(data.map((r) => [Number(r.hour), Number(r.txn_count)]));

    expect(byHour.size).toBe(2);
    expect(byHour.get(10)).toBe(1); // London BST
    expect(byHour.get(19)).toBe(1); // Sydney AEST
  });

  it("falls back to UTC bucketing when iana_timezone is forced to 'UTC'", async () => {
    // Sanity check: the same data, with the target zone pinned to UTC, must
    // collapse into a single bucket (hour 9). Confirms the AT-TIME-ZONE
    // expression — not some other coincidence — is what splits the buckets.
    const rows = await ctx.db.execute(sql`
      SELECT
        EXTRACT(HOUR FROM
          ((${salesRecords.transactionDate} + ${salesRecords.transactionTime}) AT TIME ZONE 'UTC')
          AT TIME ZONE 'UTC'
        )::int AS hour,
        COUNT(*)::int AS txn_count
      FROM ${salesRecords}
      WHERE ${salesRecords.locationId} IN (${ukLocId}, ${auLocId})
      GROUP BY 1
      ORDER BY 1
    `);

    const data = (rows as unknown as { rows: Array<{ hour: number; txn_count: number }> }).rows;
    expect(data).toHaveLength(1);
    expect(Number(data[0].hour)).toBe(9);
    expect(Number(data[0].txn_count)).toBe(2);
  });
});
