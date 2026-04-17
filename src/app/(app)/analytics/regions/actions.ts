"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getRegionsList, getRegionDetail } from "@/lib/analytics/queries/regions";
import type {
  AnalyticsFilters,
  RegionData,
  RegionDetail,
} from "@/lib/analytics/types";

export async function fetchRegionsList(
  filters: AnalyticsFilters,
): Promise<RegionData[]> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");

  const userCtx = {
    id: session.user.id,
    userType:
      (session.user as unknown as { userType: "internal" | "external" })
        .userType ?? "internal",
    role: (session.user.role ?? null) as
      | "admin"
      | "member"
      | "viewer"
      | null,
  };

  return getRegionsList(filters, userCtx);
}

export async function fetchRegionDetail(
  regionIds: string[],
  filters: AnalyticsFilters,
): Promise<RegionDetail> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");

  const userCtx = {
    id: session.user.id,
    userType:
      (session.user as unknown as { userType: "internal" | "external" })
        .userType ?? "internal",
    role: (session.user.role ?? null) as
      | "admin"
      | "member"
      | "viewer"
      | null,
  };

  return getRegionDetail(regionIds, filters, userCtx);
}
