import { db } from "@/db";
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
  buildExclusionCondition,
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import {
  classifyTrafficLight,
  type ThresholdConfig,
} from "@/lib/analytics/thresholds";
import type { AnalyticsFilters, HighPerformerPatterns } from "@/lib/analytics/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Internal: build WHERE clause ───────────────────────────────────────────

async function buildWhere(
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

// ─── Main Query ─────────────────────────────────────────────────────────────

export async function getHighPerformerPatterns(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
  thresholdConfig: ThresholdConfig,
): Promise<HighPerformerPatterns> {
  const whereClause = await buildWhere(filters, userCtx);

  // 1. Get per-location revenue
  const locationRevenues = await db.execute<{
    location_id: string;
    location_name: string;
    revenue: string;
    num_rooms: string | null;
  }>(sql`
    SELECT
      ${salesRecords.locationId} AS location_id,
      ${locations.name} AS location_name,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      ${locations.numRooms}::text AS num_rooms
    FROM ${salesRecords}
      INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${salesRecords.locationId}, ${locations.name}, ${locations.numRooms}
  `);

  const totalCount = locationRevenues.length;

  // 2. Classify each location
  const greenLocationIds: string[] = [];
  const greenRooms: number[] = [];

  for (const row of locationRevenues) {
    const revenue = Number(row.revenue);
    const tier = classifyTrafficLight(revenue, thresholdConfig);
    if (tier === "green") {
      greenLocationIds.push(row.location_id);
      if (row.num_rooms != null) {
        greenRooms.push(Number(row.num_rooms));
      }
    }
  }

  const greenCount = greenLocationIds.length;

  // Early return if no green locations
  if (greenCount === 0) {
    return {
      greenCount: 0,
      totalCount,
      insights: ["No locations currently meet the green tier threshold"],
      hotelGroupDistribution: [],
      regionDistribution: [],
      avgKioskCount: null,
      avgRoomCount: null,
      topProducts: [],
    };
  }

  // 3. Aggregate for green-tier locations
  const [hotelGroupRows, regionRows, kioskRows, topProductRows] =
    await Promise.all([
      // Hotel group distribution
      db.execute<{ name: string; count: string }>(sql`
        SELECT
          ${hotelGroups.name} AS name,
          COUNT(DISTINCT ${locationHotelGroupMemberships.locationId})::text AS count
        FROM ${locationHotelGroupMemberships}
          INNER JOIN ${hotelGroups}
            ON ${locationHotelGroupMemberships.hotelGroupId} = ${hotelGroups.id}
        WHERE ${locationHotelGroupMemberships.locationId} IN ${sql`(${sql.join(
          greenLocationIds.map((id) => sql`${id}`),
          sql`, `,
        )})`}
        GROUP BY ${hotelGroups.name}
        ORDER BY count DESC
      `),

      // Region distribution
      db.execute<{ name: string; count: string }>(sql`
        SELECT
          ${regions.name} AS name,
          COUNT(DISTINCT ${locationRegionMemberships.locationId})::text AS count
        FROM ${locationRegionMemberships}
          INNER JOIN ${regions}
            ON ${locationRegionMemberships.regionId} = ${regions.id}
        WHERE ${locationRegionMemberships.locationId} IN ${sql`(${sql.join(
          greenLocationIds.map((id) => sql`${id}`),
          sql`, `,
        )})`}
        GROUP BY ${regions.name}
        ORDER BY count DESC
      `),

      // Average kiosk count per green location
      db.execute<{ avg_kiosks: string | null }>(sql`
        SELECT
          AVG(kiosk_count)::text AS avg_kiosks
        FROM (
          SELECT
            ${kioskAssignments.locationId},
            COUNT(*)::int AS kiosk_count
          FROM ${kioskAssignments}
          WHERE ${kioskAssignments.locationId} IN ${sql`(${sql.join(
            greenLocationIds.map((id) => sql`${id}`),
            sql`, `,
          )})`}
            AND ${kioskAssignments.unassignedAt} IS NULL
          GROUP BY ${kioskAssignments.locationId}
        ) AS kc
      `),

      // Top products by revenue for green locations
      db.execute<{ name: string; revenue: string }>(sql`
        SELECT
          ${products.name} AS name,
          COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue
        FROM ${salesRecords}
          INNER JOIN ${products} ON ${salesRecords.productId} = ${products.id}
          INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
        WHERE ${salesRecords.locationId} IN ${sql`(${sql.join(
          greenLocationIds.map((id) => sql`${id}`),
          sql`, `,
        )})`}
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
    percentage: greenCount > 0 ? (Number(r.count) / greenCount) * 100 : 0,
  }));

  const regionDistribution = regionRows.map((r) => ({
    name: r.name,
    count: Number(r.count),
    percentage: greenCount > 0 ? (Number(r.count) / greenCount) * 100 : 0,
  }));

  const avgKioskCount = kioskRows[0]?.avg_kiosks != null
    ? Number(kioskRows[0].avg_kiosks)
    : null;

  const avgRoomCount = greenRooms.length > 0
    ? greenRooms.reduce((sum, r) => sum + r, 0) / greenRooms.length
    : null;

  const topProducts = topProductRows.map((r) => ({
    name: r.name,
    revenue: Number(r.revenue),
  }));

  // 5. Generate insights
  const insights: string[] = [];

  if (regionDistribution.length > 0) {
    const topRegion = regionDistribution[0];
    insights.push(
      `${topRegion.count} of ${greenCount} top performers are in region ${topRegion.name}`,
    );
  }

  if (avgKioskCount != null) {
    insights.push(
      `Top performers average ${avgKioskCount.toFixed(1)} kiosks per location`,
    );
  }

  if (avgRoomCount != null) {
    insights.push(
      `Top performers average ${Math.round(avgRoomCount)} rooms per location`,
    );
  }

  if (topProducts.length > 0) {
    const topNames = topProducts.slice(0, 3).map((p) => p.name);
    insights.push(`Top ${topNames.length} products: ${topNames.join(", ")}`);
  }

  if (hotelGroupDistribution.length > 0) {
    const topGroup = hotelGroupDistribution[0];
    insights.push(
      `${topGroup.count} of ${greenCount} top performers belong to ${topGroup.name}`,
    );
  }

  return {
    greenCount,
    totalCount,
    insights,
    hotelGroupDistribution,
    regionDistribution,
    avgKioskCount,
    avgRoomCount,
    topProducts,
  };
}
