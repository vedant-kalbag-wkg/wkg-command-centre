import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import { salesRecords, locations } from "@/db/schema";
import { sql, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildAmountModeCondition,
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

  // metricMode applied per-aggregate via FILTER (D1 — counts mode-invariant).
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

// Inclusive calendar-month count between two ISO date strings (or Date objects).
// `'2026-01-01'` → `'2026-12-31'` is 12 months; same-month is 1.
function monthsBetweenInclusive(from: string | Date, to: string | Date): number {
  const f = from instanceof Date ? from : new Date(from);
  const t = to instanceof Date ? to : new Date(to);
  const months =
    (t.getUTCFullYear() - f.getUTCFullYear()) * 12 +
    (t.getUTCMonth() - f.getUTCMonth()) +
    1;
  return Math.max(1, months);
}

// ─── Query 1: Revenue by Detailed Maturity Bucket ───────────────────────────

export async function getRevenueByMaturityBucket(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<MaturityBucketMetrics[]> {
  const whereClause = await buildMaturityWhere(filters, userCtx);
  const amountMode = buildAmountModeCondition(filters);

  const liveDateCondition = sql`${kioskLiveDateSubquery} IS NOT NULL`;
  const fullWhere = whereClause
    ? sql`${whereClause} AND ${liveDateCondition}`
    : liveDateCondition;

  // Bucket kiosks by how mature they were on the user-selected end date
  // (filters.dateTo), not NOW(). Using NOW() would classify every kiosk by
  // its maturity today, ignoring the selected reporting window. Bucket
  // boundaries match the canonical 5-bucket months convention (D3) used by
  // shared.ts/buildMaturityCondition + the client-side calculateMaturityBucket.
  const referenceDate = sql`${filters.dateTo}::timestamp`;
  const monthsSinceLive = sql`EXTRACT(EPOCH FROM (${referenceDate} - ${kioskLiveDateSubquery})) / (30.44 * 86400)`;

  // location_count is intentionally raw — "any location contributing to
  // this bucket" regardless of fee-vs-sales row mix. Revenue uses the
  // mode-specific filter so the avg/total flip with sales/revenue mode.
  const rows = await executeRows<{
    bucket: string;
    location_count: string;
    avg_revenue: string;
    total_revenue: string;
  }>(sql`
    SELECT
      CASE
        WHEN ${monthsSinceLive} < 1 THEN '0-1mo'
        WHEN ${monthsSinceLive} < 3 THEN '1-3mo'
        WHEN ${monthsSinceLive} < 6 THEN '3-6mo'
        WHEN ${monthsSinceLive} < 9 THEN '6-9mo'
        ELSE '9+mo'
      END AS bucket,
      COUNT(DISTINCT ${salesRecords.locationId}) AS location_count,
      COALESCE(SUM(${salesRecords.netAmount}::numeric) FILTER (WHERE ${amountMode}) / NULLIF(COUNT(DISTINCT ${salesRecords.locationId}) FILTER (WHERE ${amountMode}), 0), 0) AS avg_revenue,
      COALESCE(SUM(${salesRecords.netAmount}::numeric) FILTER (WHERE ${amountMode}), 0) AS total_revenue
    FROM ${baseFrom()}
    WHERE ${fullWhere}
    GROUP BY bucket
    ORDER BY bucket
  `);

  // Ensure all 5 buckets are represented (D3).
  const bucketOrder = ["0-1mo", "1-3mo", "3-6mo", "6-9mo", "9+mo"];
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
  const amountMode = buildAmountModeCondition(filters);

  const liveDateCondition = sql`${kioskLiveDateSubquery} IS NOT NULL`;
  const fullWhere = whereClause
    ? sql`${whereClause} AND ${liveDateCondition}`
    : liveDateCondition;

  // Ramp curve buckets each row by months-since-liveDate using the canonical
  // 5-bucket convention (D3). The numeric `monthsSinceInstall` field is the
  // bucket's lower edge, kept on the wire so the chart can plot bucket→avg
  // without re-deriving labels client-side.
  const rows = await executeRows<{
    bucket_index: string;
    avg_revenue: string;
    location_count: string;
  }>(sql`
    SELECT
      CASE
        WHEN EXTRACT(EPOCH FROM (${salesRecords.transactionDate}::timestamp - ${kioskLiveDateSubquery})) / (30.44 * 86400) < 1 THEN 0
        WHEN EXTRACT(EPOCH FROM (${salesRecords.transactionDate}::timestamp - ${kioskLiveDateSubquery})) / (30.44 * 86400) < 3 THEN 1
        WHEN EXTRACT(EPOCH FROM (${salesRecords.transactionDate}::timestamp - ${kioskLiveDateSubquery})) / (30.44 * 86400) < 6 THEN 3
        WHEN EXTRACT(EPOCH FROM (${salesRecords.transactionDate}::timestamp - ${kioskLiveDateSubquery})) / (30.44 * 86400) < 9 THEN 6
        ELSE 9
      END AS bucket_index,
      COALESCE(SUM(${salesRecords.netAmount}::numeric) FILTER (WHERE ${amountMode}) / NULLIF(COUNT(DISTINCT ${salesRecords.locationId}) FILTER (WHERE ${amountMode}), 0), 0) AS avg_revenue,
      COUNT(DISTINCT ${salesRecords.locationId}) AS location_count
    FROM ${baseFrom()}
    WHERE ${fullWhere}
      AND ${salesRecords.transactionDate}::timestamp >= ${kioskLiveDateSubquery}
    GROUP BY bucket_index
    ORDER BY bucket_index
  `);

  // Ensure all 5 canonical buckets are represented (lower-edge as key).
  const bucketIndices = [0, 1, 3, 6, 9];
  const resultMap = new Map(
    rows.map((r) => [
      Number(r.bucket_index),
      {
        monthsSinceInstall: Number(r.bucket_index),
        avgRevenue: Number(r.avg_revenue),
        locationCount: Number(r.location_count),
      },
    ]),
  );

  return bucketIndices.map(
    (i) =>
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
  const amountMode = buildAmountModeCondition(filters);

  const liveDateCondition = sql`${kioskLiveDateSubquery} IS NOT NULL`;
  const fullWhere = whereClause
    ? sql`${whereClause} AND ${liveDateCondition}`
    : liveDateCondition;

  // Calendar months in the selected window (inclusive). A Jan-Dec window
  // is 12; a Jan 1-15 window is 1. The previous query divided by neither,
  // so a 12-month window overstated avg-monthly by 12× (audit Task 2.3).
  const monthsInWindow = monthsBetweenInclusive(filters.dateFrom, filters.dateTo);

  const rows = await executeRows<{
    install_month: string;
    location_count: string;
    avg_monthly_revenue: string;
  }>(sql`
    SELECT
      TO_CHAR(${kioskLiveDateSubquery}, 'YYYY-MM') AS install_month,
      COUNT(DISTINCT ${salesRecords.locationId}) AS location_count,
      COALESCE(
        SUM(${salesRecords.netAmount}::numeric) FILTER (WHERE ${amountMode})
          / NULLIF(COUNT(DISTINCT ${salesRecords.locationId}) FILTER (WHERE ${amountMode}), 0)
          / ${monthsInWindow},
        0
      ) AS avg_monthly_revenue
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
