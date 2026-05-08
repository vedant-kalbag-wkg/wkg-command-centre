"use server";

import { db } from "@/db";
import { actionItems, locationFlags, locations } from "@/db/schema";
import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { writeAuditLog } from "@/lib/audit";
import { eq, isNull, isNotNull, and, inArray, asc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { unstable_cache, revalidateTag } from "next/cache";
import type { FlagType, LocationFlag } from "@/lib/analytics/types";

export type FlagWithLocation = LocationFlag & {
  locationName: string | null;
  outletCode: string | null;
  linkedActionCount: number;
};

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
// Flag Review page queries (Task 4.12)
// ---------------------------------------------------------------------------

type AllFlagsFilters = {
  resolved?: boolean | "all";
  locationIds?: string[];
  flagTypes?: FlagType[];
};

/**
 * Fetch flags joined with location name + outlet code, with optional
 * resolved/type/location filters. Used by the Flag Review page.
 *
 * `resolved` semantics:
 *   - `false` (default) → only active flags (resolved_at IS NULL)
 *   - `true`            → only resolved flags (resolved_at IS NOT NULL)
 *   - `"all"`           → both
 *
 * Cached with `unstable_cache` keyed on the JSON of the filter object.
 * Mutations on this table call `revalidateTag(FLAGS_TAG)` so cache stays
 * coherent without a separate invalidation key per filter combination.
 */
// Build a stable cache key regardless of caller-side key insertion order or
// array ordering. JSON.stringify(filters) alone fragments the cache when an
// equivalent filter object happens to serialise differently (e.g. `{a, b}`
// vs `{b, a}`, or a `flagTypes` array passed in shuffled order).
function canonicaliseFilterKey(
  filters: AllFlagsFilters | undefined,
): string {
  return JSON.stringify({
    resolved: filters?.resolved ?? false,
    flagTypes: filters?.flagTypes?.slice().sort() ?? [],
    locationIds: filters?.locationIds?.slice().sort() ?? [],
  });
}

const fetchAllFlagsCached = unstable_cache(
  async (filtersJson: string): Promise<FlagWithLocation[]> => {
    const filters: AllFlagsFilters = filtersJson ? JSON.parse(filtersJson) : {};
    const conditions: SQL[] = [];

    const resolved = filters.resolved ?? false;
    if (resolved === false) {
      conditions.push(isNull(locationFlags.resolvedAt));
    } else if (resolved === true) {
      conditions.push(isNotNull(locationFlags.resolvedAt));
    }
    // "all" → no resolved-state filter

    if (filters.locationIds && filters.locationIds.length > 0) {
      conditions.push(inArray(locationFlags.locationId, filters.locationIds));
    }
    if (filters.flagTypes && filters.flagTypes.length > 0) {
      conditions.push(inArray(locationFlags.flagType, filters.flagTypes));
    }

    const rows = await db
      .select({
        id: locationFlags.id,
        locationId: locationFlags.locationId,
        flagType: locationFlags.flagType,
        reason: locationFlags.reason,
        actorName: locationFlags.actorName,
        createdAt: locationFlags.createdAt,
        resolvedAt: locationFlags.resolvedAt,
        resolutionNote: locationFlags.resolutionNote,
        locationName: locations.name,
        outletCode: locations.outletCode,
        // Correlated subquery: count of action items linked back to this
        // flag. Done in-query so the Flag Review page renders in a single
        // roundtrip rather than firing N separate `fetchActionItemsForFlag`
        // calls (one per visible flag) just to display a count badge.
        // `action_items.source_id` is `text` while `location_flags.id` is
        // `uuid`; the explicit `::text` cast keeps the comparison sound.
        linkedActionCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${actionItems}
          WHERE ${actionItems.sourceType} = 'flag'
            AND ${actionItems.sourceId} = ${locationFlags.id}::text
        )`.as("linked_action_count"),
      })
      .from(locationFlags)
      .leftJoin(locations, eq(locationFlags.locationId, locations.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(locationFlags.createdAt));

    return rows.map((r) => ({
      id: r.id,
      locationId: r.locationId,
      flagType: r.flagType as FlagType,
      reason: r.reason,
      actorName: r.actorName,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolutionNote: r.resolutionNote,
      locationName: r.locationName ?? null,
      outletCode: r.outletCode ?? null,
      linkedActionCount: Number(r.linkedActionCount ?? 0),
    }));
  },
  ["analytics", "allFlags", "v1"],
  { revalidate: 86400, tags: ["analytics", FLAGS_TAG] },
);

export async function fetchAllFlags(
  filters?: AllFlagsFilters,
): Promise<FlagWithLocation[]> {
  await getUserCtx(); // auth gate — kept OUTSIDE the cache
  return fetchAllFlagsCached(canonicaliseFilterKey(filters));
}

/**
 * Returns the distinct list of locations that have ever been flagged
 * (active OR resolved) — used by the Flag Review page's location filter.
 */
export async function fetchFlaggedLocations(): Promise<
  { id: string; name: string }[]
> {
  await getUserCtx(); // auth gate

  const rows = await db
    .selectDistinct({ id: locations.id, name: locations.name })
    .from(locationFlags)
    .innerJoin(locations, eq(locationFlags.locationId, locations.id))
    .orderBy(locations.name);

  return rows;
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
