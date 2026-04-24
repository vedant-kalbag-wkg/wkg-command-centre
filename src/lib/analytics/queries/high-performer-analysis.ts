import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import {
  salesRecords,
  locations,
  products,
  kioskAssignments,
  locationHotelGroupMemberships,
  locationRegionMemberships,
  hotelGroups,
  regions,
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
import { getLocationRevenuesForRequest } from "@/lib/analytics/queries/location-revenues";
import type {
  AnalyticsFilters,
  HighPerformerPatterns,
  LowPerformerPatterns,
} from "@/lib/analytics/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Internal: build WHERE clause ───────────────────────────────────────────

async function buildWhere(
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampCutoff(pct: number): number {
  if (!Number.isFinite(pct)) return 30;
  if (pct <= 0) return 0;
  if (pct >= 100) return 100;
  return Math.round(pct);
}

/**
 * Given per-location revenues sorted DESC (best first), return the set of
 * location IDs in the top `cutoffPct` percent ("top") or the bottom
 * `cutoffPct` percent ("bottom"). Uses ceil to ensure at least 1 entry
 * when cutoff > 0 and any locations exist.
 */
function pickTierIds(
  sortedDesc: { location_id: string; revenue: number }[],
  cutoffPct: number,
  direction: "top" | "bottom",
): string[] {
  const n = sortedDesc.length;
  if (n === 0 || cutoffPct <= 0) return [];
  const count = Math.min(n, Math.max(1, Math.ceil((n * cutoffPct) / 100)));
  return direction === "top"
    ? sortedDesc.slice(0, count).map((r) => r.location_id)
    : sortedDesc.slice(n - count).map((r) => r.location_id);
}

// ─── Core computation (shared by top & bottom) ──────────────────────────────

type CommonShape = {
  count: number;
  totalCount: number;
  insights: string[];
  hotelGroupDistribution: { name: string; count: number; percentage: number }[];
  regionDistribution: { name: string; count: number; percentage: number }[];
  avgKioskCount: number | null;
  avgRoomCount: number | null;
  avgRevenuePerRoom: number | null;
  topProducts: { name: string; revenue: number }[];
};

async function computePerformerPatterns(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
  cutoffPct: number,
  direction: "top" | "bottom",
): Promise<CommonShape> {
  const whereClause = await buildWhere(filters, userCtx);

  // 1. Per-location revenue + rooms (our composite-score proxy for this view).
  //    Shared via React.cache so the high- and low-performer paths — which
  //    both call `computePerformerPatterns` with the same filters/userCtx
  //    within one render — collapse to a single aggregate query.
  const locationRevenues = await getLocationRevenuesForRequest(filters, userCtx);

  const totalCount = locationRevenues.length;

  // 2. Sort DESC by revenue, then pick top-N% or bottom-N%.
  const sortedDesc = locationRevenues
    .map((r) => ({
      location_id: r.location_id,
      revenue: Number(r.revenue),
      num_rooms: r.num_rooms == null ? null : Number(r.num_rooms),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const tierIds = pickTierIds(sortedDesc, cutoffPct, direction);
  const tierSet = new Set(tierIds);
  const tierRevenueById = new Map(
    sortedDesc
      .filter((r) => tierSet.has(r.location_id))
      .map((r) => [r.location_id, r.revenue] as const),
  );
  const tierRooms: number[] = sortedDesc
    .filter((r) => tierSet.has(r.location_id) && r.num_rooms != null)
    .map((r) => r.num_rooms as number);

  const count = tierIds.length;

  // Early return if nothing to analyse
  if (count === 0) {
    return {
      count: 0,
      totalCount,
      insights:
        direction === "top"
          ? ["No locations currently qualify as top performers"]
          : ["No locations currently qualify as bottom performers"],
      hotelGroupDistribution: [],
      regionDistribution: [],
      avgKioskCount: null,
      avgRoomCount: null,
      avgRevenuePerRoom: null,
      topProducts: [],
    };
  }

  // 3. Aggregate for tier-member locations (parallel)
  const [hotelGroupRows, regionRows, kioskRows, topProductRows] =
    await Promise.all([
      // Hotel group distribution
      executeRows<{ name: string; count: string }>(sql`
        SELECT
          ${hotelGroups.name} AS name,
          COUNT(DISTINCT ${locationHotelGroupMemberships.locationId})::text AS count
        FROM ${locationHotelGroupMemberships}
          INNER JOIN ${hotelGroups}
            ON ${locationHotelGroupMemberships.hotelGroupId} = ${hotelGroups.id}
        WHERE ${locationHotelGroupMemberships.locationId} = ANY(${sql.param(tierIds)}::uuid[])
        GROUP BY ${hotelGroups.name}
        ORDER BY count DESC
      `),

      // Region distribution
      executeRows<{ name: string; count: string }>(sql`
        SELECT
          ${regions.name} AS name,
          COUNT(DISTINCT ${locationRegionMemberships.locationId})::text AS count
        FROM ${locationRegionMemberships}
          INNER JOIN ${regions}
            ON ${locationRegionMemberships.regionId} = ${regions.id}
        WHERE ${locationRegionMemberships.locationId} = ANY(${sql.param(tierIds)}::uuid[])
        GROUP BY ${regions.name}
        ORDER BY count DESC
      `),

      // Average kiosk count per tier location
      executeRows<{ avg_kiosks: string | null }>(sql`
        SELECT
          AVG(kiosk_count)::text AS avg_kiosks
        FROM (
          SELECT
            ${kioskAssignments.locationId},
            COUNT(*)::int AS kiosk_count
          FROM ${kioskAssignments}
          WHERE ${kioskAssignments.locationId} = ANY(${sql.param(tierIds)}::uuid[])
            AND ${kioskAssignments.unassignedAt} IS NULL
          GROUP BY ${kioskAssignments.locationId}
        ) AS kc
      `),

      // Top products by revenue for tier locations. Always exclude fee rows
      // (Booking Fee / Cash Handling Fee) — they aren't products and swamp
      // the ranking by transaction count.
      executeRows<{ name: string; revenue: string }>(sql`
        SELECT
          ${products.name} AS name,
          COALESCE(SUM(${salesRecords.netAmount}), 0) AS revenue
        FROM ${salesRecords}
          INNER JOIN ${products} ON ${salesRecords.productId} = ${products.id}
          INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
        WHERE ${salesRecords.locationId} = ANY(${sql.param(tierIds)}::uuid[])
          AND ${salesRecords.isBookingFee} = false
          ${whereClause ? sql`AND ${whereClause}` : sql``}
        GROUP BY ${products.name}
        ORDER BY revenue DESC
        LIMIT 5
      `),
    ]);

  // 4. Build distributions
  const hotelGroupDistribution = hotelGroupRows.map((r) => ({
    name: r.name,
    count: Number(r.count),
    percentage: count > 0 ? (Number(r.count) / count) * 100 : 0,
  }));

  const regionDistribution = regionRows.map((r) => ({
    name: r.name,
    count: Number(r.count),
    percentage: count > 0 ? (Number(r.count) / count) * 100 : 0,
  }));

  const avgKioskCount =
    kioskRows[0]?.avg_kiosks != null ? Number(kioskRows[0].avg_kiosks) : null;

  const avgRoomCount =
    tierRooms.length > 0
      ? tierRooms.reduce((sum, r) => sum + r, 0) / tierRooms.length
      : null;

  // Period-total revenue ÷ period-total rooms across tier-member locations.
  const tierPairs = sortedDesc.filter(
    (r) => tierSet.has(r.location_id) && r.num_rooms != null && r.num_rooms > 0,
  );
  const tierRevenueTotal = tierPairs.reduce((acc, r) => acc + r.revenue, 0);
  const tierRoomsTotal = tierPairs.reduce(
    (acc, r) => acc + (r.num_rooms as number),
    0,
  );
  const avgRevenuePerRoom = tierRoomsTotal > 0 ? tierRevenueTotal / tierRoomsTotal : null;

  const topProducts = topProductRows.map((r) => ({
    name: r.name,
    revenue: Number(r.revenue),
  }));

  // 5. Insights — symmetric copy
  const noun = direction === "top" ? "Top performers" : "Bottom performers";
  const insights: string[] = [];

  if (regionDistribution.length > 0) {
    const topRegion = regionDistribution[0];
    insights.push(
      `${topRegion.count} of ${count} ${noun.toLowerCase()} are in region ${topRegion.name}`,
    );
  }

  if (avgKioskCount != null) {
    insights.push(
      `${noun} average ${avgKioskCount.toFixed(1)} kiosks per location`,
    );
  }

  if (avgRoomCount != null) {
    insights.push(
      `${noun} average ${Math.round(avgRoomCount)} rooms per location`,
    );
  }

  if (avgRevenuePerRoom != null) {
    insights.push(
      `${noun} average £${Math.round(avgRevenuePerRoom).toLocaleString()} revenue per room`,
    );
  }

  if (topProducts.length > 0) {
    const topNames = topProducts.slice(0, 3).map((p) => p.name);
    insights.push(`Top ${topNames.length} products: ${topNames.join(", ")}`);
  }

  if (hotelGroupDistribution.length > 0) {
    const topGroup = hotelGroupDistribution[0];
    insights.push(
      `${topGroup.count} of ${count} ${noun.toLowerCase()} belong to ${topGroup.name}`,
    );
  }

  // silence unused warning (kept for parity with earlier impl)
  void tierRevenueById;

  return {
    count,
    totalCount,
    insights,
    hotelGroupDistribution,
    regionDistribution,
    avgKioskCount,
    avgRoomCount,
    avgRevenuePerRoom,
    topProducts,
  };
}

// ─── Public: top-tier (green) ───────────────────────────────────────────────

export async function getHighPerformerData(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
  greenCutoff: number = 30,
): Promise<HighPerformerPatterns> {
  const pct = clampCutoff(greenCutoff);
  const base = await computePerformerPatterns(filters, userCtx, pct, "top");
  return {
    greenCount: base.count,
    totalCount: base.totalCount,
    insights: base.insights,
    hotelGroupDistribution: base.hotelGroupDistribution,
    regionDistribution: base.regionDistribution,
    avgKioskCount: base.avgKioskCount,
    avgRoomCount: base.avgRoomCount,
    avgRevenuePerRoom: base.avgRevenuePerRoom,
    topProducts: base.topProducts,
  };
}

// ─── Public: bottom-tier (red) ──────────────────────────────────────────────

export async function getLowPerformerData(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
  redCutoff: number = 30,
): Promise<LowPerformerPatterns> {
  const pct = clampCutoff(redCutoff);
  const base = await computePerformerPatterns(filters, userCtx, pct, "bottom");
  return {
    redCount: base.count,
    totalCount: base.totalCount,
    insights: base.insights,
    hotelGroupDistribution: base.hotelGroupDistribution,
    regionDistribution: base.regionDistribution,
    avgKioskCount: base.avgKioskCount,
    avgRoomCount: base.avgRoomCount,
    avgRevenuePerRoom: base.avgRevenuePerRoom,
    topProducts: base.topProducts,
  };
}

// ─── Backwards-compat wrapper ────────────────────────────────────────────────
// Older callers imported `getHighPerformerPatterns` with a ThresholdConfig.
// That shape is now ignored — the cutoff is percentage-based. Kept as a thin
// alias so existing imports don't break.

export async function getHighPerformerPatterns(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
  _thresholdConfig?: unknown,
  greenCutoff: number = 30,
): Promise<HighPerformerPatterns> {
  return getHighPerformerData(filters, userCtx, greenCutoff);
}
