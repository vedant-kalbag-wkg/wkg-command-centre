import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, sql } from "drizzle-orm";
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
const CSV_PATH = path.join(process.cwd(), "WKG_NETSUITE_VK.csv");
const ETL_ACTOR_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Extract unique outlet codes from the NetSuite CSV. Outlet Code is column
 * index 9 (0-indexed) in the 37-column layout. The CSV has no quoted commas
 * inside the outlet-code column (verified), so a naive split is fine.
 */
function extractUniqueOutletCodes(bytes: Buffer): string[] {
  const text = bytes.toString("utf8");
  const lines = text.split(/\r?\n/);
  const set = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(",");
    const code = cols[9]?.trim();
    if (code && code.toUpperCase() !== "NULL") set.add(code);
  }
  return Array.from(set);
}

describe("runAzureEtl (full CSV fixture)", () => {
  let ctx: TestDbContext;
  let ukRegionId: string;
  let csvBytes: Buffer;
  let outletCodes: string[];

  beforeAll(async () => {
    csvBytes = readFileSync(CSV_PATH);
    outletCodes = extractUniqueOutletCodes(csvBytes);
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
    expect(result.failed).toHaveLength(0);
    expect(result.processed).toHaveLength(1);
    expect(result.processed[0]).toMatchObject({
      regionCode: "UK",
      blobPath: BLOB_PATH,
      rows: 2664,
    });

    // Total row count persisted.
    const [{ count: total }] = await ctx.db
      .select({ count: sql<string>`count(*)` })
      .from(salesRecords);
    expect(Number(total)).toBe(2664);

    // Booking Fee rows: 1273 by is_booking_fee flag AND 1273 by netsuite_code='9991'.
    const bookingFees = await ctx.db
      .select({ id: salesRecords.id })
      .from(salesRecords)
      .where(eq(salesRecords.isBookingFee, true));
    expect(bookingFees).toHaveLength(1273);

    const code9991 = await ctx.db
      .select({ id: salesRecords.id })
      .from(salesRecords)
      .where(eq(salesRecords.netsuiteCode, "9991"));
    expect(code9991).toHaveLength(1273);

    // Cash Handling Fee rows: 38 under fallback '9992'.
    const code9992 = await ctx.db
      .select({ id: salesRecords.id })
      .from(salesRecords)
      .where(eq(salesRecords.netsuiteCode, "9992"));
    expect(code9992).toHaveLength(38);

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
