import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import { salesRecords, locations } from "@/db/schema";
import { sql, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  combineConditions,
  kioskLiveDateSubquery,
} from "@/lib/analytics/queries/shared";
import { buildActiveLocationCondition } from "@/lib/analytics/active-locations";
import { wrapAnalyticsQuery } from "@/lib/analytics/cached-query";
import type {
  AnalyticsFilters,
  MaturityBucketMetrics,
  RevenueRampPoint,
  InstallCohort,
  MaturityAnalysis,
} from "@/lib/analytics/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Internal: build WHERE clause ───────────────────────────────────────────

async function buildMaturityWhere(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<SQL | undefined> {
  // Phase 1 #6: swap buildExclusionCondition → buildActiveLocationCondition.
  // JOIN stays (kioskLiveDateSubquery references locations.id), but the
  // location predicate now filters via the sales_records covering index
  // before the JOIN rather than through a locations scan.
  const [scopeCondition, activeLocationCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildActiveLocationCondition(),
  ]);

  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);
  const maturityCondition = buildMaturityCondition(filters);

  return combineConditions([
    dateCondition,
    scopeCondition,
    activeLocationCondition,
    maturityCondition,
    ...dimensionConditions,
  ]);
}

function baseFrom(): SQL {
  return sql`${salesRecords}
    INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}`;
}

// ─── Query 1: Revenue by Detailed Maturity Bucket ───────────────────────────

export async function getRevenueByMaturityBucket(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<MaturityBucketMetrics[]> {
  const whereClause = await buildMaturityWhere(filters, userCtx);

  const liveDateCondition = sql`${kioskLiveDateSubquery} IS NOT NULL`;
  const fullWhere = whereClause
    ? sql`${whereClause} AND ${liveDateCondition}`
    : liveDateCondition;

  // Bucket kiosks by how mature they were on the user-selected end date
  // (filters.dateTo), not NOW(). Using NOW() would classify every kiosk by
  // its maturity today, ignoring the selected reporting window.
  const referenceDate = sql`${filters.dateTo}::timestamp`;

  const rows = await executeRows<{
    bucket: string;
    location_count: string;
    avg_revenue: string;
    total_revenue: string;
  }>(sql`
    SELECT
      CASE
        WHEN EXTRACT(EPOCH FROM (${referenceDate} - ${kioskLiveDateSubquery})) / 86400 <= 30 THEN '0-30d'
        WHEN EXTRACT(EPOCH FROM (${referenceDate} - ${kioskLiveDateSubquery})) / 86400 <= 60 THEN '31-60d'
        WHEN EXTRACT(EPOCH FROM (${referenceDate} - ${kioskLiveDateSubquery})) / 86400 <= 90 THEN '61-90d'
        ELSE '90+d'
      END AS bucket,
      COUNT(DISTINCT ${salesRecords.locationId}) AS location_count,
      COALESCE(SUM(${salesRecords.netAmount}::numeric) / NULLIF(COUNT(DISTINCT ${salesRecords.locationId}), 0), 0) AS avg_revenue,
      COALESCE(SUM(${salesRecords.netAmount}::numeric), 0) AS total_revenue
    FROM ${baseFrom()}
    WHERE ${fullWhere}
    GROUP BY bucket
    ORDER BY bucket
  `);

  // Ensure all 4 buckets are represented
  const bucketOrder = ["0-30d", "31-60d", "61-90d", "90+d"];
  const resultMap = new Map(
    rows.map((r) => [
      r.bucket,
      {
        bucket: r.bucket,
        locationCount: Number(r.location_count),
        avgRevenue: Number(r.avg_revenue),
        totalRevenue: Number(r.total_revenue),
      },
    ]),
  );

  return bucketOrder.map(
    (b) =>
      resultMap.get(b) ?? {
        bucket: b,
        locationCount: 0,
        avgRevenue: 0,
        totalRevenue: 0,
      },
  );
}

// ─── Query 2: Revenue Ramp Curve ────────────────────────────────────────────

export async function getRevenueRampCurve(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<RevenueRampPoint[]> {
  const whereClause = await buildMaturityWhere(filters, userCtx);

  const liveDateCondition = sql`${kioskLiveDateSubquery} IS NOT NULL`;
  const fullWhere = whereClause
    ? sql`${whereClause} AND ${liveDateCondition}`
    : liveDateCondition;

  const rows = await executeRows<{
    months_since: string;
    avg_revenue: string;
    location_count: string;
  }>(sql`
    SELECT
      LEAST(
        FLOOR(EXTRACT(EPOCH FROM (${salesRecords.transactionDate}::timestamp - ${kioskLiveDateSubquery})) / (30.44 * 86400)),
        6
      )::int AS months_since,
      COALESCE(SUM(${salesRecords.netAmount}::numeric) / NULLIF(COUNT(DISTINCT ${salesRecords.locationId}), 0), 0) AS avg_revenue,
      COUNT(DISTINCT ${salesRecords.locationId}) AS location_count
    FROM ${baseFrom()}
    WHERE ${fullWhere}
      AND ${salesRecords.transactionDate}::timestamp >= ${kioskLiveDateSubquery}
    GROUP BY months_since
    ORDER BY months_since
  `);

  // Ensure all points 0-6 are represented
  const resultMap = new Map(
    rows.map((r) => [
      Number(r.months_since),
      {
        monthsSinceInstall: Number(r.months_since),
        avgRevenue: Number(r.avg_revenue),
        locationCount: Number(r.location_count),
      },
    ]),
  );

  return Array.from({ length: 7 }, (_, i) =>
    resultMap.get(i) ?? {
      monthsSinceInstall: i,
      avgRevenue: 0,
      locationCount: 0,
    },
  );
}

// ─── Query 3: Install Month Cohorts ─────────────────────────────────────────

export async function getInstallCohorts(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<InstallCohort[]> {
  const whereClause = await buildMaturityWhere(filters, userCtx);

  const liveDateCondition = sql`${kioskLiveDateSubquery} IS NOT NULL`;
  const fullWhere = whereClause
    ? sql`${whereClause} AND ${liveDateCondition}`
    : liveDateCondition;

  const rows = await executeRows<{
    install_month: string;
    location_count: string;
    avg_monthly_revenue: string;
  }>(sql`
    SELECT
      TO_CHAR(${kioskLiveDateSubquery}, 'YYYY-MM') AS install_month,
      COUNT(DISTINCT ${salesRecords.locationId}) AS location_count,
      COALESCE(SUM(${salesRecords.netAmount}::numeric) / NULLIF(COUNT(DISTINCT ${salesRecords.locationId}), 0), 0) AS avg_monthly_revenue
    FROM ${baseFrom()}
    WHERE ${fullWhere}
    GROUP BY install_month
    ORDER BY install_month DESC
  `);

  return rows.map((r) => ({
    installMonth: r.install_month,
    locationCount: Number(r.location_count),
    avgMonthlyRevenue: Number(r.avg_monthly_revenue),
  }));
}

// ─── Combined: Full Maturity Analysis ───────────────────────────────────────

export async function getMaturityAnalysis(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<MaturityAnalysis> {
  const [bucketMetrics, rampCurve, installCohorts] = await Promise.all([
    getRevenueByMaturityBucket(filters, userCtx),
    getRevenueRampCurve(filters, userCtx),
    getInstallCohorts(filters, userCtx),
  ]);

  return { bucketMetrics, rampCurve, installCohorts };
}

// ─── Cached variants (Phase 3) ──────────────────────────────────────────────

const PAGE_TAGS = ['analytics', 'analytics:maturity'];

export const getMaturityAnalysisCached = wrapAnalyticsQuery(getMaturityAnalysis, {
  name: 'getMaturityAnalysis',
  tags: PAGE_TAGS,
});
