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
  buildAmountModeCondition,
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  buildSalesTxnCondition,
  combineConditions,
  locationGroupRoomsSubquery,
} from "@/lib/analytics/queries/shared";
import {
  buildActiveLocationCondition,
  getActiveLocationIds,
} from "@/lib/analytics/active-locations";
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

  // metricMode applied per-aggregate via FILTER (D1 — counts mode-invariant).
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
  const amountMode = buildAmountModeCondition(filters);
  const salesTxn = buildSalesTxnCondition();

  const [rows, countRows] = await Promise.all([
    executeRows<{
      region_id: string;
      region_name: string;
      market_id: string | null;
      market_name: string | null;
      revenue_native: string;
      revenue_gbp: string;
      currency_key: string | null;
      transactions: string;
    }>(sql`
      SELECT
        ${regions.id} AS region_id,
        ${regions.name} AS region_name,
        ${markets.id} AS market_id,
        ${markets.name} AS market_name,
        COALESCE(SUM(${salesRecords.netAmount})     FILTER (WHERE ${amountMode}), 0) AS revenue_native,
        COALESCE(SUM(${salesRecords.netAmountGbp}) FILTER (WHERE ${amountMode}), 0) AS revenue_gbp,
        CASE WHEN COUNT(DISTINCT ${salesRecords.currency}) FILTER (WHERE ${amountMode}) = 1
             THEN MIN(${salesRecords.currency}) FILTER (WHERE ${amountMode})
             ELSE NULL END AS currency_key,
        COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions
      FROM ${baseFromWithRegions()}
      ${whereClause ? sql`WHERE ${whereClause}` : sql``}
      GROUP BY ${regions.id}, ${regions.name}, ${markets.id}, ${markets.name}
      ORDER BY revenue_gbp DESC      -- D-12: ranking always GBP
    `),
    // Query 2: badge counts (hotel groups + location groups per region).
    //
    // Task 4.19 / PR-27 — structurally unified with getRegionDetail's
    // hotelGroupBreakdown so the selector card and the detail panel cannot
    // diverge. Both queries now count a hotel-group iff there exists at least
    // one sales row whose location (a) belongs to the region via
    // location_region_memberships and (b) is a member of the hotel-group via
    // location_hotel_group_memberships, AND the row passes the global
    // whereClause. The same predicate shape applies to location-groups.
    //
    // Pre-PR-20 the badge counted memberships off `lrm` directly with no sales
    // gate, returning portfolio-wide membership totals (UK = 79). PR-20 added
    // the inner DISTINCT sales subquery so the count matched the detail in
    // typical cases (UK = 63). PR-27 collapses the two shapes into one so
    // future filter additions cannot reintroduce drift: any sales row that
    // qualifies under whereClause + region membership credits its (region,
    // hotel_group) and (region, location_group) pairs exactly once.
    executeRows<{
      region_id: string;
      hotel_group_count: string;
      location_group_count: string;
    }>(sql`
      SELECT
        ${locationRegionMemberships.regionId} AS region_id,
        COUNT(DISTINCT ${locationHotelGroupMemberships.hotelGroupId})::text AS hotel_group_count,
        COUNT(DISTINCT ${locationGroupMemberships.locationGroupId})::text AS location_group_count
      FROM ${salesRecords}
        INNER JOIN ${locationRegionMemberships}
          ON ${locationRegionMemberships.locationId} = ${salesRecords.locationId}
        LEFT JOIN ${locationHotelGroupMemberships}
          ON ${locationHotelGroupMemberships.locationId} = ${salesRecords.locationId}
        LEFT JOIN ${locationGroupMemberships}
          ON ${locationGroupMemberships.locationId} = ${salesRecords.locationId}
      ${whereClause ? sql`WHERE ${whereClause}` : sql``}
      GROUP BY ${locationRegionMemberships.regionId}
    `),
  ]);

  const countMap = new Map(
    countRows.map((r) => [r.region_id, { hg: Number(r.hotel_group_count), lg: Number(r.location_group_count) }]),
  );

  return rows.map((row) => ({
    id: row.region_id,
    name: row.region_name,
    // Phase 9.1 / D-12: ranking is always GBP, so the public `revenue` field
    // (consumed by the metric tile renderer + cross-region sort) reads from
    // `revenue_gbp`. Plan 09.1-07 layers the auto-pick (D-10) on top by
    // adding `revenueNative` + `currencyKey` to the public shape and dispatching
    // in the renderer. Internal binding to GBP keeps cross-currency comparisons
    // correct (a EUR-only region and a GBP-only region rank on the same scale).
    revenue: Number(row.revenue_gbp),
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
  const amountMode = buildAmountModeCondition(filters);
  const salesTxn = buildSalesTxnCondition();

  // Summary metrics
  const summaryRows = await executeRows<{
    revenue_native: string;
    revenue_gbp: string;
    currency_key: string | null;
    transactions: string;
  }>(sql`
    SELECT
      COALESCE(SUM(${salesRecords.netAmount})     FILTER (WHERE ${amountMode}), 0) AS revenue_native,
      COALESCE(SUM(${salesRecords.netAmountGbp}) FILTER (WHERE ${amountMode}), 0) AS revenue_gbp,
      CASE WHEN COUNT(DISTINCT ${salesRecords.currency}) FILTER (WHERE ${amountMode}) = 1
           THEN MIN(${salesRecords.currency}) FILTER (WHERE ${amountMode})
           ELSE NULL END AS currency_key,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions
    FROM ${baseFromWithRegions()}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
  `);

  const summary = summaryRows[0]!;
  // D-12 — bind public `revenue` to GBP side; renderer (09.1-07) reads
  // revenueNative + currencyKey to flip native at the cell level for
  // single-currency cohorts.
  const revenue = Number(summary.revenue_gbp);
  const revenueNative = Number(summary.revenue_native);
  const currencyKey = summary.currency_key;
  const transactions = Number(summary.transactions);

  // Get location IDs in this region for sub-queries
  const locationIdsInRegion = sql`
    SELECT ${locationRegionMemberships.locationId}
    FROM ${locationRegionMemberships}
    WHERE ${locationRegionMemberships.regionId} IN ${sql.raw(`(${regionIds.map((id) => `'${id}'`).join(",")})`)}
  `;

  // Hotel group breakdown within region
  // D5 Part E — hotel groups remain N:N with locations. The previous JOIN
  // through location_hotel_group_memberships fanned a multi-group location's
  // sales out across each of its groups, multi-counting them in the region
  // breakdown. EXISTS qualifies each sales row against the current group
  // exactly once.
  const hgRows = await executeRows<{
    group_name: string;
    revenue_native: string;
    revenue_gbp: string;
    currency_key: string | null;
    transactions: string;
    hotel_count: string;
  }>(sql`
    SELECT
      ${hotelGroups.name} AS group_name,
      COALESCE(SUM(${salesRecords.netAmount})     FILTER (WHERE ${amountMode}), 0) AS revenue_native,
      COALESCE(SUM(${salesRecords.netAmountGbp}) FILTER (WHERE ${amountMode}), 0) AS revenue_gbp,
      CASE WHEN COUNT(DISTINCT ${salesRecords.currency}) FILTER (WHERE ${amountMode}) = 1
           THEN MIN(${salesRecords.currency}) FILTER (WHERE ${amountMode})
           ELSE NULL END AS currency_key,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions,
      COUNT(DISTINCT ${salesRecords.locationId}) FILTER (WHERE ${salesTxn})::text AS hotel_count
    FROM ${hotelGroups}
      INNER JOIN ${salesRecords} ON EXISTS (
        SELECT 1 FROM ${locationHotelGroupMemberships}
        WHERE ${locationHotelGroupMemberships.locationId} = ${salesRecords.locationId}
          AND ${locationHotelGroupMemberships.hotelGroupId} = ${hotelGroups.id}
      )
      INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
    WHERE ${salesRecords.locationId} IN (${locationIdsInRegion})
      ${whereClause ? sql`AND ${whereClause}` : sql``}
    GROUP BY ${hotelGroups.id}, ${hotelGroups.name}
    ORDER BY revenue_gbp DESC      -- D-12: ranking always GBP
  `);

  const hotelGroupBreakdown = hgRows.map((row) => {
    // D-12 — bind to GBP side; renderer dispatch lands in 09.1-07.
    const hgRevenue = Number(row.revenue_gbp);
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
  // Task 2.2: total_rooms via correlated scalar subquery scoped to (a) the
  // current location_group row and (b) locations in this region. The previous
  // SUM(locations.num_rooms) over the sales_records JOIN multiplied each
  // location's num_rooms by its sales-row count — Heathrow displayed 1.79M
  // rooms (vs ~3,000 actual) because it has many high-volume hotels.
  const activeIds = await getActiveLocationIds();
  const totalRoomsExpr = locationGroupRoomsSubquery(
    sql`= ${locationGroups.id}`,
    activeIds,
    sql`l.id IN (${locationIdsInRegion})`,
  );
  const lgRows = await executeRows<{
    group_name: string;
    revenue_native: string;
    revenue_gbp: string;
    currency_key: string | null;
    transactions: string;
    outlet_count: string;
    total_rooms: string | null;
  }>(sql`
    SELECT
      ${locationGroups.name} AS group_name,
      COALESCE(SUM(${salesRecords.netAmount})     FILTER (WHERE ${amountMode}), 0) AS revenue_native,
      COALESCE(SUM(${salesRecords.netAmountGbp}) FILTER (WHERE ${amountMode}), 0) AS revenue_gbp,
      CASE WHEN COUNT(DISTINCT ${salesRecords.currency}) FILTER (WHERE ${amountMode}) = 1
           THEN MIN(${salesRecords.currency}) FILTER (WHERE ${amountMode})
           ELSE NULL END AS currency_key,
      COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions,
      COUNT(DISTINCT ${salesRecords.locationId}) FILTER (WHERE ${salesTxn})::text AS outlet_count,
      ${totalRoomsExpr}::text AS total_rooms
    FROM ${salesRecords}
      INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
      INNER JOIN ${locationGroupMemberships} ON ${locations.id} = ${locationGroupMemberships.locationId}
      INNER JOIN ${locationGroups} ON ${locationGroupMemberships.locationGroupId} = ${locationGroups.id}
    WHERE ${salesRecords.locationId} IN (${locationIdsInRegion})
      ${whereClause ? sql`AND ${whereClause}` : sql``}
    GROUP BY ${locationGroups.id}, ${locationGroups.name}
    ORDER BY revenue_gbp DESC      -- D-12: ranking always GBP
  `);

  const locationGroupBreakdown = lgRows.map((row) => ({
    name: row.group_name,
    // D-12 — bind to GBP side; renderer dispatch (09.1-07) reads currency_key.
    revenue: Number(row.revenue_gbp),
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
      revenue_native: string;
      revenue_gbp: string;
      currency_key: string | null;
      transactions: string;
    }>(sql`
      SELECT
        COALESCE(SUM(${salesRecords.netAmount})     FILTER (WHERE ${amountMode}), 0) AS revenue_native,
        COALESCE(SUM(${salesRecords.netAmountGbp}) FILTER (WHERE ${amountMode}), 0) AS revenue_gbp,
        CASE WHEN COUNT(DISTINCT ${salesRecords.currency}) FILTER (WHERE ${amountMode}) = 1
             THEN MIN(${salesRecords.currency}) FILTER (WHERE ${amountMode})
             ELSE NULL END AS currency_key,
        COUNT(*) FILTER (WHERE ${salesTxn})::text AS transactions
      FROM ${baseFromWithRegions()}
      ${prevFullWhere ? sql`WHERE ${prevFullWhere}` : sql``}
    `);
    previousMetrics = {
      // D-12 — % change vs previous period must compare like-for-like; both
      // arms read GBP so a EUR-only region's MoM is consistent year-round.
      revenue: Number(prevSummary[0]!.revenue_gbp),
      transactions: Number(prevSummary[0]!.transactions),
    };
  } catch {
    previousMetrics = null;
  }

  return {
    metrics: {
      revenue,
      revenueNative,
      currencyKey,
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
