import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import {
  salesRecords,
  locations,
  locationHotelGroupMemberships,
  hotelGroups,
} from "@/db/schema";
import { sql, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  activeKioskCountFragment,
  buildAmountModeCondition,
  buildExclusionCondition,
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  buildSalesTxnCondition,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import { wrapAnalyticsQuery } from "@/lib/analytics/cached-query";
import { getPreviousPeriodDates, calculatePeriodChange } from "@/lib/analytics/metrics";
import type {
  AnalyticsFilters,
  HotelGroupData,
  HotelGroupDetail,
  HotelInGroup,
  DailyTrendRow,
} from "@/lib/analytics/types";

// ─── Internal: cast db for scopedSalesCondition ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Internal: build WHERE clause ───────────────────────────────────────────

async function buildHotelGroupWhere(
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

  // metricMode applied per-aggregate via FILTER (D1 — counts mode-invariant).
  return combineConditions([
    dateCondition,
    scopeCondition,
    exclusionCondition,
    maturityCondition,
    ...dimensionConditions,
  ]);
}

// ─── Internal: base FROM (sales + locations only, no membership join) ──────
//
// Used by:
//   - getHotelGroupsList: pre-aggregates sales_records by location_id in a
//     CTE BEFORE joining location_hotel_group_memberships. The membership
//     join is many-to-many (a location can belong to multiple hotel groups),
//     so joining first explodes the working set from ~124k rows to ~148k
//     and forces a 9 MB external merge sort on the outer
//     COUNT(DISTINCT location_id). Pre-aggregating collapses 124k rows to
//     ~200 (one per location) — the membership fan-out then happens at
//     ~200→~240 rows, and the outer GROUP BY hotel_group sorts ~240 rows
//     in memory. See Phase 1 diagnosis #8.
//   - getHotelGroupDetail (D5 Part E): pairs with the EXISTS predicate from
//     inSelectedHotelGroupsCondition. Hotel groups are N:N with locations
//     (Resolved Decision D5); joining through
//     location_hotel_group_memberships fans a multi-group location's sales
//     out across each matching membership and double-counts them in the
//     detail's summary, hotel breakdown, and daily trend. EXISTS qualifies
//     each sales row exactly once regardless of how many groups in the
//     selected IN list the location belongs to.
function baseFromLocationsOnly(): SQL {
  return sql`${salesRecords}
    INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}`;
}

function inSelectedHotelGroupsCondition(idList: SQL): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${locationHotelGroupMemberships}
    WHERE ${locationHotelGroupMemberships.locationId} = ${salesRecords.locationId}
      AND ${locationHotelGroupMemberships.hotelGroupId} IN ${idList}
  )`;
}

// ─── 1. Hotel Groups List ───────────────────────────────────────────────────

export async function getHotelGroupsList(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<HotelGroupData[]> {
  const whereClause = await buildHotelGroupWhere(filters, userCtx);
  const amountMode = buildAmountModeCondition(filters);
  const salesTxn = buildSalesTxnCondition();

  // Current period — pre-aggregate by location in a CTE, then join memberships
  // + hotel_groups. The inner aggregate keeps every filter the original query
  // applied (they all reference salesRecords/locations columns, not hotel
  // group columns), so the result set is semantically identical:
  //
  //   outer revenue      = SUM(per-location revenue) per hotel_group
  //                      = SUM(sales_records.net_amount) per hotel_group
  //   outer transactions = SUM(per-location txn count) per hotel_group
  //                      = COUNT(*) of sales_records per hotel_group
  //   outer hotel_count  = COUNT(DISTINCT per-location rows) per hotel_group
  //                      = COUNT(DISTINCT sales_records.location_id) per hotel_group
  //
  // The (location_id, hotel_group_id) PK on location_hotel_group_memberships
  // guarantees the outer membership join doesn't multi-count a location
  // within the same group.
  const rows = await executeRows<{
    group_id: string;
    group_name: string;
    revenue: string;
    transactions: string;
    hotel_count: string;
  }>(sql`
    WITH loc_agg AS (
      SELECT
        ${salesRecords.locationId} AS location_id,
        COALESCE(SUM(${salesRecords.netAmount}) FILTER (WHERE ${amountMode}), 0) AS revenue,
        COUNT(*) FILTER (WHERE ${salesTxn}) AS transactions
      FROM ${baseFromLocationsOnly()}
      ${whereClause ? sql`WHERE ${whereClause}` : sql``}
      GROUP BY ${salesRecords.locationId}
    )
    SELECT
      ${hotelGroups.id} AS group_id,
      ${hotelGroups.name} AS group_name,
      COALESCE(SUM(la.revenue), 0) AS revenue,
      SUM(la.transactions)::text AS transactions,
      COUNT(DISTINCT la.location_id)::text AS hotel_count
    FROM loc_agg la
    INNER JOIN ${locationHotelGroupMemberships}
      ON la.location_id = ${locationHotelGroupMemberships.locationId}
    INNER JOIN ${hotelGroups}
      ON ${locationHotelGroupMemberships.hotelGroupId} = ${hotelGroups.id}
    GROUP BY ${hotelGroups.id}, ${hotelGroups.name}
    ORDER BY revenue DESC
  `);

  // Previous period
  const { prevFrom, prevTo } = getPreviousPeriodDates(filters.dateFrom, filters.dateTo);
  const prevFilters: AnalyticsFilters = { ...filters, dateFrom: prevFrom, dateTo: prevTo };
  const prevWhereClause = await buildHotelGroupWhere(prevFilters, userCtx);

  const prevRows = await executeRows<{
    group_id: string;
    revenue: string;
    transactions: string;
  }>(sql`
    WITH loc_agg AS (
      SELECT
        ${salesRecords.locationId} AS location_id,
        COALESCE(SUM(${salesRecords.netAmount}) FILTER (WHERE ${amountMode}), 0) AS revenue,
        COUNT(*) FILTER (WHERE ${salesTxn}) AS transactions
      FROM ${baseFromLocationsOnly()}
      ${prevWhereClause ? sql`WHERE ${prevWhereClause}` : sql``}
      GROUP BY ${salesRecords.locationId}
    )
    SELECT
      ${locationHotelGroupMemberships.hotelGroupId} AS group_id,
      COALESCE(SUM(la.revenue), 0) AS revenue,
      SUM(la.transactions)::text AS transactions
    FROM loc_agg la
    INNER JOIN ${locationHotelGroupMemberships}
      ON la.location_id = ${locationHotelGroupMemberships.locationId}
    GROUP BY ${locationHotelGroupMemberships.hotelGroupId}
  `);

  const prevMap = new Map(
    prevRows.map((r) => [r.group_id, { revenue: Number(r.revenue), transactions: Number(r.transactions) }]),
  );

  return rows.map((row) => {
    const revenue = Number(row.revenue);
    const transactions = Number(row.transactions);
    const prev = prevMap.get(row.group_id);

    return {
      id: row.group_id,
      name: row.group_name,
      revenue,
      transactions,
      hotelCount: Number(row.hotel_count),
      revenueChange: prev ? calculatePeriodChange(revenue, prev.revenue) : null,
      transactionChange: prev ? calculatePeriodChange(transactions, prev.transactions) : null,
    };
  });
}

// ─── 2. Hotel Group Detail ──────────────────────────────────────────────────

export async function getHotelGroupDetail(
  groupIds: string[],
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<HotelGroupDetail> {
  const whereClause = await buildHotelGroupWhere(filters, userCtx);
  const idList = sql.raw(`(${groupIds.map((id) => `'${id}'`).join(",")})`);
  // D5 Part E — replaces the previous `hotel_groups.id IN (...)` filter that
  // sat on top of an INNER JOIN through location_hotel_group_memberships.
  // EXISTS dedupes per-location sales across multiple selected groups; see
  // inSelectedHotelGroupsCondition.
  const groupMembershipFilter = inSelectedHotelGroupsCondition(idList);
  const fullWhere = combineConditions([whereClause, groupMembershipFilter]);
  const amountMode = buildAmountModeCondition(filters);
  const salesTxn = buildSalesTxnCondition();

  // Summary metrics
  const summaryRows = await executeRows<{
    revenue: string;
    transactions: string;
    hotel_count: string;
  }>(sql`
    SELECT
      COALESCE(SUM(${salesRecords.netAmount}) FILTER (WHERE ${amountMode}), 0) AS revenue,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions,
      COUNT(DISTINCT ${salesRecords.locationId}) FILTER (WHERE ${salesTxn})::text AS hotel_count
    FROM ${baseFromLocationsOnly()}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
  `);

  const summary = summaryRows[0]!;
  const revenue = Number(summary.revenue);
  const transactions = Number(summary.transactions);
  const hotelCount = Number(summary.hotel_count);

  // Hotel breakdown — one row per location regardless of how many of the
  // selected hotel groups it belongs to (EXISTS, not JOIN).
  const hotelRows = await executeRows<{
    location_id: string;
    outlet_code: string;
    hotel_name: string;
    revenue: string;
    transactions: string;
    rooms: string | null;
    kiosks: string | null;
    star_rating: string | null;
  }>(sql`
    SELECT
      ${salesRecords.locationId} AS location_id,
      -- Phase 07-06 — surface customer_code under the existing outlet_code
      -- output column name (UI label "Outlet Code" stays).
      COALESCE(${locations.customerCode}, '') AS outlet_code,
      ${locations.name} AS hotel_name,
      COALESCE(SUM(${salesRecords.netAmount}) FILTER (WHERE ${amountMode}), 0) AS revenue,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions,
      ${locations.numRooms}::text AS rooms,
      ${activeKioskCountFragment()}::text AS kiosks,
      ${locations.starRating}::text AS star_rating
    FROM ${baseFromLocationsOnly()}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
    GROUP BY ${salesRecords.locationId}, ${locations.customerCode}, ${locations.name}, ${locations.numRooms}, ${locations.starRating}
    ORDER BY revenue DESC
  `);

  const hotels: HotelInGroup[] = hotelRows.map((row) => {
    const hotelRevenue = Number(row.revenue);
    const rooms = row.rooms ? Number(row.rooms) : null;
    return {
      locationId: row.location_id,
      outletCode: row.outlet_code,
      hotelName: row.hotel_name,
      revenue: hotelRevenue,
      transactions: Number(row.transactions),
      rooms,
      kiosks: row.kiosks ? Number(row.kiosks) : null,
      starRating: row.star_rating ? Number(row.star_rating) : null,
      revenuePerRoom: rooms && rooms > 0 ? hotelRevenue / rooms : null,
    };
  });

  // Daily trends
  const trendRows = await executeRows<{
    date: string;
    revenue: string;
    transactions: string;
  }>(sql`
    SELECT
      ${salesRecords.transactionDate}::text AS date,
      COALESCE(SUM(${salesRecords.netAmount}) FILTER (WHERE ${amountMode}), 0) AS revenue,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions
    FROM ${baseFromLocationsOnly()}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
    GROUP BY ${salesRecords.transactionDate}
    ORDER BY ${salesRecords.transactionDate} ASC
  `);

  const trends: DailyTrendRow[] = trendRows.map((row) => ({
    date: row.date,
    revenue: Number(row.revenue),
    transactions: Number(row.transactions),
  }));

  // Previous period metrics
  const { prevFrom, prevTo } = getPreviousPeriodDates(filters.dateFrom, filters.dateTo);
  const prevFilters: AnalyticsFilters = { ...filters, dateFrom: prevFrom, dateTo: prevTo };
  const prevWhereClause = await buildHotelGroupWhere(prevFilters, userCtx);
  const prevFullWhere = combineConditions([prevWhereClause, groupMembershipFilter]);

  let previousMetrics: { revenue: number; transactions: number } | null = null;
  try {
    const prevSummary = await executeRows<{
      revenue: string;
      transactions: string;
    }>(sql`
      SELECT
        COALESCE(SUM(${salesRecords.netAmount}) FILTER (WHERE ${amountMode}), 0) AS revenue,
        COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions
      FROM ${baseFromLocationsOnly()}
      ${prevFullWhere ? sql`WHERE ${prevFullWhere}` : sql``}
    `);
    previousMetrics = {
      revenue: Number(prevSummary[0]!.revenue),
      transactions: Number(prevSummary[0]!.transactions),
    };
  } catch {
    previousMetrics = null;
  }

  return {
    metrics: {
      revenue,
      transactions,
      hotelCount,
      avgRevenuePerHotel: hotelCount > 0 ? revenue / hotelCount : 0,
    },
    hotels,
    trends,
    previousMetrics,
  };
}

// ─── Cached variants (Phase 3) ───────────────────────────────────────────────
//
// Cache key = ['analytics', <name>, 'v1'] + JSON-serialised args.
// TTL = 24h (overnight UK ETL). Tags: ['analytics', 'analytics:hotel-groups'].
//
// getHotelGroupDetail's uncached signature is (groupIds, filters, userCtx) —
// it predates the wrapAnalyticsQuery contract. Adapted via a local shim that
// matches (filters, userCtx, ...rest) and forwards groupIds as the rest arg.

const HOTEL_GROUPS_TAGS = ['analytics', 'analytics:hotel-groups'];

export const getHotelGroupsListCached = wrapAnalyticsQuery(getHotelGroupsList, {
  name: 'getHotelGroupsList',
  tags: HOTEL_GROUPS_TAGS,
});

export const getHotelGroupDetailCached = wrapAnalyticsQuery(
  (filters: AnalyticsFilters, userCtx: UserCtx, groupIds: string[]) =>
    getHotelGroupDetail(groupIds, filters, userCtx),
  {
    name: 'getHotelGroupDetail',
    tags: HOTEL_GROUPS_TAGS,
  },
);
