"use server";

import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { getPortfolioData } from "@/lib/analytics/queries/portfolio";
import type { AnalyticsFilters, PortfolioData } from "@/lib/analytics/types";

export async function fetchPortfolioData(
  filters: AnalyticsFilters,
): Promise<PortfolioData> {
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

  return getPortfolioData(filters, userCtx);
}
