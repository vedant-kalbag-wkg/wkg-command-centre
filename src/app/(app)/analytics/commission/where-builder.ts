import { type SQL } from "drizzle-orm";
import { db } from "@/db";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildDateCondition,
  buildDimensionFilters,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import { buildActiveLocationCondition } from "@/lib/analytics/active-locations";
import type { AnalyticsFilters } from "@/lib/analytics/types";

// scopedSalesCondition expects NodePgDatabase<any> but our db is postgres-js.
// The internal Drizzle SQL builder API is compatible; cast to satisfy the type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

export async function buildCommissionWhere(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<SQL | undefined> {
  // PR #40 review (Nit #7): import buildActiveLocationCondition directly from
  // @/lib/analytics/active-locations rather than via the legacy
  // buildExclusionCondition alias in shared.ts (which was a delegate to the
  // same helper after migration 0040 dropped locations.outlet_code). The alias
  // was removed in this PR; this is the canonical predicate name.
  const [scopeCondition, activeLocationCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildActiveLocationCondition(),
  ]);
  const dateCondition = buildDateCondition(filters);
  const dimensionConditions = buildDimensionFilters(filters);

  return combineConditions([
    dateCondition,
    scopeCondition,
    activeLocationCondition,
    ...dimensionConditions,
  ]);
}
