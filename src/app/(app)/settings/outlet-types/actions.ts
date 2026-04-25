"use server";

import { revalidateTag } from "next/cache";
import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import type { LocationType } from "@/lib/analytics/types";
import {
  _bulkSetLocationTypeForActor,
  _bulkSetPrimaryRegionForActor,
  _listRegionsForActor,
  _listUnclassifiedOutletsForActor,
  _setLocationTypeForActor,
  _setPrimaryRegionForActor,
  type RegionOption,
  type UnclassifiedOutletRow,
} from "./pipeline";

/**
 * Thin "use server" wrappers around the outlet-types pipeline. Each action
 *   1. enforces requireRole('admin') — only admins can classify outlets,
 *   2. delegates to the actor-parameterised pipeline helper,
 *   3. (for writes) revalidates the 'analytics' cache tag so the Location
 *      Type filter dropdowns + portfolio page re-fetch with the fresh
 *      classifications next request.
 */

export async function listUnclassifiedOutletsAction(): Promise<UnclassifiedOutletRow[]> {
  await requireRole("admin");
  return _listUnclassifiedOutletsForActor(db);
}

export async function listRegionsAction(): Promise<RegionOption[]> {
  await requireRole("admin");
  return _listRegionsForActor(db);
}

export async function setLocationTypeAction(
  locationId: string,
  type: LocationType,
): Promise<void> {
  const session = await requireRole("admin");
  const actor = { id: session.user.id, name: session.user.name };
  await _setLocationTypeForActor(db, actor, locationId, type);
  revalidateTag("analytics", "max");
}

export async function bulkSetLocationTypeAction(
  locationIds: string[],
  type: LocationType,
): Promise<void> {
  const session = await requireRole("admin");
  const actor = { id: session.user.id, name: session.user.name };
  await _bulkSetLocationTypeForActor(db, actor, locationIds, type);
  revalidateTag("analytics", "max");
}

/**
 * Single-row region reassignment. The pipeline helper throws on
 * composite-unique conflicts; we surface the message via a structured result
 * so the UI can render a destructive toast without crashing.
 */
export async function setPrimaryRegionAction(
  locationId: string,
  regionId: string,
): Promise<
  | { status: "ok" }
  | { status: "conflict"; message: string }
> {
  const session = await requireRole("admin");
  const actor = { id: session.user.id, name: session.user.name };
  try {
    await _setPrimaryRegionForActor(db, actor, locationId, regionId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("Cannot move ")) {
      return { status: "conflict", message };
    }
    throw err;
  }
  revalidateTag("analytics", "max");
  return { status: "ok" };
}

/**
 * Bulk region reassignment. The pipeline helper splits the input into
 * applied (`okIds`) and skipped (`conflictingIds`) so the UI can show a
 * partial-success toast — full failure would happen only if every requested
 * id collides, which is rare.
 */
export async function bulkSetPrimaryRegionAction(
  locationIds: string[],
  regionId: string,
): Promise<{ okIds: string[]; conflictingIds: string[] }> {
  const session = await requireRole("admin");
  const actor = { id: session.user.id, name: session.user.name };
  const result = await _bulkSetPrimaryRegionForActor(
    db,
    actor,
    locationIds,
    regionId,
  );
  if (result.okIds.length > 0) revalidateTag("analytics", "max");
  return result;
}
