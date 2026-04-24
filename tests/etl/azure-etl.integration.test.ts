import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import {
  locations,
  productCodeFallbacks,
  products,
  providers,
  regions,
  salesBlobIngestions,
  salesImports,
  salesRecords,
  user,
} from "@/db/schema";
import { runAzureEtl } from "@/lib/sales/etl/azure-etl";

/**
 * Integration test for `runAzureEtl`.
 *
 * Stubs the BlobServiceClient via an in-memory blob map. The stub mimics the
 * three entry points the orchestrator uses:
 *   - getContainerClient(name).listBlobsFlat({ prefix })   → async iterator
 *   - getContainerClient(name).getBlobClient(path)
 *     - .downloadToBuffer()  → Buffer
 *     - .getProperties()     → { etag }
 *
 * Real Postgres (via testcontainers) executes the stage + commit + idempotency
 * writes so we can assert on the real tables afterwards.
 */

type Blob = { bytes: Buffer; etag: string };

function buildStubClient(blobs: Map<string, Blob>) {
  return {
    getContainerClient: (_name: string) => ({
      listBlobsFlat: function ({ prefix }: { prefix: string }) {
        const matches = Array.from(blobs.keys())
          .filter((k) => k.startsWith(prefix))
          .map((name) => ({ name }));
        return {
          [Symbol.asyncIterator]: async function* () {
            for (const m of matches) yield m;
          },
        };
      },
      getBlobClient: (path: string) => ({
        downloadToBuffer: async () => {
          const b = blobs.get(path);
          if (!b) throw new Error(`stub: blob not found: ${path}`);
          return b.bytes;
        },
        getProperties: async () => {
          const b = blobs.get(path);
          if (!b) throw new Error(`stub: blob not found: ${path}`);
          return { etag: b.etag };
        },
      }),
    }),
    // Shape-compat with BlobServiceClient — only the two methods above are used.
  } as unknown as import("@azure/storage-blob").BlobServiceClient;
}

// NetSuite-format CSV header used across the fixtures.
const HEADER = [
  "Saleref", "Ref No", "Code", "Product Name", "Category Code", "Category Name",
  "agent", "Outlet Code", "Outlet Name", "Date", "Time", "Customer Code",
  "Customer Name", "supp_nam", "API Product Name", "City", "Country",
  "Business Division", "VAT Rate", "Net Amt", "VAT Amt", "Currency",
].join(",");

const csv = (rows: string[][]) =>
  [HEADER, ...rows.map((r) => r.join(","))].join("\n");

/**
 * Happy-path fixture: 1 principal sale + 1 Booking Fee (Code empty → fallback) +
 * 1 Cash Handling Fee (Code empty → fallback).
 */
const HAPPY_CSV = csv([
  // principal
  [
    "5578141", "Q5A4558585", "4603", "Uber API", "TRNSCAR", "UBER",
    "Digital Sale", "Q5", "Staycity Greenwich", "1-Jan-26", "0:02:23", "2580",
    "Staycity Greenwich", "Uber API", "UberX", "London", "GB",
    "UberSSM", "20", "12.48", "2.50", "GBP",
  ],
  // booking fee — Code empty, fallback to 9991
  [
    "5578141", "Q5A4558585-b", "", "Booking Fee", "TRNSCAR", "Transfers - Cars",
    "Digital Sale", "Q5", "Staycity Greenwich", "1-Jan-26", "", "2580",
    "Staycity Greenwich", "Uber API", "", "London", "GB",
    "UberSSM", "20", "2.24", "0.45", "GBP",
  ],
  // cash handling fee — Code empty, fallback to 9992
  [
    "5578141", "Q5A4558585-c", "", "Cash Handling Fee", "TRNSCAR", "Fees",
    "Digital Sale", "Q5", "Staycity Greenwich", "1-Jan-26", "", "2580",
    "Staycity Greenwich", "Uber API", "", "London", "GB",
    "UberSSM", "20", "0.10", "0.02", "GBP",
  ],
]);

/**
 * Broken fixture: unknown outlet code → dimension resolver emits a row
 * validation error → stage returns invalidCount > 0 → orchestrator records
 * sales_blob_ingestions.status='failed'.
 */
const BROKEN_CSV = csv([
  [
    "9999", "ZZZ-1", "4603", "Uber API", "TRNSCAR", "UBER",
    "Digital Sale", "XX", "Unknown Hotel", "2-Jan-26", "", "2580",
    "Unknown", "Uber API", "UberX", "London", "GB",
    "UberSSM", "20", "1.00", "0.20", "GBP",
  ],
]);

/** Small unrelated happy fixture to prove one failure doesn't block others. */
const SIBLING_CSV = csv([
  [
    "6000", "Q5Z-1", "4603", "Uber API", "TRNSCAR", "UBER",
    "Digital Sale", "Q5", "Staycity Greenwich", "3-Jan-26", "", "1234",
    "Other", "Uber API", "UberX", "London", "GB",
    "UberSSM", "20", "9.00", "1.80", "GBP",
  ],
]);

const ETL_ACTOR_ID = "00000000-0000-0000-0000-000000000001";

describe("runAzureEtl (integration)", () => {
  let ctx: TestDbContext;
  let ukRegionId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
    // The ETL actor is seeded by migration 0018; double-check it exists to
    // make test failures here diagnose-able instead of FK-error-at-insert.
    const [etlUser] = await ctx.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, ETL_ACTOR_ID));
    if (!etlUser) throw new Error("ETL actor seed missing — check migration 0018");
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Reset all ETL-touched tables (order respects FK dependencies).
    await ctx.db.delete(salesRecords);
    await ctx.db.delete(salesBlobIngestions);
    await ctx.db.delete(salesImports);
    await ctx.db.delete(providers);
    await ctx.db.delete(products);
    await ctx.db.delete(locations);
    await ctx.db.delete(productCodeFallbacks);
    await ctx.db.delete(regions);

    const [uk] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK", azureCode: "GB" })
      .returning({ id: regions.id });
    ukRegionId = uk.id;

    await ctx.db
      .insert(locations)
      .values({
        name: "Staycity Greenwich",
        outletCode: "Q5",
        primaryRegionId: ukRegionId,
      });

    await ctx.db.insert(productCodeFallbacks).values([
      { productName: "Booking Fee", netsuiteCode: "9991" },
      { productName: "Cash Handling Fee", netsuiteCode: "9992" },
    ]);
  });

  it("processes a single happy blob, is idempotent on re-run, and records failures without blocking siblings", async () => {
    const blobs = new Map<string, Blob>([
      [
        "GB/2026/01/01/sales.csv",
        { bytes: Buffer.from(HAPPY_CSV, "utf8"), etag: '"etag-happy"' },
      ],
    ]);
    const client = buildStubClient(blobs);

    // ---- First run ----------------------------------------------------------
    const result = await runAzureEtl(ctx.db, { client });
    if (result.status !== "ok") throw new Error(`unexpected status: ${result.status}`);
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({
      regionCode: "UK",
      blobPath: "GB/2026/01/01/sales.csv",
      rows: 3,
    });
    expect(result.skipped).toHaveLength(0);
    expect(result.failed).toHaveLength(0);

    // Ingestion row recorded as success.
    const ingRows = await ctx.db
      .select()
      .from(salesBlobIngestions)
      .where(eq(salesBlobIngestions.regionId, ukRegionId));
    expect(ingRows).toHaveLength(1);
    expect(ingRows[0]).toMatchObject({
      blobPath: "GB/2026/01/01/sales.csv",
      status: "success",
    });

    // salesRecords has all three rows, with the right fee flags + codes.
    const allSales = await ctx.db.select().from(salesRecords);
    expect(allSales).toHaveLength(3);

    const bookingFees = await ctx.db
      .select()
      .from(salesRecords)
      .where(eq(salesRecords.isBookingFee, true));
    expect(bookingFees).toHaveLength(1);

    const code9991 = await ctx.db
      .select()
      .from(salesRecords)
      .where(eq(salesRecords.netsuiteCode, "9991"));
    expect(code9991).toHaveLength(1); // Booking Fee row, fallback applied

    const code9992 = await ctx.db
      .select()
      .from(salesRecords)
      .where(eq(salesRecords.netsuiteCode, "9992"));
    expect(code9992).toHaveLength(1); // Cash Handling Fee row, fallback applied

    // ---- Second run: no-op --------------------------------------------------
    const rerun = await runAzureEtl(ctx.db, { client });
    if (rerun.status !== "ok") throw new Error(`unexpected status: ${rerun.status}`);
    expect(rerun.processed).toHaveLength(0);
    expect(rerun.skipped).toHaveLength(1);
    expect(rerun.skipped[0].blobPath).toBe("GB/2026/01/01/sales.csv");

    // ---- Third run with a broken blob + a sibling good blob -----------------
    const mixedBlobs = new Map<string, Blob>([
      [
        "GB/2026/01/01/sales.csv",
        { bytes: Buffer.from(HAPPY_CSV, "utf8"), etag: '"etag-happy"' },
      ],
      [
        "GB/2026/01/02/sales.csv",
        { bytes: Buffer.from(BROKEN_CSV, "utf8"), etag: '"etag-broken"' },
      ],
      [
        "GB/2026/01/03/sales.csv",
        { bytes: Buffer.from(SIBLING_CSV, "utf8"), etag: '"etag-sibling"' },
      ],
    ]);
    const third = await runAzureEtl(ctx.db, { client: buildStubClient(mixedBlobs) });
    if (third.status !== "ok") throw new Error(`unexpected status: ${third.status}`);

    // Original blob is skipped (already successful).
    expect(third.skipped.map((s) => s.blobPath)).toContain(
      "GB/2026/01/01/sales.csv",
    );
    // Broken blob lands in failed, sibling processes fine.
    expect(third.failed).toHaveLength(1);
    expect(third.failed[0].blobPath).toBe("GB/2026/01/02/sales.csv");
    expect(third.processed.map((p) => p.blobPath)).toContain(
      "GB/2026/01/03/sales.csv",
    );

    const failedIng = await ctx.db
      .select()
      .from(salesBlobIngestions)
      .where(
        and(
          eq(salesBlobIngestions.regionId, ukRegionId),
          eq(salesBlobIngestions.blobPath, "GB/2026/01/02/sales.csv"),
        ),
      );
    expect(failedIng).toHaveLength(1);
    expect(failedIng[0].status).toBe("failed");
    expect(failedIng[0].errorMessage).toBeTruthy();
  });

  it("returns skipped-lock when another session holds the advisory lock", async () => {
    const { ETL_AZURE_LOCK_KEY } = await import("@/lib/sales/etl/advisory-lock");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const holder: any = await (ctx.pool as unknown as {
      connect: () => Promise<unknown>;
    }).connect();
    try {
      await holder.query(`SELECT pg_try_advisory_lock($1)`, [ETL_AZURE_LOCK_KEY]);
      const result = await runAzureEtl(ctx.db, {
        client: buildStubClient(new Map()),
      });
      expect(result).toEqual({ status: "skipped-lock" });
    } finally {
      await holder.query(`SELECT pg_advisory_unlock($1)`, [ETL_AZURE_LOCK_KEY]);
      holder.release();
    }
  });
});
