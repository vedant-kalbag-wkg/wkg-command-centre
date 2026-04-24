import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import {
  salesRecords,
  locations,
  locationRegionMemberships,
  locationHotelGroupMemberships,
  locationGroupMemberships,
  regions,
  markets,
  hotelGroups,
  locationGroups,
} from "@/db/schema";
import { sql, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import { buildActiveLocationCondition } from "@/lib/analytics/active-locations";
import { wrapAnalyticsQuery } from "@/lib/analytics/cached-query";
import { getPreviousPeriodDates, calculatePeriodChange } from "@/lib/analytics/metrics";
import type {
  AnalyticsFilters,
  RegionData,
  RegionDetail,
} from "@/lib/analytics/types";

// ─── Internal: cast db for scopedSalesCondition ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Internal: build WHERE clause ───────────────────────────────────────────

async function buildRegionWhere(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<SQL | undefined> {
  // Phase 1 #6: active-location predicate replaces outlet_code exclusion.
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

// ─── Internal: base FROM with region join ───────────────────────────────────

function baseFromWithRegions(): SQL {
  return sql`${salesRecords}
    INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
    INNER JOIN ${locationRegionMemberships} ON ${locations.id} = ${locationRegionMemberships.locationId}
    INNER JOIN ${regions} ON ${locationRegionMemberships.regionId} = ${regions.id}
    LEFT JOIN ${markets} ON ${regions.marketId} = ${markets.id}`;
}

// ─── 1. Regions List ────────────────────────────────────────────────────────

export async function getRegionsList(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<RegionData[]> {
  const whereClause = await buildRegionWhere(filters, userCtx);

  const [rows, countRows] = await Promise.all([
    executeRows<{
      region_id: string;
      region_name: string;
      market_id: string | null;
      market_name: string | null;
      revenue: string;
      transactions: string;
    }>(sql`
      SELECT
        ${regions.id} AS region_id,
        ${regions.name} AS region_name,
        ${markets.id} AS market_id,
        ${markets.name} AS market_name,
        COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
        COUNT(*)::text AS transactions
      FROM ${baseFromWithRegions()}
      ${whereClause ? sql`WHERE ${whereClause}` : sql``}
      GROUP BY ${regions.id}, ${regions.name}, ${markets.id}, ${markets.name}
      ORDER BY revenue DESC
    `),
    executeRows<{
      region_id: string;
      hotel_group_count: string;
      location_group_count: string;
    }>(sql`
      SELECT
        ${locationRegionMemberships.regionId} AS region_id,
        COUNT(DISTINCT ${locationHotelGroupMemberships.hotelGroupId})::text AS hotel_group_count,
        COUNT(DISTINCT ${locationGroupMemberships.locationGroupId})::text AS location_group_count
      FROM ${locationRegionMemberships}
        LEFT JOIN ${locationHotelGroupMemberships}
          ON ${locationRegionMemberships.locationId} = ${locationHotelGroupMemberships.locationId}
        LEFT JOIN ${locationGroupMemberships}
          ON ${locationRegionMemberships.locationId} = ${locationGroupMemberships.locationId}
      GROUP BY ${locationRegionMemberships.regionId}
    `),
  ]);

  const countMap = new Map(
    countRows.map((r) => [r.region_id, { hg: Number(r.hotel_group_count), lg: Number(r.location_group_count) }]),
  );

  return rows.map((row) => ({
    id: row.region_id,
    name: row.region_name,
    revenue: Number(row.revenue),
    transactions: Number(row.transactions),
    hotelGroupCount: countMap.get(row.region_id)?.hg ?? 0,
    locationGroupCount: countMap.get(row.region_id)?.lg ?? 0,
    marketId: row.market_id ?? null,
    marketName: row.market_name ?? null,
  }));
}

// ─── 2. Region Detail ───────────────────────────────────────────────────────

export async function getRegionDetail(
  regionIds: string[],
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<RegionDetail> {
  const whereClause = await buildRegionWhere(filters, userCtx);
  const regionFilter = sql`${regions.id} IN ${sql.raw(`(${regionIds.map((id) => `'${id}'`).join(",")})`)}`;
  const fullWhere = combineConditions([whereClause, regionFilter]);

  // Summary metrics
  const summaryRows = await executeRows<{
    revenue: string;
    transactions: string;
  }>(sql`
    SELECT
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions
    FROM ${baseFromWithRegions()}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
  `);

  const summary = summaryRows[0]!;
  const revenue = Number(summary.revenue);
  const transactions = Number(summary.transactions);

  // Get location IDs in this region for sub-queries
  const locationIdsInRegion = sql`
    SELECT ${locationRegionMemberships.locationId}
    FROM ${locationRegionMemberships}
    WHERE ${locationRegionMemberships.regionId} IN ${sql.raw(`(${regionIds.map((id) => `'${id}'`).join(",")})`)}
  `;

  // Hotel group breakdown within region
  const hgRows = await executeRows<{
    group_name: string;
    revenue: string;
    transactions: string;
    hotel_count: string;
  }>(sql`
    SELECT
      ${hotelGroups.name} AS group_name,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions,
      COUNT(DISTINCT ${salesRecords.locationId})::text AS hotel_count
    FROM ${salesRecords}
      INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
      INNER JOIN ${locationHotelGroupMemberships} ON ${locations.id} = ${locationHotelGroupMemberships.locationId}
      INNER JOIN ${hotelGroups} ON ${locationHotelGroupMemberships.hotelGroupId} = ${hotelGroups.id}
    WHERE ${salesRecords.locationId} IN (${locationIdsInRegion})
      ${whereClause ? sql`AND ${whereClause}` : sql``}
    GROUP BY ${hotelGroups.id}, ${hotelGroups.name}
    ORDER BY revenue DESC
  `);

  const hotelGroupBreakdown = hgRows.map((row) => {
    const hgRevenue = Number(row.revenue);
    const hotelCount = Number(row.hotel_count);
    return {
      name: row.group_name,
      revenue: hgRevenue,
      transactions: Number(row.transactions),
      hotelCount,
      avgRevenuePerHotel: hotelCount > 0 ? hgRevenue / hotelCount : 0,
    };
  });

  // Location group breakdown within region
  const lgRows = await executeRows<{
    group_name: string;
    revenue: string;
    transactions: string;
    outlet_count: string;
    total_rooms: string | null;
  }>(sql`
    SELECT
      ${locationGroups.name} AS group_name,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions,
      COUNT(DISTINCT ${salesRecords.locationId})::text AS outlet_count,
      SUM(${locations.numRooms})::text AS total_rooms
    FROM ${salesRecords}
      INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
      INNER JOIN ${locationGroupMemberships} ON ${locations.id} = ${locationGroupMemberships.locationId}
      INNER JOIN ${locationGroups} ON ${locationGroupMemberships.locationGroupId} = ${locationGroups.id}
    WHERE ${salesRecords.locationId} IN (${locationIdsInRegion})
      ${whereClause ? sql`AND ${whereClause}` : sql``}
    GROUP BY ${locationGroups.id}, ${locationGroups.name}
    ORDER BY revenue DESC
  `);

  const locationGroupBreakdown = lgRows.map((row) => ({
    name: row.group_name,
    revenue: Number(row.revenue),
    transactions: Number(row.transactions),
    outletCount: Number(row.outlet_count),
    totalRooms: row.total_rooms ? Number(row.total_rooms) : null,
  }));

  // Previous period metrics
  const { prevFrom, prevTo } = getPreviousPeriodDates(filters.dateFrom, filters.dateTo);
  const prevFilters: AnalyticsFilters = { ...filters, dateFrom: prevFrom, dateTo: prevTo };
  const prevWhereClause = await buildRegionWhere(prevFilters, userCtx);
  const prevFullWhere = combineConditions([prevWhereClause, regionFilter]);

  let previousMetrics: { revenue: number; transactions: number } | null = null;
  try {
    const prevSummary = await executeRows<{
      revenue: string;
      transactions: string;
    }>(sql`
      SELECT
        COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
        COUNT(*)::text AS transactions
      FROM ${baseFromWithRegions()}
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
      hotelGroupCount: hotelGroupBreakdown.length,
      locationGroupCount: locationGroupBreakdown.length,
    },
    hotelGroupBreakdown,
    locationGroupBreakdown,
    previousMetrics,
  };
}

// ─── Cached variants (Phase 3) ───────────────────────────────────────────────
//
// Cache key = ['analytics', <name>, 'v1'] + JSON-serialised args.
// TTL = 24h (overnight UK ETL). Tags: ['analytics', 'analytics:regions'].
//
// getRegionDetail's uncached signature is (regionIds, filters, userCtx) — it
// predates the wrapAnalyticsQuery contract. Rather than rename/re-export the
// uncached fn, we adapt via a local shim that matches (filters, userCtx, ...rest)
// and forwards regionIds as the rest arg.

const REGIONS_TAGS = ['analytics', 'analytics:regions'];

export const getRegionsListCached = wrapAnalyticsQuery(getRegionsList, {
  name: 'getRegionsList',
  tags: REGIONS_TAGS,
});

export const getRegionDetailCached = wrapAnalyticsQuery(
  (filters: AnalyticsFilters, userCtx: UserCtx, regionIds: string[]) =>
    getRegionDetail(regionIds, filters, userCtx),
  {
    name: 'getRegionDetail',
    tags: REGIONS_TAGS,
  },
);
