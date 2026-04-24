"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { getEntityMetricsCached, getEntityOptions } from "@/lib/analytics/queries/comparison";
import { canonicaliseFilters } from "@/lib/analytics/canonicalise-filters";
import { getCacheScopeKey } from "@/lib/analytics/cache-scope";
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
  const [, scopeKey] = await Promise.all([getUserCtx(), getCacheScopeKey()]);
  const canonical = canonicaliseFilters(filters);
  return getEntityMetricsCached(canonical, scopeKey, entityType, entityIds);
}

export async function fetchEntityOptions(
  entityType: ComparisonEntityType,
): Promise<{ id: string; name: string }[]> {
  await getUserCtx(); // auth check
  return getEntityOptions(entityType);
}
