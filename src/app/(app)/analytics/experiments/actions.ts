"use server";

import { db } from "@/db";
import { experimentCohorts, locations } from "@/db/schema";
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { writeAuditLog } from "@/lib/audit";
import { eq } from "drizzle-orm";
import {
  getCohortMetrics,
  getRestOfPortfolioMetrics,
} from "@/lib/analytics/queries/experiments";
import type {
  AnalyticsFilters,
  ExperimentCohort,
  CohortComparison,
} from "@/lib/analytics/types";

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
 * Fetch all locations for the location picker.
 */
export async function listLocationsForPicker(): Promise<
  { id: string; name: string }[]
> {
  await getUserCtx(); // auth gate
  const rows = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
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

  // Fetch cohort metrics
  const cohortMetrics = await getCohortMetrics(cohortLocationIds, filters, ctx);

  // Fetch control metrics
  let controlMetrics: { revenue: number; transactions: number; avgRevenue: number };

  if (cohort.controlType === "named_control" && cohort.controlLocationIds) {
    const controlIds = cohort.controlLocationIds as string[];
    controlMetrics = await getCohortMetrics(controlIds, filters, ctx);
  } else {
    // rest_of_portfolio — exclude cohort locations
    controlMetrics = await getRestOfPortfolioMetrics(
      cohortLocationIds,
      filters,
      ctx,
    );
  }

  // Compute deltas
  const delta = {
    revenue: cohortMetrics.revenue - controlMetrics.revenue,
    transactions: cohortMetrics.transactions - controlMetrics.transactions,
    avgRevenue: cohortMetrics.avgRevenue - controlMetrics.avgRevenue,
  };

  return { cohortMetrics, controlMetrics, delta };
}
