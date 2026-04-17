"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getHotelGroupsList, getHotelGroupDetail } from "@/lib/analytics/queries/hotel-groups";
import type {
  AnalyticsFilters,
  HotelGroupData,
  HotelGroupDetail,
} from "@/lib/analytics/types";

export async function fetchHotelGroupsList(
  filters: AnalyticsFilters,
): Promise<HotelGroupData[]> {
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

  return getHotelGroupsList(filters, userCtx);
}

export async function fetchHotelGroupDetail(
  groupIds: string[],
  filters: AnalyticsFilters,
): Promise<HotelGroupDetail> {
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

  return getHotelGroupDetail(groupIds, filters, userCtx);
}
