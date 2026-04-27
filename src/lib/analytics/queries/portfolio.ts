import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import { salesRecords, locations, products } from "@/db/schema";
import { sql, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  activeKioskCountFragment,
  buildAmountModeCondition,
  buildDateCondition,
  buildDimensionFilters,
  buildIsFeeCondition,
  buildMaturityCondition,
  buildNonFeeCondition,
  buildSalesTxnCondition,
  canonicalHotelGroupNameFragment,
  combineConditions,
  kioskLiveDateSubquery,
} from "@/lib/analytics/queries/shared";
import { buildActiveLocationCondition } from "@/lib/analytics/active-locations";
import { wrapAnalyticsQuery } from "@/lib/analytics/cached-query";
import { getAnalyticsDisplayTimezone } from "@/lib/analytics/display-timezone-server";
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

  // Note: metricMode (sales | revenue) is NOT part of the universal where —
  // it's applied per-aggregate via FILTER clauses below, so a single query
  // can return mode-invariant counts (always non-fee + non-reversal, per D1)
  // alongside mode-dependent SUMs (sales: non-fee total; revenue: fee total).
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
  const amountMode = buildAmountModeCondition(filters);
  const salesTxn = buildSalesTxnCondition();

  const rows = await executeRows<{
    total_revenue: string;
    total_transactions: string;
    total_quantity: string;
    unique_products: string;
    unique_outlets: string;
  }>(sql`
    SELECT
      COALESCE(SUM(${salesRecords.netAmount}) FILTER (WHERE ${amountMode}), 0) AS total_revenue,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS total_transactions,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS total_quantity,
      COUNT(DISTINCT ${salesRecords.productId}) FILTER (WHERE ${salesTxn})::text AS unique_products,
      COUNT(DISTINCT ${salesRecords.locationId}) FILTER (WHERE ${salesTxn})::text AS unique_outlets
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
  // Task 4.1 / PR-23 — two P1 fixes from the analytics audit:
  //   (1) GROUP BY products.category_name (not products.name) so each bar is a
  //       category, not a product. ~19 products lack a category_name (NetSuite
  //       ETL coverage is 100/119 ≈ 98.9% of sales rows); render the gap as
  //       an explicit "— Uncategorised" bucket so analysts notice rather than
  //       silently merging into a random other category.
  //   (2) Exclude fee rows in WHERE via buildNonFeeCondition(). Without this,
  //       the "Booking Fee" / "Cash Handling Fee" pseudo-products dominate.
  // Trade-off: the SUM/AVG no longer carry FILTER (WHERE amountMode). In
  // revenue mode amountMode = is_weknow_fee=true, which combined with the new
  // is_weknow_fee=false WHERE would zero out the chart. Top Products handles
  // the "fee revenue attributed to parent product" case via a LATERAL
  // self-join, but that pattern is out of scope here — Category Performance
  // becomes always-non-fee revenue per category. The useMetricLabel consumer
  // label still flips Sales/Revenue but the data stays non-fee. P2 audit
  // items (quantity redundant, avg_value per-row not avg basket) are
  // intentionally left alone — see ANALYTICS-ISSUES.md lines 332-338.
  const whereClause = combineConditions([
    await buildPortfolioWhere(filters, userCtx),
    buildNonFeeCondition(),
  ]);
  const salesTxn = buildSalesTxnCondition();

  const rows = await executeRows<{
    category_name: string;
    revenue: string;
    transactions: string;
    quantity: string;
    avg_value: string;
  }>(sql`
    SELECT
      COALESCE(${products.categoryName}, '— Uncategorised') AS category_name,
      COALESCE(SUM(${salesRecords.netAmount}), 0) AS revenue,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS quantity,
      COALESCE(AVG(${salesRecords.netAmount}), 0) AS avg_value
    FROM ${baseFromWithProducts()}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY COALESCE(${products.categoryName}, '— Uncategorised')
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
  // Two shapes here, driven by metricMode:
  //
  //  Sales mode  — rank products by their principal sales (NOT fees). Fee
  //                rows ("Booking Fee" / "Cash Handling Fee") are not
  //                products and dominate by transaction count, so they're
  //                excluded unconditionally. Use buildPortfolioWhere with
  //                metricMode forced to "sales" + the non-fee predicate.
  //
  //  Revenue mode — rank products by the fee revenue *they drove*. NetSuite
  //                emits fee rows with ref_no='<parentRef>-b' and a generic
  //                product name ("Booking Fee" / "Cash Handling Fee"). To
  //                attribute a fee to the thing the customer actually bought
  //                we self-join: strip the '-b' suffix, find the parent sale
  //                row in the SAME region (any one — a sale/reversal pair
  //                both carry the same product), and group by the parent's
  //                product name. Region-scoping the join is essential:
  //                outlet codes repeat across regions, but ref_no is
  //                region-unique.
  if (filters.metricMode === "revenue") {
    const baseWhere = await buildPortfolioWhere(filters, userCtx);
    // Outer scope: fee rows only (revenue mode). Fee rows are not reversed in
    // practice (probe-confirmed against prod), so no extra reversal predicate.
    const whereClause = combineConditions([baseWhere, buildIsFeeCondition()]);

    // Leave the outer sales_records unaliased so the shared WHERE helpers
    // (which emit "sales_records"."..." refs) resolve cleanly. The LATERAL
    // subquery uses its own explicit alias for the parent-side self-join.
    const rows = await executeRows<{
      product_name: string;
      revenue: string;
      transactions: string;
      quantity: string;
    }>(sql`
      -- Outer WHERE already restricts to fee rows (revenue mode); raw COUNT(*)
      -- here counts fee events attributed to the parent product.
      SELECT
        p.name AS product_name,
        COALESCE(SUM(${salesRecords.netAmount}), 0) AS revenue,
        COUNT(*)::text AS transactions,
        COUNT(*)::text AS quantity
      FROM ${salesRecords}
      CROSS JOIN LATERAL (
        SELECT parent.product_id
        FROM ${salesRecords} AS parent
        WHERE parent.region_id = ${salesRecords.regionId}
          AND parent.ref_no = REGEXP_REPLACE(${salesRecords.refNo}, '-b$', '')
          AND parent.is_weknow_fee = false
        LIMIT 1
      ) AS parent_one
      INNER JOIN ${products} AS p ON p.id = parent_one.product_id
      ${whereClause ? sql`WHERE ${whereClause}` : sql``}
      GROUP BY p.name
      ORDER BY revenue DESC
      LIMIT ${limit}
    `);

    return rows.map((row, idx) => ({
      rank: idx + 1,
      productName: row.product_name,
      categoryName: row.product_name,
      revenue: Number(row.revenue),
      transactions: Number(row.transactions),
      quantity: Number(row.quantity),
    }));
  }

  const baseWhere = await buildPortfolioWhere(filters, userCtx);
  // Sales-mode top products: non-fee, non-reversal rows only — fees aren't
  // products and reversal rows would double-count.
  const whereClause = combineConditions([baseWhere, buildSalesTxnCondition()]);

  const rows = await executeRows<{
    product_name: string;
    revenue: string;
    transactions: string;
    quantity: string;
  }>(sql`
    -- Outer WHERE already restricts to non-fee, non-reversal rows (sales-mode
    -- top products); raw COUNT(*) here counts product transactions.
    SELECT
      ${products.name} AS product_name,
      COALESCE(SUM(${salesRecords.netAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions,
      COUNT(*)::text AS quantity
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
  const amountMode = buildAmountModeCondition(filters);
  const salesTxn = buildSalesTxnCondition();

  const rows = await executeRows<{
    date: string;
    revenue: string;
    transactions: string;
  }>(sql`
    SELECT
      ${salesRecords.transactionDate}::text AS date,
      COALESCE(SUM(${salesRecords.netAmount}) FILTER (WHERE ${amountMode}), 0) AS revenue,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions
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

/**
 * D6 / Task 2.12 — bucket sales by the local hour at each property.
 *
 * Per-row timezone resolution:
 *   transaction_time is a naïve `time` (no zone) and transaction_date is a
 *   plain `date`. The NetSuite/CMS ETL writes them as UTC instants without
 *   tagging. We reconstruct the moment with `(date + time) AT TIME ZONE
 *   'UTC'` to get a `timestamptz`, then convert into the local zone with a
 *   second `AT TIME ZONE`. The two-step idiom is required because Postgres
 *   has no `timestamp + zone → timestamptz` conversion that takes a
 *   variable target zone; you have to land in `timestamptz` first.
 *
 * Display mode:
 *   When the admin setting `analytics_display_timezone` is `'local'`
 *   (default) we group by `locations.iana_timezone` per row. When set to
 *   `'utc'` we group by the constant `'UTC'`, matching the pre-D6 naïve
 *   behaviour for debugging. Either way we JOIN locations so the SQL shape
 *   stays identical and the planner can use the same plan; the cost of the
 *   join is negligible against the active-location predicate's covering
 *   index hit.
 */
export async function getHourlyDistribution(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<HourlyDistributionRow[]> {
  const [baseWhere, displayTz] = await Promise.all([
    buildPortfolioWhere(filters, userCtx),
    getAnalyticsDisplayTimezone(),
  ]);
  const timeNotNull = sql`${salesRecords.transactionTime} IS NOT NULL`;
  const whereClause = combineConditions([baseWhere, timeNotNull]);
  const amountMode = buildAmountModeCondition(filters);
  const salesTxn = buildSalesTxnCondition();

  // Pick the target-zone SQL expression once. `'UTC'::text` is a constant,
  // `locations.iana_timezone` is per-row.
  const targetZoneExpr =
    displayTz === "utc" ? sql`'UTC'` : sql`${locations.ianaTimezone}`;
  const localHourExpr = sql`EXTRACT(HOUR FROM
    ((${salesRecords.transactionDate} + ${salesRecords.transactionTime}) AT TIME ZONE 'UTC')
    AT TIME ZONE ${targetZoneExpr}
  )`;

  const rows = await executeRows<{
    hour: string;
    revenue: string;
    transactions: string;
  }>(sql`
    SELECT
      ${localHourExpr}::int::text AS hour,
      COALESCE(SUM(${salesRecords.netAmount}) FILTER (WHERE ${amountMode}), 0) AS revenue,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions
    FROM ${baseFromWithLocations()}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${localHourExpr}
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
  const amountMode = buildAmountModeCondition(filters);
  const salesTxn = buildSalesTxnCondition();

  // Property-level enrichment (Phase 4.2):
  //   hotel_group_name — canonical group, tie-broken to exactly one. Uses
  //     locations.operating_group_id when set, else MIN(hotel_group_id) from
  //     location_hotel_group_memberships, else NULL. Single correlated
  //     subquery fragment — see canonicalHotelGroupNameFragment.
  //   kiosk_count — active kiosks on the property (unassigned_at IS NULL).
  //   num_rooms — locations.num_rooms (nullable).
  // num_rooms must also appear in GROUP BY because it's in SELECT without an
  // aggregate. The correlated subqueries don't need to — they're scalar per
  // row.
  const rawRows = await executeRows<{
    location_id: string;
    outlet_code: string;
    hotel_name: string;
    live_date: string | null;
    hotel_group_name: string | null;
    kiosk_count: number;
    num_rooms: number | null;
    revenue: string;
    transactions: string;
  }>(sql`
    SELECT
      ${locations.id} AS location_id,
      COALESCE(${locations.outletCode}, '') AS outlet_code,
      ${locations.name} AS hotel_name,
      ${kioskLiveDateSubquery}::text AS live_date,
      ${canonicalHotelGroupNameFragment()} AS hotel_group_name,
      ${activeKioskCountFragment()} AS kiosk_count,
      ${locations.numRooms} AS num_rooms,
      COALESCE(SUM(${salesRecords.netAmount}) FILTER (WHERE ${amountMode}), 0) AS revenue,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions
    FROM ${baseFromWithLocations()}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${locations.id}, ${locations.outletCode}, ${locations.name}, ${locations.numRooms}
    ORDER BY revenue DESC
    LIMIT 200
  `);

  const parsed = rawRows.map((row) => {
    // Postgres returns integers as JS number already, but coerce defensively
    // in case the driver ever flips to strings — undefined would silently
    // pass the `numRooms > 0` check and produce NaN.
    const kioskCount = Number(row.kiosk_count);
    const numRooms = row.num_rooms === null ? null : Number(row.num_rooms);
    return {
      locationId: row.location_id,
      outletCode: row.outlet_code,
      hotelName: row.hotel_name,
      liveDate: row.live_date,
      hotelGroupName: row.hotel_group_name,
      kioskCount,
      numRooms,
      revenue: Number(row.revenue),
      transactions: Number(row.transactions),
    };
  });

  const totalRevenue = parsed.reduce((sum, r) => sum + r.revenue, 0);
  const sortedRevenues = parsed.map((r) => r.revenue).sort((a, b) => a - b);

  return parsed.map((row) => {
    const rank = binarySearchRank(row.revenue, sortedRevenues);
    const percentile = sortedRevenues.length > 0 ? (rank / sortedRevenues.length) * 100 : 0;
    // Null out per-unit ratios when the denominator is missing or zero; the UI
    // renders those as "—" rather than crunching Infinity/NaN.
    const revenuePerKiosk = row.kioskCount > 0 ? row.revenue / row.kioskCount : null;
    const revenuePerRoom =
      row.numRooms !== null && row.numRooms > 0 ? row.revenue / row.numRooms : null;
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
      hotelGroupName: row.hotelGroupName,
      kioskCount: row.kioskCount,
      numRooms: row.numRooms,
      revenuePerKiosk,
      revenuePerRoom,
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
