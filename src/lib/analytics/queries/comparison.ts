import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import {
  salesRecords,
  locations,
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
import { wrapAnalyticsQuery } from "@/lib/analytics/cached-query";
import type {
  AnalyticsFilters,
  ComparisonEntity,
  ComparisonEntityType,
} from "@/lib/analytics/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Internal: build WHERE clause ───────────────────────────────────────────

async function buildComparisonWhere(
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

// ─── Entity Metrics ─────────────────────────────────────────────────────────

export async function getEntityMetrics(
  entityType: ComparisonEntityType,
  entityIds: string[],
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<ComparisonEntity[]> {
  if (entityIds.length === 0) return [];

  const whereClause = await buildComparisonWhere(filters, userCtx);
  const idList = sql.raw(`(${entityIds.map((id) => `'${id}'`).join(",")})`);

  switch (entityType) {
    case "location":
      return getLocationMetrics(entityIds, idList, whereClause);
    case "hotel_group":
      return getHotelGroupMetrics(entityIds, idList, whereClause);
    case "region":
      return getRegionMetrics(entityIds, idList, whereClause);
  }
}

// ─── Location metrics ───────────────────────────────────────────────────────

async function getLocationMetrics(
  _entityIds: string[],
  idList: SQL,
  whereClause: SQL | undefined,
): Promise<ComparisonEntity[]> {
  const entityFilter = sql`${salesRecords.locationId} IN ${idList}`;
  const fullWhere = combineConditions([whereClause, entityFilter]);

  const rows = await executeRows<{
    entity_id: string;
    entity_name: string;
    revenue: string;
    transactions: string;
  }>(sql`
    SELECT
      ${locations.id} AS entity_id,
      ${locations.name} AS entity_name,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions
    FROM ${salesRecords}
      INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
    GROUP BY ${locations.id}, ${locations.name}
    ORDER BY revenue DESC
  `);

  return rows.map((row) => {
    const revenue = Number(row.revenue);
    const transactions = Number(row.transactions);
    return {
      entityId: row.entity_id,
      entityName: row.entity_name,
      revenue,
      transactions,
      avgBasket: transactions > 0 ? revenue / transactions : 0,
    };
  });
}

// ─── Hotel group metrics ────────────────────────────────────────────────────

async function getHotelGroupMetrics(
  _entityIds: string[],
  idList: SQL,
  whereClause: SQL | undefined,
): Promise<ComparisonEntity[]> {
  const entityFilter = sql`${hotelGroups.id} IN ${idList}`;
  const fullWhere = combineConditions([whereClause, entityFilter]);

  const rows = await executeRows<{
    entity_id: string;
    entity_name: string;
    revenue: string;
    transactions: string;
  }>(sql`
    SELECT
      ${hotelGroups.id} AS entity_id,
      ${hotelGroups.name} AS entity_name,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions
    FROM ${salesRecords}
      INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
      INNER JOIN ${locationHotelGroupMemberships} ON ${locations.id} = ${locationHotelGroupMemberships.locationId}
      INNER JOIN ${hotelGroups} ON ${locationHotelGroupMemberships.hotelGroupId} = ${hotelGroups.id}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
    GROUP BY ${hotelGroups.id}, ${hotelGroups.name}
    ORDER BY revenue DESC
  `);

  return rows.map((row) => {
    const revenue = Number(row.revenue);
    const transactions = Number(row.transactions);
    return {
      entityId: row.entity_id,
      entityName: row.entity_name,
      revenue,
      transactions,
      avgBasket: transactions > 0 ? revenue / transactions : 0,
    };
  });
}

// ─── Region metrics ─────────────────────────────────────────────────────────

async function getRegionMetrics(
  _entityIds: string[],
  idList: SQL,
  whereClause: SQL | undefined,
): Promise<ComparisonEntity[]> {
  const entityFilter = sql`${regions.id} IN ${idList}`;
  const fullWhere = combineConditions([whereClause, entityFilter]);

  const rows = await executeRows<{
    entity_id: string;
    entity_name: string;
    revenue: string;
    transactions: string;
  }>(sql`
    SELECT
      ${regions.id} AS entity_id,
      ${regions.name} AS entity_name,
      COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
      COUNT(*)::text AS transactions
    FROM ${salesRecords}
      INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
      INNER JOIN ${locationRegionMemberships} ON ${locations.id} = ${locationRegionMemberships.locationId}
      INNER JOIN ${regions} ON ${locationRegionMemberships.regionId} = ${regions.id}
    ${fullWhere ? sql`WHERE ${fullWhere}` : sql``}
    GROUP BY ${regions.id}, ${regions.name}
    ORDER BY revenue DESC
  `);

  return rows.map((row) => {
    const revenue = Number(row.revenue);
    const transactions = Number(row.transactions);
    return {
      entityId: row.entity_id,
      entityName: row.entity_name,
      revenue,
      transactions,
      avgBasket: transactions > 0 ? revenue / transactions : 0,
    };
  });
}

// ─── Entity Options (for picker) ────────────────────────────────────────────

export async function getEntityOptions(
  entityType: ComparisonEntityType,
): Promise<{ id: string; name: string }[]> {
  switch (entityType) {
    case "location": {
      const rows = await db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .orderBy(locations.name);
      return rows;
    }
    case "hotel_group": {
      const rows = await db
        .select({ id: hotelGroups.id, name: hotelGroups.name })
        .from(hotelGroups)
        .orderBy(hotelGroups.name);
      return rows;
    }
    case "region": {
      const rows = await db
        .select({ id: regions.id, name: regions.name })
        .from(regions)
        .orderBy(regions.name);
      return rows;
    }
  }
}

// ─── Cached variants (Phase 3) ───────────────────────────────────────────────
// Existing `getEntityMetrics` signature is (entityType, entityIds, filters,
// userCtx) — doesn't match wrapAnalyticsQuery's (filters, userCtx, ...rest)
// contract. Thin shim reorders args at the call site without mutating the
// uncached export (callers of the uncached fn keep working unchanged).

const getEntityMetricsReordered = (
  filters: AnalyticsFilters,
  userCtx: UserCtx,
  entityType: ComparisonEntityType,
  entityIds: string[],
): Promise<ComparisonEntity[]> => getEntityMetrics(entityType, entityIds, filters, userCtx);

export const getEntityMetricsCached = wrapAnalyticsQuery(getEntityMetricsReordered, {
  name: "getEntityMetrics",
  tags: ["analytics", "analytics:compare"],
});
