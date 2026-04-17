"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getLocationGroupsList, getLocationGroupDetail } from "@/lib/analytics/queries/location-groups";
import type {
  AnalyticsFilters,
  LocationGroupData,
  LocationGroupDetail,
} from "@/lib/analytics/types";

export async function fetchLocationGroupsList(
  filters: AnalyticsFilters,
): Promise<LocationGroupData[]> {
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

  return getLocationGroupsList(filters, userCtx);
}

export async function fetchLocationGroupDetail(
  groupIds: string[],
  filters: AnalyticsFilters,
): Promise<LocationGroupDetail> {
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

  return getLocationGroupDetail(groupIds, filters, userCtx);
}
