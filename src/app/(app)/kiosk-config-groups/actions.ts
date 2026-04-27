"use server";

import { db } from "@/db";
import {
  kioskConfigGroups,
  kiosks,
  kioskAssignments,
  locationProducts,
  locations,
} from "@/db/schema";
import { eq, sql, and, isNull, inArray } from "drizzle-orm";
import { requireRole } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";

export type ConfigGroupListItem = {
  id: string;
  name: string;
  productAvailability: number;
  hotelCount: number;
  kioskCount: number;
  // Phase 7.6c — locations own the link now; `linkedLocationCount` and
  // `hotelCount` collapse to the same value (kept distinct in the type for
  // table back-compat). Both count `locations.kiosk_config_group_id =
  // group.id`.
  linkedLocationCount: number;
};

export async function listConfigGroups(): Promise<ConfigGroupListItem[]> {
  const groups = await db
    .select({
      id: kioskConfigGroups.id,
      name: kioskConfigGroups.name,
    })
    .from(kioskConfigGroups)
    .orderBy(kioskConfigGroups.name);

  const result: ConfigGroupListItem[] = [];
  for (const group of groups) {
    // Count locations directly linked via locations.kiosk_config_group_id
    // (the source of truth post-Phase 7.6c — `kiosks.kiosk_config_group_id`
    // is being dropped in migration 0037).
    const linkedLocationResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(locations)
      .where(
        and(
          eq(locations.kioskConfigGroupId, group.id),
          isNull(locations.archivedAt),
        ),
      );
    const linkedLocationCount = linkedLocationResult[0]?.count ?? 0;

    // Active kiosks at the linked locations. Single-shot CTE-style query so
    // we don't N+1 across groups: the inner select gates by location ids
    // and the outer counts assignments still open.
    const kioskCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(kioskAssignments)
      .innerJoin(locations, eq(kioskAssignments.locationId, locations.id))
      .where(
        and(
          eq(locations.kioskConfigGroupId, group.id),
          isNull(locations.archivedAt),
          isNull(kioskAssignments.unassignedAt),
        ),
      );

    // Distinct active products available across linked locations.
    const locationIdRows = await db
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.kioskConfigGroupId, group.id),
          isNull(locations.archivedAt),
        ),
      );
    let productCount = 0;
    if (locationIdRows.length > 0) {
      const ids = locationIdRows.map((r) => r.id);
      const productCountResult = await db
        .select({ count: sql<number>`count(distinct ${locationProducts.productId})::int` })
        .from(locationProducts)
        .where(
          sql`${locationProducts.locationId} = ANY(${ids}) AND ${locationProducts.availability} = 'yes'`,
        );
      productCount = productCountResult[0]?.count ?? 0;
    }

    result.push({
      id: group.id,
      name: group.name,
      productAvailability: productCount,
      kioskCount: kioskCountResult[0]?.count ?? 0,
      // hotelCount and linkedLocationCount are now the same value;
      // populated separately so the existing table column shape stays put.
      hotelCount: linkedLocationCount,
      linkedLocationCount,
    });
  }
  return result;
}

// Phase 7.6b — detail view for the member-management page.
export type ConfigGroupDetail = {
  id: string;
  name: string;
  members: Array<{ id: string; name: string; outletCode: string | null }>;
  candidates: Array<{ id: string; name: string; outletCode: string | null }>;
};

export async function getConfigGroupDetail(
  groupId: string,
): Promise<ConfigGroupDetail | null> {
  const [group] = await db
    .select({ id: kioskConfigGroups.id, name: kioskConfigGroups.name })
    .from(kioskConfigGroups)
    .where(eq(kioskConfigGroups.id, groupId))
    .limit(1);
  if (!group) return null;

  // Active locations only. Members = currently in this group; candidates =
  // active locations not currently in this group (so the picker can offer
  // them to be added). Listing all active locations as candidates is fine
  // for the prod scale (~400 rows).
  const allActive = await db
    .select({
      id: locations.id,
      name: locations.name,
      outletCode: locations.outletCode,
      kioskConfigGroupId: locations.kioskConfigGroupId,
    })
    .from(locations)
    .where(isNull(locations.archivedAt))
    .orderBy(locations.name);

  const members = allActive
    .filter((l) => l.kioskConfigGroupId === group.id)
    .map(({ id, name, outletCode }) => ({ id, name, outletCode }));
  const candidates = allActive
    .filter((l) => l.kioskConfigGroupId !== group.id)
    .map(({ id, name, outletCode }) => ({ id, name, outletCode }));

  return {
    id: group.id,
    name: group.name,
    members,
    candidates,
  };
}

// Phase 7.6b — bulk apply member changes from the detail page. Diffs the
// requested member set against the current one; sets the FK for new members
// and clears it for departing members. Audit-logs each change. Editor-level
// access (admin OR member) per D13.
export async function setConfigGroupMembers(
  groupId: string,
  locationIds: string[],
) {
  try {
    const session = await requireRole("admin", "member");

    const [group] = await db
      .select({ id: kioskConfigGroups.id, name: kioskConfigGroups.name })
      .from(kioskConfigGroups)
      .where(eq(kioskConfigGroups.id, groupId))
      .limit(1);
    if (!group) return { error: "Config group not found" };

    const requested = new Set(locationIds);
    const currentRows = await db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(eq(locations.kioskConfigGroupId, groupId));
    const current = new Set(currentRows.map((r) => r.id));

    const toAdd = [...requested].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !requested.has(id));

    if (toAdd.length === 0 && toRemove.length === 0) {
      return { success: true as const, addedCount: 0, removedCount: 0 };
    }

    const allTouched = [...new Set([...toAdd, ...toRemove])];
    const nameRows =
      allTouched.length > 0
        ? await db
            .select({ id: locations.id, name: locations.name })
            .from(locations)
            .where(inArray(locations.id, allTouched))
        : [];
    const nameMap = new Map(nameRows.map((r) => [r.id, r.name]));

    if (toAdd.length > 0) {
      // SET to this group regardless of any prior assignment — admin tool
      // semantics. The detail page surfaced any conflicts before the
      // operator clicked Save (the UI shows the location's current group).
      await db
        .update(locations)
        .set({ kioskConfigGroupId: groupId, updatedAt: new Date() })
        .where(inArray(locations.id, toAdd));
    }
    if (toRemove.length > 0) {
      // Only clear if it's still pointing at this group (defence in depth
      // against a concurrent move from another tab).
      await db
        .update(locations)
        .set({ kioskConfigGroupId: null, updatedAt: new Date() })
        .where(
          and(
            inArray(locations.id, toRemove),
            eq(locations.kioskConfigGroupId, groupId),
          ),
        );
    }

    for (const id of toAdd) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "location",
        entityId: id,
        entityName: nameMap.get(id) ?? id,
        action: "assign",
        field: "kiosk_config_group",
        oldValue: undefined,
        newValue: group.name,
      });
    }
    for (const id of toRemove) {
      await writeAuditLog({
        actorId: session.user.id,
        actorName: session.user.name,
        entityType: "location",
        entityId: id,
        entityName: nameMap.get(id) ?? id,
        action: "unassign",
        field: "kiosk_config_group",
        oldValue: group.name,
        newValue: undefined,
      });
    }

    return {
      success: true as const,
      addedCount: toAdd.length,
      removedCount: toRemove.length,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update config group members";
    return { error: message };
  }
}
