"use server";

import { db } from "@/db";
import { locationFlags } from "@/db/schema";
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { writeAuditLog } from "@/lib/audit";
import { eq, isNull, and } from "drizzle-orm";
import { unstable_cache, revalidateTag } from "next/cache";
import type { FlagType, LocationFlag } from "@/lib/analytics/types";

const FLAGS_TAG = "analytics:flags";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireAuth() {
  // Resolve the effective user (respects impersonation) and the real actor
  // session in parallel. Both calls are React.cache'd so within a single
  // request they reuse the same auth lookup regardless of call order.
  const { getSessionOrThrow } = await import("@/lib/rbac");
  const [ctx, session] = await Promise.all([getUserCtx(), getSessionOrThrow()]);
  return { ctx, actorId: session.user.id, actorName: session.user.name };
}

function rowToFlag(row: typeof locationFlags.$inferSelect): LocationFlag {
  return {
    id: row.id,
    locationId: row.locationId,
    flagType: row.flagType as FlagType,
    reason: row.reason,
    actorName: row.actorName,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionNote: row.resolutionNote,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch all active (unresolved) flags, optionally filtered to a single location.
 *
 * The underlying DB fetch is wrapped with `unstable_cache` (tag:
 * `analytics:flags`) so repeated reads across a request — and across
 * requests within the TTL — hit the cache instead of the DB. The auth
 * gate stays OUTSIDE the cache so every caller is still authorised.
 * Mutations below call `revalidateTag("analytics:flags")` to invalidate.
 */
const fetchLocationFlagsCached = unstable_cache(
  async (locationId?: string): Promise<LocationFlag[]> => {
    const conditions = [isNull(locationFlags.resolvedAt)];
    if (locationId) {
      conditions.push(eq(locationFlags.locationId, locationId));
    }

    const rows = await db
      .select()
      .from(locationFlags)
      .where(and(...conditions))
      .orderBy(locationFlags.createdAt);

    return rows.map(rowToFlag);
  },
  ["analytics", "locationFlags", "v1"],
  { revalidate: 86400, tags: ["analytics", FLAGS_TAG] },
);

export async function fetchLocationFlags(
  locationId?: string,
): Promise<LocationFlag[]> {
  await getUserCtx(); // auth gate — kept OUTSIDE the cache
  return fetchLocationFlagsCached(locationId);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new performance flag on a location.
 */
export async function createFlag(data: {
  locationId: string;
  flagType: FlagType;
  reason?: string;
}): Promise<LocationFlag> {
  const { actorId, actorName } = await requireAuth();

  const [row] = await db
    .insert(locationFlags)
    .values({
      locationId: data.locationId,
      flagType: data.flagType,
      reason: data.reason ?? null,
      actorId,
      actorName,
    })
    .returning();

  await writeAuditLog({
    actorId,
    actorName,
    entityType: "location_flag",
    entityId: row.id,
    entityName: data.flagType,
    action: "flag",
    newValue: data.flagType,
    field: "flagType",
  });

  revalidateTag(FLAGS_TAG, "max");

  return rowToFlag(row);
}

/**
 * Resolve an active flag with an optional resolution note.
 */
export async function resolveFlag(
  flagId: string,
  note?: string,
): Promise<LocationFlag> {
  const { actorId, actorName } = await requireAuth();

  const [row] = await db
    .update(locationFlags)
    .set({
      resolvedAt: new Date(),
      resolvedBy: actorId,
      resolutionNote: note ?? null,
    })
    .where(eq(locationFlags.id, flagId))
    .returning();

  if (!row) throw new Error("Flag not found");

  await writeAuditLog({
    actorId,
    actorName,
    entityType: "location_flag",
    entityId: row.id,
    entityName: row.flagType,
    action: "resolve",
    field: "resolvedAt",
    newValue: row.resolvedAt?.toISOString(),
  });

  revalidateTag(FLAGS_TAG, "max");

  return rowToFlag(row);
}
