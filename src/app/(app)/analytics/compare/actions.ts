"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getEntityMetrics, getEntityOptions } from "@/lib/analytics/queries/comparison";
import type {
  AnalyticsFilters,
  ComparisonEntity,
  ComparisonEntityType,
} from "@/lib/analytics/types";

export async function fetchComparisonData(
  entityType: ComparisonEntityType,
  entityIds: string[],
  filters: AnalyticsFilters,
): Promise<ComparisonEntity[]> {
  const userCtx = await getUserCtx();
  return getEntityMetrics(entityType, entityIds, filters, userCtx);
}

export async function fetchEntityOptions(
  entityType: ComparisonEntityType,
): Promise<{ id: string; name: string }[]> {
  await getUserCtx(); // auth check
  return getEntityOptions(entityType);
}
