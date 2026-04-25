/**
 * Azure ETL run-history viewer pipeline — internal helpers.
 *
 * Mirrors the convention in `audit-log/pipeline.ts`: NO `"use server"`
 * directive (so we can co-locate types alongside async helpers). The page
 * is a pure RSC and calls these helpers directly with the singleton `db`.
 *
 * `_*ForActor` helpers accept the db as an explicit parameter so the
 * integration tests can drive them against a Testcontainers Postgres.
 */

import { and, asc, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { regions, salesBlobIngestions, salesImports } from "@/db/schema";

// Loose db type so callers can inject a testcontainers node-pg drizzle
// instance OR rely on the production postgres-js default. Mirrors the
// convention in `outlet-types/pipeline.ts` and `audit-log/pipeline.ts`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export const ETL_HISTORY_PAGE_SIZE = 50;

export type EtlHistoryFilters = {
  /** "success" | "failed" | undefined (= all). */
  status?: "success" | "failed";
  /** Region.code (e.g. "UK", "DE"). Resolved to regionId in the helper. */
  regionCode?: string;
  /** Inclusive lower bound on processedAt. UTC midnight of the chosen day. */
  dateFrom?: Date;
  /** Exclusive upper bound on processedAt. UTC midnight of the day AFTER
   *  the chosen `dateTo` so the whole day is included. */
  dateTo?: Date;
  /** Zero-based page index. */
  page?: number;
};

export type EtlHistoryRow = {
  id: string;
  regionId: string;
  regionCode: string;
  regionName: string;
  blobPath: string;
  blobDate: string;
  processedAt: Date;
  status: "success" | "failed";
  errorMessage: string | null;
  importId: string | null;
  /** Row count from the joined sales_imports row. Null when the ingestion
   *  failed (no import created) OR when the import has been hard-deleted. */
  rowCount: number | null;
};

export type EtlSummary = {
  /** Lifetime count of all blob ingestion rows (success + failed). */
  totalProcessed: number;
  /** Successful runs in the last 7 days (processedAt >= now - 7d). */
  last7dSuccess: number;
  /** Failed runs in the last 7 days. */
  last7dFailed: number;
  /** Currently failed blobs (status='failed') across all time. These will
   *  retry on the next ETL run because the upsert key is (regionId, blobPath). */
  currentlyFailed: number;
  /** Most recent successful run — null if none ever recorded. */
  latestSuccess: {
    processedAt: Date;
    regionCode: string;
    blobPath: string;
  } | null;
};

function buildWhere(
  filters: EtlHistoryFilters,
  regionIdByCode: Map<string, string>,
): SQL | undefined {
  const conds: SQL[] = [];
  if (filters.status) conds.push(eq(salesBlobIngestions.status, filters.status));
  if (filters.regionCode) {
    const id = regionIdByCode.get(filters.regionCode);
    // If the operator passes a region code that doesn't exist (e.g. stale
    // URL), force the result set to empty rather than silently dropping
    // the filter. `eq(id, '<impossible-uuid>')` does the trick.
    conds.push(
      eq(
        salesBlobIngestions.regionId,
        id ?? "00000000-0000-0000-0000-000000000000",
      ),
    );
  }
  if (filters.dateFrom) conds.push(gte(salesBlobIngestions.processedAt, filters.dateFrom));
  if (filters.dateTo) conds.push(lte(salesBlobIngestions.processedAt, filters.dateTo));
  return conds.length > 0 ? and(...conds) : undefined;
}

/**
 * List a single page of sales_blob_ingestions rows ordered by processedAt
 * desc, with the total count for the current filter set so the client can
 * render "Page N of M (total: K)".
 *
 * JOIN regions → blob ingestion always carries regionId; LEFT JOIN
 * sales_imports because failed rows have importId=NULL and successful
 * rows whose import was rolled back / hard-deleted will too.
 */
export async function _listEtlBlobIngestionsForActor(
  db: AnyDb,
  filters: EtlHistoryFilters,
): Promise<{ rows: EtlHistoryRow[]; totalCount: number }> {
  // Resolve region.code → region.id once for the WHERE filter (the count
  // query also needs it). Cheap — there are <10 regions.
  const regionRows = (await db
    .select({ id: regions.id, code: regions.code })
    .from(regions)) as Array<{ id: string; code: string }>;
  const regionIdByCode = new Map<string, string>(
    regionRows.map((r) => [r.code, r.id]),
  );

  const where = buildWhere(filters, regionIdByCode);
  const offset = (filters.page ?? 0) * ETL_HISTORY_PAGE_SIZE;

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: salesBlobIngestions.id,
        regionId: salesBlobIngestions.regionId,
        regionCode: regions.code,
        regionName: regions.name,
        blobPath: salesBlobIngestions.blobPath,
        blobDate: salesBlobIngestions.blobDate,
        processedAt: salesBlobIngestions.processedAt,
        status: salesBlobIngestions.status,
        errorMessage: salesBlobIngestions.errorMessage,
        importId: salesBlobIngestions.importId,
        rowCount: salesImports.rowCount,
      })
      .from(salesBlobIngestions)
      .innerJoin(regions, eq(regions.id, salesBlobIngestions.regionId))
      .leftJoin(salesImports, eq(salesImports.id, salesBlobIngestions.importId))
      .where(where)
      .orderBy(desc(salesBlobIngestions.processedAt))
      .limit(ETL_HISTORY_PAGE_SIZE)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesBlobIngestions)
      .where(where),
  ]);

  return {
    rows: rows as EtlHistoryRow[],
    totalCount: Number(count),
  };
}

/**
 * Distinct region codes that appear in `sales_blob_ingestions`. Used to
 * populate the region filter dropdown — we only show regions that
 * actually have ETL history so there's no dead-filter state.
 */
export async function _listEtlHistoryFilterRegionsForActor(
  db: AnyDb,
): Promise<Array<{ code: string; name: string }>> {
  const rows = (await db
    .selectDistinct({
      code: regions.code,
      name: regions.name,
    })
    .from(salesBlobIngestions)
    .innerJoin(regions, eq(regions.id, salesBlobIngestions.regionId))
    .orderBy(asc(regions.code))) as Array<{ code: string; name: string }>;
  return rows;
}

/**
 * Compute all four KPI tiles in a single SQL roundtrip — `count(*)
 * FILTER (WHERE …)` over the same scan. The "latest success" tile pulls
 * out the most-recent processedAt row in a separate small query (1 row,
 * indexed on processedAt desc → fast).
 */
export async function _getEtlSummaryForActor(db: AnyDb): Promise<EtlSummary> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [counts] = (await db
    .select({
      totalProcessed: sql<number>`count(*)::int`,
      last7dSuccess: sql<number>`count(*) FILTER (WHERE ${salesBlobIngestions.status} = 'success' AND ${salesBlobIngestions.processedAt} >= ${sevenDaysAgo})::int`,
      last7dFailed: sql<number>`count(*) FILTER (WHERE ${salesBlobIngestions.status} = 'failed' AND ${salesBlobIngestions.processedAt} >= ${sevenDaysAgo})::int`,
      currentlyFailed: sql<number>`count(*) FILTER (WHERE ${salesBlobIngestions.status} = 'failed')::int`,
    })
    .from(salesBlobIngestions)) as Array<{
    totalProcessed: number;
    last7dSuccess: number;
    last7dFailed: number;
    currentlyFailed: number;
  }>;

  const [latest] = (await db
    .select({
      processedAt: salesBlobIngestions.processedAt,
      regionCode: regions.code,
      blobPath: salesBlobIngestions.blobPath,
    })
    .from(salesBlobIngestions)
    .innerJoin(regions, eq(regions.id, salesBlobIngestions.regionId))
    .where(eq(salesBlobIngestions.status, "success"))
    .orderBy(desc(salesBlobIngestions.processedAt))
    .limit(1)) as Array<{
    processedAt: Date;
    regionCode: string;
    blobPath: string;
  }>;

  return {
    totalProcessed: Number(counts?.totalProcessed ?? 0),
    last7dSuccess: Number(counts?.last7dSuccess ?? 0),
    last7dFailed: Number(counts?.last7dFailed ?? 0),
    currentlyFailed: Number(counts?.currentlyFailed ?? 0),
    latestSuccess: latest
      ? {
          processedAt: latest.processedAt,
          regionCode: latest.regionCode,
          blobPath: latest.blobPath,
        }
      : null,
  };
}
