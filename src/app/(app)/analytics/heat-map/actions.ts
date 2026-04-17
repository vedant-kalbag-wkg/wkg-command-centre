"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getHeatMapData } from "@/lib/analytics/queries/heat-map";
import type { AnalyticsFilters, HeatMapData } from "@/lib/analytics/types";

export async function fetchHeatMapData(
  filters: AnalyticsFilters,
): Promise<HeatMapData> {
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

  return getHeatMapData(filters, userCtx);
}
