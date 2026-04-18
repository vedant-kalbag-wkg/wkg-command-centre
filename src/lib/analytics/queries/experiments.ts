import { db } from "@/db";
import { salesRecords, locations } from "@/db/schema";
import { sql, inArray, notInArray, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildExclusionCondition,
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import { getComparisonDates } from "@/lib/analytics/metrics";
import type {
  AnalyticsFilters,
  TemporalComparison,
} from "@/lib/analytics/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

/**
 * Aggregate revenue + transactions for a specific set of location IDs,
 * respecting global filters (date range, exclusions, scoping).
 */
export async function getCohortMetrics(
  locationIds: string[],
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<{ revenue: number; transactions: number; avgRevenue: number }> {
  if (locationIds.length === 0) {
    return { revenue: 0, transactions: 0, avgRevenue: 0 };
  }

  const [scopeCondition, exclusionCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildExclusionCondition(),
  ]);

  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);
  const maturityCondition = buildMaturityCondition(filters);

  const locationCondition = inArray(salesRecords.locationId, locationIds);

  const where = combineConditions([
    dateCondition,
    scopeCondition,
    exclusionCondition,
    maturityCondition,
    locationCondition,
    ...dimensionConditions,
  ]);

  const rows = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${salesRecords.grossAmount}::numeric), 0)`,
      transactions: sql<number>`COUNT(*)::int`,
    })
    .from(salesRecords)
    .innerJoin(locations, sql`${salesRecords.locationId} = ${locations.id}`)
    .where(where);

  const row = rows[0];
  const revenue = Number(row?.revenue ?? 0);
  const transactions = Number(row?.transactions ?? 0);
  const avgRevenue = transactions > 0 ? revenue / transactions : 0;

  return { revenue, transactions, avgRevenue };
}

/**
 * Aggregate revenue + transactions for ALL locations NOT in the given set,
 * i.e. the "rest of portfolio" control group.
 */
export async function getRestOfPortfolioMetrics(
  excludeLocationIds: string[],
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<{ revenue: number; transactions: number; avgRevenue: number }> {
  const [scopeCondition, exclusionCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildExclusionCondition(),
  ]);

  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);
  const maturityCondition = buildMaturityCondition(filters);

  const conditions: (SQL | undefined)[] = [
    dateCondition,
    scopeCondition,
    exclusionCondition,
    maturityCondition,
    ...dimensionConditions,
  ];

  if (excludeLocationIds.length > 0) {
    conditions.push(
      sql`${salesRecords.locationId} NOT IN (${sql.join(
        excludeLocationIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
  }

  const where = combineConditions(conditions);

  const rows = await db
    .select({
      revenue: sql<string>`COALESCE(SUM(${salesRecords.grossAmount}::numeric), 0)`,
      transactions: sql<number>`COUNT(*)::int`,
    })
    .from(salesRecords)
    .innerJoin(locations, sql`${salesRecords.locationId} = ${locations.id}`)
    .where(where);

  const row = rows[0];
  const revenue = Number(row?.revenue ?? 0);
  const transactions = Number(row?.transactions ?? 0);
  const avgRevenue = transactions > 0 ? revenue / transactions : 0;

  return { revenue, transactions, avgRevenue };
}

/**
 * Find locations similar to the cohort based on room count and revenue.
 * Returns up to 10 matched location IDs, excluding the cohort locations.
 */
export async function findSimilarLocations(
  cohortLocationIds: string[],
  userCtx: UserCtx,
  filters: AnalyticsFilters,
): Promise<string[]> {
  if (cohortLocationIds.length === 0) return [];

  // 1. Get the cohort locations' avg room count
  const cohortProfiles = await db
    .select({
      avgRooms: sql<string>`COALESCE(AVG(${locations.numRooms}), 0)`,
    })
    .from(locations)
    .where(inArray(locations.id, cohortLocationIds));

  const avgRooms = Number(cohortProfiles[0]?.avgRooms ?? 0);

  // 2. Get cohort avg revenue per location
  const [scopeCondition, exclusionCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildExclusionCondition(),
  ]);
  const dateCondition = buildDateCondition(filters);

  const cohortRevRows = await db
    .select({
      avgRevPerLocation: sql<string>`COALESCE(SUM(${salesRecords.grossAmount}::numeric) / NULLIF(COUNT(DISTINCT ${salesRecords.locationId}), 0), 0)`,
    })
    .from(salesRecords)
    .innerJoin(locations, sql`${salesRecords.locationId} = ${locations.id}`)
    .where(
      combineConditions([
        dateCondition,
        scopeCondition,
        exclusionCondition,
        inArray(salesRecords.locationId, cohortLocationIds),
      ]),
    );

  const avgRevPerLocation = Number(cohortRevRows[0]?.avgRevPerLocation ?? 0);

  // 3. Build room count bounds: ±30% or ±20 rooms, whichever is larger
  const roomMarginPct = avgRooms * 0.3;
  const roomMargin = Math.max(roomMarginPct, 20);
  const roomLow = Math.max(0, avgRooms - roomMargin);
  const roomHigh = avgRooms + roomMargin;

  // 4. Revenue bounds: ±40%
  const revLow = avgRevPerLocation * 0.6;
  const revHigh = avgRevPerLocation * 1.4;

  // 5. Find matching locations
  const matchRows = await db
    .select({
      locationId: locations.id,
      revenue: sql<string>`COALESCE(SUM(${salesRecords.grossAmount}::numeric), 0)`,
    })
    .from(locations)
    .leftJoin(
      salesRecords,
      combineConditions([
        sql`${salesRecords.locationId} = ${locations.id}`,
        dateCondition,
        scopeCondition,
        exclusionCondition,
      ]),
    )
    .where(
      combineConditions([
        notInArray(locations.id, cohortLocationIds),
        sql`${locations.numRooms} IS NOT NULL`,
        sql`${locations.numRooms} >= ${roomLow}`,
        sql`${locations.numRooms} <= ${roomHigh}`,
      ]),
    )
    .groupBy(locations.id)
    .having(
      sql`COALESCE(SUM(${salesRecords.grossAmount}::numeric), 0) >= ${revLow} AND COALESCE(SUM(${salesRecords.grossAmount}::numeric), 0) <= ${revHigh}`,
    )
    .limit(10);

  return matchRows.map((r) => r.locationId);
}

/**
 * Get temporal comparison for a cohort around its intervention date.
 * Returns metrics for pre-period, during-period, and YoY equivalents.
 */
export async function getCohortTemporalComparison(
  locationIds: string[],
  interventionDate: string,
  userCtx: UserCtx,
): Promise<TemporalComparison> {
  const intervention = new Date(interventionDate);

  // Pre-period: 30 days before intervention
  const preFrom = new Date(intervention);
  preFrom.setDate(preFrom.getDate() - 30);
  const preTo = new Date(intervention);
  preTo.setDate(preTo.getDate() - 1);

  // During: intervention date to 30 days after
  const duringFrom = new Date(intervention);
  const duringTo = new Date(intervention);
  duringTo.setDate(duringTo.getDate() + 30);

  const preFromStr = preFrom.toISOString().split("T")[0];
  const preToStr = preTo.toISOString().split("T")[0];
  const duringFromStr = duringFrom.toISOString().split("T")[0];
  const duringToStr = duringTo.toISOString().split("T")[0];

  // YoY dates
  const { prevFrom: yoyPreFrom, prevTo: yoyPreTo } = getComparisonDates(
    preFromStr,
    preToStr,
    "yoy",
  );
  const { prevFrom: yoyDuringFrom, prevTo: yoyDuringTo } = getComparisonDates(
    duringFromStr,
    duringToStr,
    "yoy",
  );

  // Fetch all 4 periods in parallel
  const [pre, during, yoyPre, yoyDuring] = await Promise.all([
    getCohortMetrics(locationIds, { dateFrom: preFromStr, dateTo: preToStr }, userCtx),
    getCohortMetrics(locationIds, { dateFrom: duringFromStr, dateTo: duringToStr }, userCtx),
    getCohortMetrics(locationIds, { dateFrom: yoyPreFrom, dateTo: yoyPreTo }, userCtx),
    getCohortMetrics(locationIds, { dateFrom: yoyDuringFrom, dateTo: yoyDuringTo }, userCtx),
  ]);

  return {
    pre: {
      ...pre,
      periodLabel: "Pre (30d before)",
      dateFrom: preFromStr,
      dateTo: preToStr,
    },
    during: {
      ...during,
      periodLabel: "During (30d after)",
      dateFrom: duringFromStr,
      dateTo: duringToStr,
    },
    yoyPre: {
      ...yoyPre,
      periodLabel: "YoY Pre",
      dateFrom: yoyPreFrom,
      dateTo: yoyPreTo,
    },
    yoyDuring: {
      ...yoyDuring,
      periodLabel: "YoY During",
      dateFrom: yoyDuringFrom,
      dateTo: yoyDuringTo,
    },
  };
}
