import { type SQL } from "drizzle-orm";
import { db } from "@/db";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildExclusionCondition,
  buildDateCondition,
  buildDimensionFilters,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import type { AnalyticsFilters } from "@/lib/analytics/types";

// scopedSalesCondition expects NodePgDatabase<any> but our db is postgres-js.
// The internal Drizzle SQL builder API is compatible; cast to satisfy the type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

export async function buildCommissionWhere(
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
