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
  await getUserCtx();
  const canonical = canonicaliseFilters(filters);
  const scopeKey = await getCacheScopeKey();
  return getEntityMetricsCached(canonical, scopeKey, entityType, entityIds);
}

export async function fetchEntityOptions(
  entityType: ComparisonEntityType,
): Promise<{ id: string; name: string }[]> {
  await getUserCtx(); // auth check
  return getEntityOptions(entityType);
}
