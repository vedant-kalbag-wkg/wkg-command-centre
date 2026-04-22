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
  buildExclusionCondition,
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
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

  return combineConditions([
    dateCondition,
    scopeCondition,
    exclusionCondition,
    maturityCondition,
    ...dimensionConditions,
  ]);
}

// ─── Internal: base FROM with hotel group join ──────────────────────────────

function baseFromWithHotelGroups(): SQL {
  return sql`${salesRecords}
    INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
    INNER JOIN ${locationHotelGroupMemberships} ON ${locations.id} = ${locationHotelGroupMemberships.locationId}
    INNER JOIN ${hotelGroups} ON ${locationHotelGroupMemberships.hotelGroupId} = ${hotelGroups.id}`;
}

// ─── Internal: per-location aggregate FROM (no membership join) ─────────────
//
// Used by getHotelGroupsList to pre-aggregate sales_records by location_id
// BEFORE joining location_hotel_group_memberships. The membership join is
// many-to-many (a location can belong to multiple hotel groups), so joining
// first explodes the working set from ~124k rows to ~148k and forces a 9 MB
// external merge sort on the outer COUNT(DISTINCT location_id).
//
// Pre-aggregating collapses 124k rows to ~200 (one per location) — the
// membership fan-out then happens at ~200→~240 rows, and the outer
// GROUP BY hotel_group sorts ~240 rows in memory. See Phase 1 diagnosis #8.
function baseFromLocationsOnly(): SQL {
  return sql`${salesRecords}
    INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}`;
}

// ─── 1. Hotel Groups List ───────────────────────────────────────────────────

export async function getHotelGroupsList(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<HotelGroupData[]> {
  const whereClause = await buildHotelGroupWhere(filters, userCtx);

  // Current period — pre-aggregate by location in a CTE, then join memberships
  // + hotel_groups. The inner aggregate keeps every filter the original query
  // applied (they all reference salesRecords/locations columns, not hotel
  // group columns), so the result set is semantically identical:
  //
  //   outer revenue      = SUM(per-location revenue) per hotel_group
  //                      = SUM(sales_records.gross_amount) per hotel_group
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
        COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
        COUNT(*) AS transactions
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
        COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
        COUNT(*) AS transactions
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
  const groupFilter = sql`${hotelGroups.id} IN ${sql.raw(`(${groupIds.map((id) => `'${id}'`).join(",")})`)}`;
  const fullWhere = combineConditions([whereClause, groupFilter]);

  // Summary metrics
  const summaryRows = await executeRows<{
    revenue: string;
    transactions: string;
    hotel_count: string;
  }>(sql`
    SELECT
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions,
      COUNT(DISTINCT ${salesRecords.locationId})::text AS hotel_count
    FROM ${baseFromWithHotelGroups()}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
  `);

  const summary = summaryRows[0]!;
  const revenue = Number(summary.revenue);
  const transactions = Number(summary.transactions);
  const hotelCount = Number(summary.hotel_count);

  // Hotel breakdown
  const hotelRows = await executeRows<{
    location_id: string;
    outlet_code: string;
    hotel_name: string;
    revenue: string;
    transactions: string;
    quantity: string;
    rooms: string | null;
    kiosks: string | null;
    star_rating: string | null;
  }>(sql`
    SELECT
      ${salesRecords.locationId} AS location_id,
      COALESCE(${locations.outletCode}, '') AS outlet_code,
      ${locations.name} AS hotel_name,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions,
      COALESCE(SUM(${salesRecords.quantity}), 0)::text AS quantity,
      ${locations.numRooms}::text AS rooms,
      NULL::text AS kiosks,
      ${locations.starRating}::text AS star_rating
    FROM ${baseFromWithHotelGroups()}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
    GROUP BY ${salesRecords.locationId}, ${locations.outletCode}, ${locations.name}, ${locations.numRooms}, ${locations.starRating}
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
      quantity: Number(row.quantity),
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
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions
    FROM ${baseFromWithHotelGroups()}
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
  const prevFullWhere = combineConditions([prevWhereClause, groupFilter]);

  let previousMetrics: { revenue: number; transactions: number } | null = null;
  try {
    const prevSummary = await executeRows<{
      revenue: string;
      transactions: string;
    }>(sql`
      SELECT
        COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
        COUNT(*)::text AS transactions
      FROM ${baseFromWithHotelGroups()}
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
