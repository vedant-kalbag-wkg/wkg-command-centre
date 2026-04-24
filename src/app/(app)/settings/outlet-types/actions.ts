"use server";

import { revalidateTag } from "next/cache";
import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import type { LocationType } from "@/lib/analytics/types";
import {
  _bulkSetLocationTypeForActor,
  _listUnclassifiedOutletsForActor,
  _setLocationTypeForActor,
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
