import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
import Papa from "papaparse";
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

const CSV_PATH = join(process.cwd(), "WKG_NETSUITE_VK.csv");
const CSV_PRESENT = existsSync(CSV_PATH);

/**
 * End-to-end integration test against the real 37-column NetSuite export
 * (`WKG_NETSUITE_VK.csv` at the repo root). The file is untracked and must not
 * be committed, but the test reads from it directly to exercise the ETL against
 * production-shaped data.
 *
 * Verified fixture facts (at authoring time):
 *   - 2664 data rows (header ignored)
 *   - 1273 Booking Fee rows (Code=NULL → fallback to "9991")
 *   - 38 Cash Handling Fee rows (Code=NULL → fallback to "9992")
 *   - 178 unique outlet codes — ALL are seeded below scoped to the UK region,
 *     otherwise the dimension resolver rejects unknown outlets and the blob is
 *     marked failed.
 *   - Reversal pair for refNo='2XA4558609' nets to 0 (34.09 + -34.09).
 */

type Blob = { bytes: Buffer; etag: string };

// NOTE: duplicated from ./azure-etl.integration.test.ts — consolidate into a
// shared helper (e.g. tests/helpers/blob-stub.ts) if a third ETL integration
// test is added.
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
  } as unknown as import("@azure/storage-blob").BlobServiceClient;
}

const BLOB_PATH = "GB/2026/01/01/sales.csv";
const ETL_ACTOR_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Extract unique outlet codes from the NetSuite CSV using papaparse (the same
 * parser the real pipeline uses), so this is resilient to quoted commas or
 * column reordering.
 */
function extractUniqueOutletCodes(csvText: string): string[] {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const codes = new Set<string>();
  for (const row of parsed.data) {
    const code = (row["Outlet Code"] ?? "").trim();
    if (code && code.toUpperCase() !== "NULL") codes.add(code);
  }
  return Array.from(codes);
}

// Opt-in end-to-end test against the real NetSuite export. Auto-skips when
// `WKG_NETSUITE_VK.csv` is absent (intentionally untracked — user-supplied
// fixture).
describe.skipIf(!CSV_PRESENT)("runAzureEtl (full CSV fixture)", () => {
  let ctx: TestDbContext;
  let ukRegionId: string;
  let csvBytes: Buffer;
  let outletCodes: string[];

  beforeAll(async () => {
    csvBytes = readFileSync(CSV_PATH);
    outletCodes = extractUniqueOutletCodes(csvBytes.toString("utf8"));
    ctx = await setupTestDb();
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
    // FK-ordered deletes for a clean slate.
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

    // Seed a location for every unique outlet code in the fixture.
    await ctx.db.insert(locations).values(
      outletCodes.map((code) => ({
        name: `Test Outlet ${code}`,
        outletCode: code,
        primaryRegionId: ukRegionId,
      })),
    );

    await ctx.db.insert(productCodeFallbacks).values([
      { productName: "Booking Fee", netsuiteCode: "9991" },
      { productName: "Cash Handling Fee", netsuiteCode: "9992" },
    ]);

    // Sanity: the fixture currently has 288 unique outlet codes (Jan 1-31
    // 2026 export, 95k+ rows). If this ever trips, the fixture was
    // regenerated — update the expected count here and re-verify the other
    // magic numbers below.
    expect(outletCodes).toHaveLength(288);
  });

  it("processes the full real NetSuite export end-to-end and is idempotent", async () => {
    const blobs = new Map<string, Blob>([
      [BLOB_PATH, { bytes: csvBytes, etag: '"etag-full"' }],
    ]);
    const client = buildStubClient(blobs);

    // ---- First run --------------------------------------------------------
    const result = await runAzureEtl(ctx.db, { client });
    if (result.status !== "ok") {
      throw new Error(`unexpected: ${JSON.stringify(result)}`);
    }
    if (result.failed.length > 0) {
      throw new Error(`unexpected ETL failures: ${JSON.stringify(result.failed, null, 2)}`);
    }
    expect(result.failed).toHaveLength(0);
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({
      regionCode: "UK",
      blobPath: BLOB_PATH,
      rows: 95103,
    });

    // Total row count persisted.
    const [{ count: total }] = await ctx.db
      .select({ count: sql<string>`count(*)` })
      .from(salesRecords);
    expect(Number(total)).toBe(95103);

    // Booking Fee rows: 45621 by is_booking_fee flag AND 45621 by netsuite_code='9991'.
    const bookingFees = await ctx.db
      .select({ id: salesRecords.id })
      .from(salesRecords)
      .where(eq(salesRecords.isBookingFee, true));
    expect(bookingFees).toHaveLength(45621);

    const code9991 = await ctx.db
      .select({ id: salesRecords.id })
      .from(salesRecords)
      .where(eq(salesRecords.netsuiteCode, "9991"));
    expect(code9991).toHaveLength(45621);

    // Cash Handling Fee rows: 2040 under fallback '9992'.
    const code9992 = await ctx.db
      .select({ id: salesRecords.id })
      .from(salesRecords)
      .where(eq(salesRecords.netsuiteCode, "9992"));
    expect(code9992).toHaveLength(2040);

    // Reversal pair nets to zero.
    const [{ total: reversalSum }] = await ctx.db
      .select({
        total: sql<string>`coalesce(sum(${salesRecords.netAmount}), 0)`,
      })
      .from(salesRecords)
      .where(eq(salesRecords.refNo, "2XA4558609"));
    expect(Number(reversalSum)).toBe(0);

    // Ingestion row recorded as success.
    const ingRows = await ctx.db
      .select()
      .from(salesBlobIngestions)
      .where(eq(salesBlobIngestions.regionId, ukRegionId));
    expect(ingRows).toHaveLength(1);
    expect(ingRows[0]).toMatchObject({
      blobPath: BLOB_PATH,
      status: "success",
    });

    // ---- Second run: idempotent ------------------------------------------
    const rerun = await runAzureEtl(ctx.db, { client });
    if (rerun.status !== "ok") {
      throw new Error(`unexpected: ${JSON.stringify(rerun)}`);
    }
    expect(rerun.processed).toHaveLength(0);
    expect(rerun.failed).toHaveLength(0);
    expect(rerun.skipped).toHaveLength(1);
    expect(rerun.skipped[0].blobPath).toBe(BLOB_PATH);
  });
});
