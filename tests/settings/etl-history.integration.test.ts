import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../helpers/test-db";
import {
  regions,
  salesBlobIngestions,
  salesImports,
  user,
} from "@/db/schema";
import {
  ETL_HISTORY_PAGE_SIZE,
  _getEtlSummaryForActor,
  _listEtlBlobIngestionsForActor,
  _listEtlHistoryFilterRegionsForActor,
} from "@/app/(app)/settings/data-import/azure/pipeline";

/**
 * Integration tests for the Azure ETL run-history viewer pipeline.
 *
 * Seed shape (5 rows):
 *   - 3 success across 2 regions (UK x2, DE x1)
 *   - 2 failed (UK x1, DE x1)
 *   - One success row joins to a real sales_imports.rowCount=42
 */
describe("etl-history viewer (pipeline)", () => {
  let ctx: TestDbContext;
  let ukRegionId: string;
  let deRegionId: string;
  let importIdWithRows: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  let processed: { day1: Date; day2: Date; day3: Date };

  beforeEach(async () => {
    // FK-ordered cleanup: blob ingestions reference sales_imports + regions.
    // sales_imports.uploaded_by → user.id, so we seed a user once and keep it.
    await ctx.db.delete(salesBlobIngestions);
    await ctx.db.delete(salesImports);
    await ctx.db.delete(regions);
    await ctx.db.delete(user);

    await ctx.db.insert(user).values({
      id: "test-uploader",
      name: "ETL Test Uploader",
      email: "etl-test@example.com",
    });

    const [uk] = await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK", azureCode: "GB" })
      .returning({ id: regions.id });
    ukRegionId = uk.id;

    const [de] = await ctx.db
      .insert(regions)
      .values({ name: "Germany", code: "DE", azureCode: "DE" })
      .returning({ id: regions.id });
    deRegionId = de.id;

    // Three days of processedAt — within 7d so they hit the last-7d KPIs.
    const now = Date.now();
    processed = {
      day1: new Date(now - 5 * 24 * 60 * 60 * 1000),
      day2: new Date(now - 3 * 24 * 60 * 60 * 1000),
      day3: new Date(now - 1 * 24 * 60 * 60 * 1000),
    };

    // Seed a sales_imports row so one of the success blobs has a joined rowCount.
    const [imp] = await ctx.db
      .insert(salesImports)
      .values({
        filename: "uk-day3.csv",
        sourceHash: "hash-day3",
        uploadedBy: "test-uploader",
        rowCount: 42,
        status: "committed",
        regionId: ukRegionId,
      })
      .returning({ id: salesImports.id });
    importIdWithRows = imp.id;

    await ctx.db.insert(salesBlobIngestions).values([
      {
        regionId: ukRegionId,
        blobPath: "uk/2026/04/20/sales.csv",
        blobDate: "2026-04-20",
        processedAt: processed.day1,
        status: "success",
      },
      {
        regionId: ukRegionId,
        blobPath: "uk/2026/04/22/sales.csv",
        blobDate: "2026-04-22",
        processedAt: processed.day2,
        status: "failed",
        errorMessage: "Timeout reading blob (after 30s)",
      },
      {
        regionId: ukRegionId,
        blobPath: "uk/2026/04/24/sales.csv",
        blobDate: "2026-04-24",
        processedAt: processed.day3,
        status: "success",
        importId: importIdWithRows,
      },
      {
        regionId: deRegionId,
        blobPath: "de/2026/04/20/sales.csv",
        blobDate: "2026-04-20",
        processedAt: processed.day1,
        status: "success",
      },
      {
        regionId: deRegionId,
        blobPath: "de/2026/04/22/sales.csv",
        blobDate: "2026-04-22",
        processedAt: processed.day2,
        status: "failed",
        errorMessage: "CSV header mismatch: expected 'Net Amount', got 'NetAmount'",
      },
    ]);
  });

  test("with no filters returns all 5 rows ordered by processedAt desc", async () => {
    const { rows, totalCount } = await _listEtlBlobIngestionsForActor(
      ctx.db,
      {},
    );
    expect(totalCount).toBe(5);
    expect(rows).toHaveLength(5);

    const ts = rows.map((r) => r.processedAt.getTime());
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i]).toBeLessThanOrEqual(ts[i - 1]);
    }
  });

  test("filter by status='failed' returns 2 rows", async () => {
    const { rows, totalCount } = await _listEtlBlobIngestionsForActor(ctx.db, {
      status: "failed",
    });
    expect(totalCount).toBe(2);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("failed");
      expect(row.errorMessage).not.toBeNull();
    }
  });

  test("filter by status='success' returns 3 rows", async () => {
    const { rows, totalCount } = await _listEtlBlobIngestionsForActor(ctx.db, {
      status: "success",
    });
    expect(totalCount).toBe(3);
    for (const row of rows) {
      expect(row.status).toBe("success");
    }
  });

  test("filter by region returns the right subset", async () => {
    const { rows: ukRows } = await _listEtlBlobIngestionsForActor(ctx.db, {
      regionCode: "UK",
    });
    expect(ukRows).toHaveLength(3);
    for (const row of ukRows) {
      expect(row.regionCode).toBe("UK");
    }

    const { rows: deRows } = await _listEtlBlobIngestionsForActor(ctx.db, {
      regionCode: "DE",
    });
    expect(deRows).toHaveLength(2);
    for (const row of deRows) {
      expect(row.regionCode).toBe("DE");
    }
  });

  test("unknown region code → empty result (no silent drop of filter)", async () => {
    const { rows, totalCount } = await _listEtlBlobIngestionsForActor(ctx.db, {
      regionCode: "XYZ",
    });
    expect(totalCount).toBe(0);
    expect(rows).toHaveLength(0);
  });

  test("rowCount surfaces from the joined sales_imports row", async () => {
    const { rows } = await _listEtlBlobIngestionsForActor(ctx.db, {});
    const withRows = rows.find((r) => r.importId === importIdWithRows);
    expect(withRows).toBeDefined();
    expect(withRows!.rowCount).toBe(42);

    // Failed rows have no importId, so rowCount should be null.
    const failed = rows.filter((r) => r.status === "failed");
    for (const row of failed) {
      expect(row.importId).toBeNull();
      expect(row.rowCount).toBeNull();
    }
  });

  test("date range filter narrows the window", async () => {
    // Window covering only day2 (UK fail + DE fail).
    const dateFrom = new Date(processed.day2.getTime() - 60 * 60 * 1000);
    const dateTo = new Date(processed.day2.getTime() + 60 * 60 * 1000);
    const { rows, totalCount } = await _listEtlBlobIngestionsForActor(ctx.db, {
      dateFrom,
      dateTo,
    });
    expect(totalCount).toBe(2);
    for (const row of rows) {
      expect(row.processedAt.getTime()).toBe(processed.day2.getTime());
      expect(row.status).toBe("failed");
    }
  });

  test("totalCount is independent of the page slice", async () => {
    const { rows, totalCount } = await _listEtlBlobIngestionsForActor(ctx.db, {
      page: 5,
    });
    expect(totalCount).toBe(5);
    expect(rows).toHaveLength(0);
    expect(ETL_HISTORY_PAGE_SIZE).toBe(50);
  });

  test("filter regions returns only regions that have ETL history", async () => {
    // Seed a third region with NO blob ingestions — it should NOT surface.
    await ctx.db
      .insert(regions)
      .values({ name: "Spain", code: "ES", azureCode: "ES" });

    const filterRegions = await _listEtlHistoryFilterRegionsForActor(ctx.db);
    const codes = filterRegions.map((r) => r.code).sort();
    expect(codes).toEqual(["DE", "UK"]);
  });

  test("summary KPIs aggregate correctly in a single query", async () => {
    const summary = await _getEtlSummaryForActor(ctx.db);

    // Lifetime: 5 rows.
    expect(summary.totalProcessed).toBe(5);
    // All 5 seeded within the last 7d → 3 success + 2 failed.
    expect(summary.last7dSuccess).toBe(3);
    expect(summary.last7dFailed).toBe(2);
    // Currently failed: 2.
    expect(summary.currentlyFailed).toBe(2);
    // Latest success is the day3 UK row.
    expect(summary.latestSuccess).not.toBeNull();
    expect(summary.latestSuccess!.regionCode).toBe("UK");
    expect(summary.latestSuccess!.processedAt.getTime()).toBe(
      processed.day3.getTime(),
    );
    expect(summary.latestSuccess!.blobPath).toBe("uk/2026/04/24/sales.csv");
  });

  test("summary returns null latestSuccess when no success rows exist", async () => {
    // Wipe successes so only failures remain.
    await ctx.db.delete(salesBlobIngestions);
    await ctx.db.insert(salesBlobIngestions).values({
      regionId: ukRegionId,
      blobPath: "uk/fail-only.csv",
      blobDate: "2026-04-24",
      processedAt: new Date(),
      status: "failed",
      errorMessage: "boom",
    });

    const summary = await _getEtlSummaryForActor(ctx.db);
    expect(summary.totalProcessed).toBe(1);
    expect(summary.last7dSuccess).toBe(0);
    expect(summary.last7dFailed).toBe(1);
    expect(summary.currentlyFailed).toBe(1);
    expect(summary.latestSuccess).toBeNull();
  });

  test("combined filters (status + region) narrow correctly", async () => {
    const { rows, totalCount } = await _listEtlBlobIngestionsForActor(ctx.db, {
      status: "failed",
      regionCode: "DE",
    });
    expect(totalCount).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].regionCode).toBe("DE");
    expect(rows[0].status).toBe("failed");
    // Suppress unused-var warning on deRegionId.
    expect(rows[0].regionId).toBe(deRegionId);
  });
});
