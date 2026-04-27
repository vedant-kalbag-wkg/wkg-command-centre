import { cache } from "react";
import { and, inArray } from "drizzle-orm";
import { db } from "@/db";
import { locations } from "@/db/schema";
import { getActiveLocationIds } from "@/lib/analytics/active-locations";
import {
  scopedLocationsCondition,
  type UserCtx,
} from "@/lib/scoping/scoped-query";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

/**
 * Returns the active-location IDs (i.e. excluding archived/exclusion-listed
 * outlets) further restricted to the user's scope. Admins/system users
 * receive the full active list. Wrapped in React.cache so a request with
 * multiple consumers only fires once.
 */
export const getScopedActiveLocationIds = cache(
  async (ctx: UserCtx): Promise<string[]> => {
    const [allActive, scopeCondition] = await Promise.all([
      getActiveLocationIds(),
      scopedLocationsCondition(dbAny, ctx),
    ]);
    if (!scopeCondition) return allActive;
    const rows = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(inArray(locations.id, allActive), scopeCondition));
    return rows.map((r) => r.id);
  },
);
