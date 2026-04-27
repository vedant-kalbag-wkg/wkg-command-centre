"use server";

import { db } from "@/db";
import { experimentCohorts, locations } from "@/db/schema";
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { writeAuditLog } from "@/lib/audit";
import { eq, inArray } from "drizzle-orm";
import {
  getCohortMetrics,
  getRestOfPortfolioMetrics,
  findSimilarLocations,
  getCohortTemporalComparison,
} from "@/lib/analytics/queries/experiments";
import { getActiveLocationIds } from "@/lib/analytics/active-locations";
import { scopedLocationsCondition } from "@/lib/scoping/scoped-query";
import { getScopedActiveLocationIds } from "@/lib/scoping/scoped-active-locations";
import { combineConditions } from "@/lib/analytics/queries/shared";
import type {
  AnalyticsFilters,
  ExperimentCohort,
  CohortComparison,
  TemporalComparison,
} from "@/lib/analytics/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireAuth() {
  const ctx = await getUserCtx();
  const { auth } = await import("@/lib/auth");
  const { headers } = await import("next/headers");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");
  return { ctx, actorId: session.user.id, actorName: session.user.name };
}

function rowToCohort(
  row: typeof experimentCohorts.$inferSelect,
): ExperimentCohort {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    locationIds: (row.locationIds ?? []) as string[],
    controlType: row.controlType as "rest_of_portfolio" | "named_control",
    controlLocationIds: (row.controlLocationIds as string[] | null) ?? null,
    interventionDate: row.interventionDate,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List all cohorts. Admins see everything; non-admins see only their own.
 */
export async function listCohorts(): Promise<ExperimentCohort[]> {
  const ctx = await getUserCtx();

  const rows =
    ctx.role === "admin"
      ? await db
          .select()
          .from(experimentCohorts)
          .orderBy(experimentCohorts.createdAt)
      : await db
          .select()
          .from(experimentCohorts)
          .where(eq(experimentCohorts.createdBy, ctx.id))
          .orderBy(experimentCohorts.createdAt);

  return rows.map(rowToCohort);
}

/**
 * Fetch locations for the cohort picker. Honours the caller's scope
 * (external-region users only see locations within their region(s)) and
 * outlet_exclusions (TEST/training outlets are filtered out).
 */
export async function listLocationsForPicker(): Promise<
  { id: string; name: string }[]
> {
  const ctx = await getUserCtx();
  const [scopeCondition, activeIds] = await Promise.all([
    scopedLocationsCondition(dbAny, ctx),
    getActiveLocationIds(),
  ]);
  const rows = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(
      combineConditions([inArray(locations.id, activeIds), scopeCondition]),
    )
    .orderBy(locations.name);
  return rows;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new experiment cohort.
 */
export async function createCohort(data: {
  name: string;
  description?: string;
  locationIds: string[];
  controlType: "rest_of_portfolio" | "named_control";
  controlLocationIds?: string[];
  interventionDate?: string;
}): Promise<ExperimentCohort> {
  const { ctx, actorId, actorName } = await requireAuth();

  const [row] = await db
    .insert(experimentCohorts)
    .values({
      name: data.name,
      description: data.description ?? null,
      locationIds: data.locationIds,
      controlType: data.controlType,
      controlLocationIds: data.controlLocationIds ?? null,
      interventionDate: data.interventionDate ?? null,
      createdBy: ctx.id,
    })
    .returning();

  await writeAuditLog({
    actorId,
    actorName,
    entityType: "experiment_cohort",
    entityId: row.id,
    entityName: data.name,
    action: "create",
  });

  return rowToCohort(row);
}

/**
 * Delete an experiment cohort.
 */
export async function deleteCohort(id: string): Promise<void> {
  const { actorId, actorName } = await requireAuth();

  const [row] = await db
    .select()
    .from(experimentCohorts)
    .where(eq(experimentCohorts.id, id))
    .limit(1);

  if (!row) throw new Error("Cohort not found");

  await db.delete(experimentCohorts).where(eq(experimentCohorts.id, id));

  await writeAuditLog({
    actorId,
    actorName,
    entityType: "experiment_cohort",
    entityId: id,
    entityName: row.name,
    action: "delete",
  });
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare cohort metrics against control group metrics.
 */
export async function fetchCohortComparison(
  cohortId: string,
  filters: AnalyticsFilters,
): Promise<CohortComparison> {
  const ctx = await getUserCtx();

  const [cohort] = await db
    .select()
    .from(experimentCohorts)
    .where(eq(experimentCohorts.id, cohortId))
    .limit(1);

  if (!cohort) throw new Error("Cohort not found");

  const cohortLocationIds = (cohort.locationIds ?? []) as string[];
  const cohortSize = cohortLocationIds.length;

  // Fetch cohort metrics
  const cohortMetrics = await getCohortMetrics(cohortLocationIds, filters, ctx);

  // Fetch control metrics + size
  let controlMetrics: { revenue: number; transactions: number; avgRevenue: number };
  let controlSize: number;

  if (cohort.controlType === "named_control" && cohort.controlLocationIds) {
    const controlIds = cohort.controlLocationIds as string[];
    controlSize = controlIds.length;
    controlMetrics = await getCohortMetrics(controlIds, filters, ctx);
  } else {
    // rest_of_portfolio — exclude cohort locations from scoped+active universe.
    const scopedActiveIds = await getScopedActiveLocationIds(ctx);
    const cohortSet = new Set(cohortLocationIds);
    controlSize = scopedActiveIds.filter((id) => !cohortSet.has(id)).length;
    controlMetrics = await getRestOfPortfolioMetrics(
      cohortLocationIds,
      filters,
      ctx,
    );
  }

  // Per-location normalisation. Comparing a 5-hotel cohort vs a 200-hotel
  // control on raw totals would be dominated by group-size disparity; divide
  // through to make the delta interpretable. avgRevenue is already
  // per-transaction so its delta is meaningful as-is.
  const safeDiv = (n: number, d: number) => (d > 0 ? n / d : 0);
  const delta = {
    revenue:
      safeDiv(cohortMetrics.revenue, cohortSize) -
      safeDiv(controlMetrics.revenue, controlSize),
    transactions:
      safeDiv(cohortMetrics.transactions, cohortSize) -
      safeDiv(controlMetrics.transactions, controlSize),
    avgRevenue: cohortMetrics.avgRevenue - controlMetrics.avgRevenue,
  };

  return { cohortMetrics, controlMetrics, cohortSize, controlSize, delta };
}

// ---------------------------------------------------------------------------
// Similar Hotels
// ---------------------------------------------------------------------------

/**
 * Find similar hotels based on room count and revenue characteristics.
 * Returns location IDs and names of matched hotels.
 */
export async function findSimilarHotels(
  cohortLocationIds: string[],
  filters: AnalyticsFilters,
): Promise<{ id: string; name: string }[]> {
  const ctx = await getUserCtx();

  const matchedIds = await findSimilarLocations(cohortLocationIds, ctx, filters);

  if (matchedIds.length === 0) return [];

  const rows = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(inArray(locations.id, matchedIds));

  return rows;
}

// ---------------------------------------------------------------------------
// Temporal Comparison
// ---------------------------------------------------------------------------

/**
 * Fetch temporal comparison data for a cohort with an intervention date.
 * Respects the global FilterBar — `filters` is forwarded to the underlying
 * cohort metrics aggregation (only the per-period date range is overridden).
 */
export async function fetchTemporalComparison(
  cohortId: string,
  filters: AnalyticsFilters,
): Promise<TemporalComparison | null> {
  const ctx = await getUserCtx();

  const [cohort] = await db
    .select()
    .from(experimentCohorts)
    .where(eq(experimentCohorts.id, cohortId))
    .limit(1);

  if (!cohort) throw new Error("Cohort not found");
  if (!cohort.interventionDate) return null;

  const cohortLocationIds = (cohort.locationIds ?? []) as string[];

  return getCohortTemporalComparison(
    cohortLocationIds,
    cohort.interventionDate,
    filters,
    ctx,
  );
}
