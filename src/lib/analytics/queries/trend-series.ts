import { db } from "@/db";
import { executeRows } from "@/db/execute-rows";
import {
  salesRecords,
  businessEvents,
  eventCategories,
  locationHotelGroupMemberships,
  locationRegionMemberships,
  locationGroupMemberships,
} from "@/db/schema";
import { sql, inArray, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import { combineConditions } from "@/lib/analytics/queries/shared";
import { buildActiveLocationCondition } from "@/lib/analytics/active-locations";
import type {
  TrendMetric,
  SeriesFilters,
  TrendDataPoint,
  BusinessEventDisplay,
} from "@/lib/analytics/types";

// ─── Internal: cast db for scopedSalesCondition ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ─── Internal: build series-specific dimension filters ───────────────────────

function buildSeriesDimensionFilters(filters: SeriesFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.productIds?.length) {
    conditions.push(inArray(salesRecords.productId, filters.productIds));
  }
  if (filters.locationIds?.length) {
    conditions.push(inArray(salesRecords.locationId, filters.locationIds));
  }
  if (filters.hotelGroupIds?.length) {
    conditions.push(
      sql`${salesRecords.locationId} IN (
        SELECT ${locationHotelGroupMemberships.locationId}
        FROM ${locationHotelGroupMemberships}
        WHERE ${inArray(locationHotelGroupMemberships.hotelGroupId, filters.hotelGroupIds)}
      )`,
    );
  }
  if (filters.regionIds?.length) {
    conditions.push(
      sql`${salesRecords.locationId} IN (
        SELECT ${locationRegionMemberships.locationId}
        FROM ${locationRegionMemberships}
        WHERE ${inArray(locationRegionMemberships.regionId, filters.regionIds)}
      )`,
    );
  }
  if (filters.locationGroupIds?.length) {
    conditions.push(
      sql`${salesRecords.locationId} IN (
        SELECT ${locationGroupMemberships.locationId}
        FROM ${locationGroupMemberships}
        WHERE ${inArray(locationGroupMemberships.locationGroupId, filters.locationGroupIds)}
      )`,
    );
  }
  return conditions;
}

// ─── Internal: metric aggregation expression ─────────────────────────────────

function metricExpression(metric: TrendMetric): SQL {
  switch (metric) {
    case "revenue":
      return sql`SUM(${salesRecords.grossAmount}::numeric)`;
    case "transactions":
      return sql`COUNT(*)::numeric`;
    case "avg_basket_value":
      return sql`SUM(${salesRecords.grossAmount}::numeric) / NULLIF(COUNT(*), 0)`;
    case "booking_fee":
      return sql`SUM(${salesRecords.bookingFee}::numeric)`;
  }
}

// ─── Main Query ──────────────────────────────────────────────────────────────

export async function getTrendSeriesData(
  metric: TrendMetric,
  filters: SeriesFilters,
  dateFrom: string,
  dateTo: string,
  userCtx: UserCtx,
): Promise<TrendDataPoint[]> {
  // Phase 1 #6: `buildActiveLocationCondition` replaces the old
  // `buildExclusionCondition` + INNER JOIN locations. Dropping the JOIN keeps
  // this query on the sales_records covering index alone.
  const [scopeCondition, activeLocationCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildActiveLocationCondition(),
  ]);

  const dateCondition = sql`${salesRecords.transactionDate} >= ${dateFrom} AND ${salesRecords.transactionDate} <= ${dateTo}`;
  const seriesConditions = buildSeriesDimensionFilters(filters);

  const whereClause = combineConditions([
    dateCondition,
    scopeCondition,
    activeLocationCondition,
    ...seriesConditions,
  ]);

  const rows = await executeRows<{
    date: string;
    value: string;
  }>(sql`
    SELECT
      ${salesRecords.transactionDate}::text AS date,
      COALESCE(${metricExpression(metric)}, 0) AS value
    FROM ${salesRecords}
    ${whereClause ? sql`WHERE ${whereClause}` : sql``}
    GROUP BY ${salesRecords.transactionDate}
    ORDER BY ${salesRecords.transactionDate} ASC
  `);

  return rows.map((row) => ({
    date: row.date,
    value: Number(row.value),
  }));
}

// ─── Business Events Query ───────────────────────────────────────────────────

export async function getBusinessEvents(
  dateFrom: string,
  dateTo: string,
): Promise<BusinessEventDisplay[]> {
  const rows = await executeRows<{
    id: string;
    title: string;
    description: string | null;
    start_date: string;
    end_date: string | null;
    category_id: string;
    category_name: string;
    category_color: string;
    scope_type: string | null;
    scope_value: string | null;
  }>(sql`
    SELECT
      ${businessEvents.id}::text AS id,
      ${businessEvents.title} AS title,
      ${businessEvents.description} AS description,
      ${businessEvents.startDate}::text AS start_date,
      ${businessEvents.endDate}::text AS end_date,
      ${businessEvents.categoryId}::text AS category_id,
      ${eventCategories.name} AS category_name,
      ${eventCategories.color} AS category_color,
      ${businessEvents.scopeType} AS scope_type,
      ${businessEvents.scopeValue} AS scope_value
    FROM ${businessEvents}
      INNER JOIN ${eventCategories} ON ${businessEvents.categoryId} = ${eventCategories.id}
    WHERE ${businessEvents.startDate} <= ${dateTo}
      AND (${businessEvents.endDate} IS NULL OR ${businessEvents.endDate} >= ${dateFrom})
    ORDER BY ${businessEvents.startDate} ASC
  `);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryColor: row.category_color,
    scopeType: (row.scope_type ?? "global") as BusinessEventDisplay["scopeType"],
    scopeValue: row.scope_value,
  }));
}
