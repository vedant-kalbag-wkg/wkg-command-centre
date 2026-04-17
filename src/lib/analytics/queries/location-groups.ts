import { db } from "@/db";
import {
  salesRecords,
  locations,
  locationGroupMemberships,
  locationGroups,
} from "@/db/schema";
import { sql, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildExclusionCondition,
  buildDateCondition,
  buildDimensionFilters,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import {
  getPreviousPeriodDates,
  calculatePercentile,
} from "@/lib/analytics/metrics";
import type {
  AnalyticsFilters,
  LocationGroupData,
  LocationGroupDetail,
  HotelInGroup,
} from "@/lib/analytics/types";

// ─── Internal: cast db for scopedSalesCondition ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Internal: build WHERE clause ───────────────────────────────────────────

async function buildLocationGroupWhere(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<SQL | undefined> {
  const [scopeCondition, exclusionCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildExclusionCondition(),
  ]);

  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);

  return combineConditions([
    dateCondition,
    scopeCondition,
    exclusionCondition,
    ...dimensionConditions,
  ]);
}

// ─── Internal: base FROM with location group join ───────────────────────────

function baseFromWithLocationGroups(): SQL {
  return sql`${salesRecords}
    INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
    INNER JOIN ${locationGroupMemberships} ON ${locations.id} = ${locationGroupMemberships.locationId}
    INNER JOIN ${locationGroups} ON ${locationGroupMemberships.locationGroupId} = ${locationGroups.id}`;
}

// ─── 1. Location Groups List ────────────────────────────────────────────────

export async function getLocationGroupsList(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<LocationGroupData[]> {
  const whereClause = await buildLocationGroupWhere(filters, userCtx);

  const rows = await db.execute<{
    group_id: string;
    group_name: string;
    revenue: string;
    transactions: string;
    hotel_count: string;
    total_rooms: string | null;
    total_kiosks: string | null;
  }>(sql`
    SELECT
      ${locationGroups.id} AS group_id,
      ${locationGroups.name} AS group_name,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions,
      COUNT(DISTINCT ${salesRecords.locationId})::text AS hotel_count,
      SUM(DISTINCT ${locations.numRooms})::text AS total_rooms,
      NULL::text AS total_kiosks
    FROM ${baseFromWithLocationGroups()}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${locationGroups.id}, ${locationGroups.name}
    ORDER BY revenue DESC
  `);

  return rows.map((row) => {
    const revenue = Number(row.revenue);
    const transactions = Number(row.transactions);
    const totalRooms = row.total_rooms ? Number(row.total_rooms) : null;
    const totalKiosks = row.total_kiosks ? Number(row.total_kiosks) : null;

    return {
      id: row.group_id,
      name: row.group_name,
      revenue,
      transactions,
      hotelCount: Number(row.hotel_count),
      totalRooms,
      revenuePerRoom: totalRooms && totalRooms > 0 ? revenue / totalRooms : null,
      txnPerKiosk: totalKiosks && totalKiosks > 0 ? transactions / totalKiosks : null,
      avgBasketValue: transactions > 0 ? revenue / transactions : 0,
    };
  });
}

// ─── 2. Location Group Detail ───────────────────────────────────────────────

export async function getLocationGroupDetail(
  groupIds: string[],
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<LocationGroupDetail> {
  const whereClause = await buildLocationGroupWhere(filters, userCtx);
  const groupFilter = sql`${locationGroups.id} IN ${sql.raw(`(${groupIds.map((id) => `'${id}'`).join(",")})`)}`;
  const fullWhere = combineConditions([whereClause, groupFilter]);

  // Summary + capacity metrics
  const summaryRows = await db.execute<{
    revenue: string;
    transactions: string;
    hotel_count: string;
    total_rooms: string | null;
    total_kiosks: string | null;
  }>(sql`
    SELECT
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions,
      COUNT(DISTINCT ${salesRecords.locationId})::text AS hotel_count,
      SUM(DISTINCT ${locations.numRooms})::text AS total_rooms,
      NULL::text AS total_kiosks
    FROM ${baseFromWithLocationGroups()}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
  `);

  const summary = summaryRows[0]!;
  const revenue = Number(summary.revenue);
  const transactions = Number(summary.transactions);
  const hotelCount = Number(summary.hotel_count);
  const totalRooms = summary.total_rooms ? Number(summary.total_rooms) : null;
  const totalKiosks = summary.total_kiosks ? Number(summary.total_kiosks) : null;

  const revenuePerRoom = totalRooms && totalRooms > 0 ? revenue / totalRooms : null;
  const txnPerRoom = totalRooms && totalRooms > 0 ? transactions / totalRooms : null;
  const txnPerKiosk = totalKiosks && totalKiosks > 0 ? transactions / totalKiosks : null;
  const avgBasketValue = transactions > 0 ? revenue / transactions : 0;

  // Peer analysis — compare this group against all groups
  const allGroupsData = await getLocationGroupsList(filters, userCtx);
  const allRevenuePerRoom = allGroupsData
    .map((g) => g.revenuePerRoom)
    .filter((v): v is number => v !== null);
  const allAvgBasket = allGroupsData.map((g) => g.avgBasketValue);
  const allRevenues = allGroupsData.map((g) => g.revenue);
  const allTransactions = allGroupsData.map((g) => g.transactions);

  const peerAnalysis: { metric: string; value: number; percentile: number }[] = [
    {
      metric: "Revenue",
      value: revenue,
      percentile: calculatePercentile(revenue, allRevenues),
    },
    {
      metric: "Transactions",
      value: transactions,
      percentile: calculatePercentile(transactions, allTransactions),
    },
    {
      metric: "Avg Basket Value",
      value: avgBasketValue,
      percentile: calculatePercentile(avgBasketValue, allAvgBasket),
    },
  ];

  if (revenuePerRoom !== null && allRevenuePerRoom.length > 0) {
    peerAnalysis.push({
      metric: "Revenue / Room",
      value: revenuePerRoom,
      percentile: calculatePercentile(revenuePerRoom, allRevenuePerRoom),
    });
  }

  // Hotel breakdown
  const hotelRows = await db.execute<{
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
    FROM ${baseFromWithLocationGroups()}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
    GROUP BY ${salesRecords.locationId}, ${locations.outletCode}, ${locations.name}, ${locations.numRooms}, ${locations.starRating}
    ORDER BY revenue DESC
  `);

  const hotelBreakdown: HotelInGroup[] = hotelRows.map((row) => {
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

  // Previous period metrics
  const { prevFrom, prevTo } = getPreviousPeriodDates(filters.dateFrom, filters.dateTo);
  const prevFilters: AnalyticsFilters = { ...filters, dateFrom: prevFrom, dateTo: prevTo };
  const prevWhereClause = await buildLocationGroupWhere(prevFilters, userCtx);
  const prevFullWhere = combineConditions([prevWhereClause, groupFilter]);

  let previousMetrics: { revenue: number; transactions: number } | null = null;
  try {
    const prevSummary = await db.execute<{
      revenue: string;
      transactions: string;
    }>(sql`
      SELECT
        COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
        COUNT(*)::text AS transactions
      FROM ${baseFromWithLocationGroups()}
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
    metrics: { revenue, transactions, hotelCount, totalRooms },
    capacityMetrics: {
      revenuePerRoom,
      txnPerRoom,
      txnPerKiosk,
      avgBasketValue,
      totalRooms,
      totalKiosks,
    },
    peerAnalysis,
    hotelBreakdown,
    previousMetrics,
  };
}
