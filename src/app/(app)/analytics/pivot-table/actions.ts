"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { executePivot } from "@/lib/analytics/queries/pivot";
import type { AnalyticsFilters, PivotConfig, PivotResponse } from "@/lib/analytics/types";

async function getUserCtx() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");

  return {
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
}

export async function fetchPivotData(
  config: PivotConfig,
  filters: AnalyticsFilters,
): Promise<PivotResponse> {
  const userCtx = await getUserCtx();
  return executePivot(config, filters, userCtx);
}
