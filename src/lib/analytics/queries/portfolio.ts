import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import { salesRecords, locations, products } from "@/db/schema";
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
import { getComparisonDates, classifyOutletTier } from "@/lib/analytics/metrics";
import type {
  AnalyticsFilters,
  ComparisonMode,
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
  // Phase 1 #6: `buildActiveLocationCondition` replaces
  // `buildExclusionCondition` + the INNER JOIN on locations with a
  // `location_id = ANY($1::uuid[])` predicate. The predicate hits the
  // sales_records covering index (index-only scan) and the active ID list is
  // React.cache'd per request.
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

// Portfolio queries that only used the locations JOIN for outlet_code
// exclusion can now read straight from sales_records: the active-location
// predicate replaces the exclusion filter. Queries that still need location
// columns in SELECT/GROUP BY (e.g. getOutletTiers) keep the JOIN.

function baseFrom(): SQL {
  return sql`${salesRecords}`;
}

function baseFromWithProducts(): SQL {
  return sql`${salesRecords}
    INNER JOIN ${products} ON ${salesRecords.productId} = ${products.id}`;
}

// Outlet-tier aggregation still needs locations.name / outlet_code / id in
// the SELECT, so it keeps the JOIN. The active-location predicate in
// buildPortfolioWhere lets the planner filter sales_records first (via the
// covering index) before joining, so the extra JOIN is cheap.
function baseFromWithLocations(): SQL {
  return sql`${salesRecords}
    INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}`;
}

// ─── 1. Portfolio Summary ────────────────────────────────────────────────────

export async function getPortfolioSummary(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<PortfolioSummary> {
  const whereClause = await buildPortfolioWhere(filters, userCtx);

  const rows = await executeRows<{
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

  const rows = await executeRows<{
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

  const rows = await executeRows<{
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

  const rows = await executeRows<{
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

  const rows = await executeRows<{
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

  const rawRows = await executeRows<{
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
      ${kioskLiveDateSubquery}::text AS live_date,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions
    FROM ${baseFromWithLocations()}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${locations.id}, ${locations.outletCode}, ${locations.name}
    ORDER BY revenue DESC
    LIMIT 200
  `);

  const parsed = rawRows.map((row) => ({
    locationId: row.location_id,
    outletCode: row.outlet_code,
    hotelName: row.hotel_name,
    liveDate: row.live_date,
    revenue: Number(row.revenue),
    transactions: Number(row.transactions),
  }));

  const totalRevenue = parsed.reduce((sum, r) => sum + r.revenue, 0);
  const sortedRevenues = parsed.map((r) => r.revenue).sort((a, b) => a - b);

  return parsed.map((row) => {
    const rank = binarySearchRank(row.revenue, sortedRevenues);
    const percentile = sortedRevenues.length > 0 ? (rank / sortedRevenues.length) * 100 : 0;
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

function binarySearchRank(value: number, sorted: number[]): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ─── 7. Orchestrator ─────────────────────────────────────────────────────────

export async function getPortfolioData(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
  comparison: ComparisonMode = "mom",
): Promise<PortfolioData> {
  const { prevFrom, prevTo } = getComparisonDates(filters.dateFrom, filters.dateTo, comparison);
  const previousFilters: AnalyticsFilters = {
    ...filters,
    dateFrom: prevFrom,
    dateTo: prevTo,
  };

  // F.2: Previously each sub-query silently swallowed errors via
  // `.catch(() => [])` / `.catch(() => null)`, which rendered failed sections
  // as empty charts with no signal to operators. We now log the error
  // server-side (so failures are observable in logs/monitoring) but still
  // return an empty fallback so a single broken sub-query doesn't nuke the
  // entire portfolio dashboard. A follow-up (F.2b) can propagate structured
  // error shapes into the UI for per-ChartCard error states.
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
    getPortfolioSummary(previousFilters, userCtx).catch((err) => {
      console.error('[portfolio] sub-query "previousSummary" failed:', err);
      return null;
    }),
    getCategoryPerformance(filters, userCtx).catch((err) => {
      console.error('[portfolio] sub-query "categoryPerformance" failed:', err);
      return [] as CategoryPerformanceRow[];
    }),
    getTopProducts(filters, userCtx).catch((err) => {
      console.error('[portfolio] sub-query "topProducts" failed:', err);
      return [] as TopProductRow[];
    }),
    getDailyTrends(filters, userCtx).catch((err) => {
      console.error('[portfolio] sub-query "dailyTrends" failed:', err);
      return [] as DailyTrendRow[];
    }),
    getHourlyDistribution(filters, userCtx).catch((err) => {
      console.error('[portfolio] sub-query "hourlyDistribution" failed:', err);
      return [] as HourlyDistributionRow[];
    }),
    getOutletTiers(filters, userCtx).catch((err) => {
      console.error('[portfolio] sub-query "outletTiers" failed:', err);
      return [] as OutletTierRow[];
    }),
  ]);

  return {
    summary,
    previousSummary,
    comparisonMode: comparison,
    categoryPerformance,
    topProducts,
    dailyTrends,
    hourlyDistribution,
    outletTiers,
  };
}

// ─── Cached variants (Phase 3) ───────────────────────────────────────────────
//
// Wrap each portfolio query with unstable_cache via wrapAnalyticsQuery.
// Cache key = ['analytics', <name>, 'v1'] + JSON.stringify(canonicalFilters, scopeKey, ...rest).
// TTL = 24h, aligned with overnight UK ETL.
// Tags: ['analytics', 'analytics:portfolio'] — invalidate via /admin/cache (Stage 4).
//
// Existing uncached exports above remain callable for the legacy server-action
// path (fetchPortfolioData) and the in-page orchestrator (getPortfolioData).

const PORTFOLIO_TAGS = ['analytics', 'analytics:portfolio'];

export const getPortfolioSummaryCached = wrapAnalyticsQuery(getPortfolioSummary, {
  name: 'getPortfolioSummary',
  tags: PORTFOLIO_TAGS,
});

export const getCategoryPerformanceCached = wrapAnalyticsQuery(getCategoryPerformance, {
  name: 'getCategoryPerformance',
  tags: PORTFOLIO_TAGS,
});

export const getTopProductsCached = wrapAnalyticsQuery(getTopProducts, {
  name: 'getTopProducts',
  tags: PORTFOLIO_TAGS,
});

export const getDailyTrendsCached = wrapAnalyticsQuery(getDailyTrends, {
  name: 'getDailyTrends',
  tags: PORTFOLIO_TAGS,
});

export const getHourlyDistributionCached = wrapAnalyticsQuery(getHourlyDistribution, {
  name: 'getHourlyDistribution',
  tags: PORTFOLIO_TAGS,
});

export const getOutletTiersCached = wrapAnalyticsQuery(getOutletTiers, {
  name: 'getOutletTiers',
  tags: PORTFOLIO_TAGS,
});
