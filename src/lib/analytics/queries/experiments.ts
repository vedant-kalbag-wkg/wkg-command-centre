import { db } from "@/db";
import { salesRecords, locations } from "@/db/schema";
import { sql, inArray, type SQL } from "drizzle-orm";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildExclusionCondition,
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import type { AnalyticsFilters } from "@/lib/analytics/types";

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
