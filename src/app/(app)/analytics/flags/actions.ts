"use server";

import { db } from "@/db";
import { locationFlags } from "@/db/schema";
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { writeAuditLog } from "@/lib/audit";
import { eq, isNull, and } from "drizzle-orm";
import type { FlagType, LocationFlag } from "@/lib/analytics/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireAuth() {
  const ctx = await getUserCtx();
  // Resolve actor name from the session (getUserCtx returns the effective user,
  // which may be an impersonation target — we need the *real* actor).
  const { auth } = await import("@/lib/auth");
  const { headers } = await import("next/headers");
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) throw new Error("Not authenticated");
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
 */
export async function fetchLocationFlags(
  locationId?: string,
): Promise<LocationFlag[]> {
  await getUserCtx(); // auth gate

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

  return rowToFlag(row);
}
