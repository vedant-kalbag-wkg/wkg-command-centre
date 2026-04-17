import { db } from "@/db";
import { salesRecords, locations, products } from "@/db/schema";
import { sql, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildExclusionCondition,
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import { getPreviousPeriodDates, calculatePercentile, classifyOutletTier } from "@/lib/analytics/metrics";
import type {
  AnalyticsFilters,
  PortfolioSummary,
  CategoryPerformanceRow,
  TopProductRow,
  DailyTrendRow,
  HourlyDistributionRow,
  OutletTierRow,
  PortfolioData,
} from "@/lib/analytics/types";

// ─── Internal: cast db for scopedSalesCondition ──────────────────────────────
// scopedSalesCondition expects NodePgDatabase<any> but our db is postgres-js.
// The internal Drizzle SQL builder API is compatible; cast to satisfy the type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Internal: build WHERE clause for portfolio queries ──────────────────────

async function buildPortfolioWhere(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<SQL | undefined> {
  const [scopeCondition, exclusionCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildExclusionCondition(),
  ]);

  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);
  const maturityCondition = buildMaturityCondition(filters);

  return combineConditions([
    dateCondition,
    scopeCondition,
    exclusionCondition,
    maturityCondition,
    ...dimensionConditions,
  ]);
}

// All portfolio queries JOIN locations for exclusion filtering (outlet_code).
// The exclusion condition references locations.outletCode, so we always need
// the JOIN even when the query doesn't otherwise use locations columns.

function baseFrom(): SQL {
  return sql`${salesRecords}
    INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}`;
}

function baseFromWithProducts(): SQL {
  return sql`${salesRecords}
    INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
    INNER JOIN ${products} ON ${salesRecords.productId} = ${products.id}`;
}

// ─── 1. Portfolio Summary ────────────────────────────────────────────────────

export async function getPortfolioSummary(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<PortfolioSummary> {
  const whereClause = await buildPortfolioWhere(filters, userCtx);

  const rows = await db.execute<{
    total_revenue: string;
    total_transactions: string;
    total_quantity: string;
    unique_products: string;
    unique_outlets: string;
  }>(sql`
    SELECT
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS total_revenue,
      COUNT(*)::text AS total_transactions,
      COALESCE(SUM(${salesRecords.quantity}), 0)::text AS total_quantity,
      COUNT(DISTINCT ${salesRecords.productId})::text AS unique_products,
      COUNT(DISTINCT ${salesRecords.locationId})::text AS unique_outlets
    FROM ${baseFrom()}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
  `);

  const row = rows[0]!;
  const totalRevenue = Number(row.total_revenue);
  const totalTransactions = Number(row.total_transactions);

  return {
    totalRevenue,
    totalTransactions,
    totalQuantity: Number(row.total_quantity),
    avgBasketValue: totalTransactions > 0 ? totalRevenue / totalTransactions : 0,
    uniqueProducts: Number(row.unique_products),
    uniqueOutlets: Number(row.unique_outlets),
  };
}

// ─── 2. Category Performance ─────────────────────────────────────────────────

export async function getCategoryPerformance(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<CategoryPerformanceRow[]> {
  const whereClause = await buildPortfolioWhere(filters, userCtx);

  const rows = await db.execute<{
    category_name: string;
    revenue: string;
    transactions: string;
    quantity: string;
    avg_value: string;
  }>(sql`
    SELECT
      ${products.name} AS category_name,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions,
      COALESCE(SUM(${salesRecords.quantity}), 0)::text AS quantity,
      COALESCE(AVG(${salesRecords.grossAmount}), 0) AS avg_value
    FROM ${baseFromWithProducts()}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${products.name}
    ORDER BY revenue DESC
  `);

  return rows.map((row) => ({
    categoryName: row.category_name,
    revenue: Number(row.revenue),
    transactions: Number(row.transactions),
    quantity: Number(row.quantity),
    avgValue: Number(row.avg_value),
  }));
}

// ─── 3. Top Products ─────────────────────────────────────────────────────────

export async function getTopProducts(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
  limit = 20,
): Promise<TopProductRow[]> {
  const whereClause = await buildPortfolioWhere(filters, userCtx);

  const rows = await db.execute<{
    product_name: string;
    revenue: string;
    transactions: string;
    quantity: string;
  }>(sql`
    SELECT
      ${products.name} AS product_name,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions,
      COALESCE(SUM(${salesRecords.quantity}), 0)::text AS quantity
    FROM ${baseFromWithProducts()}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${products.name}
    ORDER BY revenue DESC
    LIMIT ${limit}
  `);

  return rows.map((row, idx) => ({
    rank: idx + 1,
    productName: row.product_name,
    categoryName: row.product_name, // products table has no category — product name IS the category
    revenue: Number(row.revenue),
    transactions: Number(row.transactions),
    quantity: Number(row.quantity),
  }));
}

// ─── 4. Daily Trends ─────────────────────────────────────────────────────────

export async function getDailyTrends(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<DailyTrendRow[]> {
  const whereClause = await buildPortfolioWhere(filters, userCtx);

  const rows = await db.execute<{
    date: string;
    revenue: string;
    transactions: string;
  }>(sql`
    SELECT
      ${salesRecords.transactionDate}::text AS date,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions
    FROM ${baseFrom()}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${salesRecords.transactionDate}
    ORDER BY ${salesRecords.transactionDate} ASC
  `);

  return rows.map((row) => ({
    date: row.date,
    revenue: Number(row.revenue),
    transactions: Number(row.transactions),
  }));
}

// ─── 5. Hourly Distribution ──────────────────────────────────────────────────

export async function getHourlyDistribution(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<HourlyDistributionRow[]> {
  const baseWhere = await buildPortfolioWhere(filters, userCtx);
  const timeNotNull = sql`${salesRecords.transactionTime} IS NOT NULL`;
  const whereClause = combineConditions([baseWhere, timeNotNull]);

  const rows = await db.execute<{
    hour: string;
    revenue: string;
    transactions: string;
  }>(sql`
    SELECT
      EXTRACT(HOUR FROM ${salesRecords.transactionTime})::int::text AS hour,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions
    FROM ${baseFrom()}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY EXTRACT(HOUR FROM ${salesRecords.transactionTime})
    ORDER BY hour ASC
  `);

  return rows.map((row) => ({
    hour: Number(row.hour),
    revenue: Number(row.revenue),
    transactions: Number(row.transactions),
  }));
}

// ─── 6. Outlet Tiers ─────────────────────────────────────────────────────────

export async function getOutletTiers(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<OutletTierRow[]> {
  const whereClause = await buildPortfolioWhere(filters, userCtx);

  const rawRows = await db.execute<{
    location_id: string;
    outlet_code: string;
    hotel_name: string;
    live_date: string | null;
    revenue: string;
    transactions: string;
  }>(sql`
    SELECT
      ${locations.id} AS location_id,
      COALESCE(${locations.outletCode}, '') AS outlet_code,
      ${locations.name} AS hotel_name,
      ${locations.liveDate}::text AS live_date,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions
    FROM ${baseFrom()}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${locations.id}, ${locations.outletCode}, ${locations.name}, ${locations.liveDate}
    ORDER BY revenue DESC
  `);

  const parsed = rawRows.map((row) => ({
    locationId: row.location_id,
    outletCode: row.outlet_code,
    hotelName: row.hotel_name,
    liveDate: row.live_date,
    revenue: Number(row.revenue),
    transactions: Number(row.transactions),
  }));

  // Calculate total revenue for share percentages
  const totalRevenue = parsed.reduce((sum, r) => sum + r.revenue, 0);
  const allRevenues = parsed.map((r) => r.revenue);

  return parsed.map((row) => {
    const percentile = calculatePercentile(row.revenue, allRevenues);
    return {
      locationId: row.locationId,
      outletCode: row.outletCode,
      hotelName: row.hotelName,
      liveDate: row.liveDate,
      revenue: row.revenue,
      transactions: row.transactions,
      percentile,
      sharePercentage: totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0,
      tier: classifyOutletTier(percentile),
    };
  });
}

// ─── 7. Orchestrator ─────────────────────────────────────────────────────────

export async function getPortfolioData(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<PortfolioData> {
  const { prevFrom, prevTo } = getPreviousPeriodDates(filters.dateFrom, filters.dateTo);
  const previousFilters: AnalyticsFilters = {
    ...filters,
    dateFrom: prevFrom,
    dateTo: prevTo,
  };

  const [
    summary,
    previousSummary,
    categoryPerformance,
    topProducts,
    dailyTrends,
    hourlyDistribution,
    outletTiers,
  ] = await Promise.all([
    getPortfolioSummary(filters, userCtx),
    getPortfolioSummary(previousFilters, userCtx).catch(() => null),
    getCategoryPerformance(filters, userCtx),
    getTopProducts(filters, userCtx),
    getDailyTrends(filters, userCtx),
    getHourlyDistribution(filters, userCtx),
    getOutletTiers(filters, userCtx),
  ]);

  return {
    summary,
    previousSummary,
    categoryPerformance,
    topProducts,
    dailyTrends,
    hourlyDistribution,
    outletTiers,
  };
}
