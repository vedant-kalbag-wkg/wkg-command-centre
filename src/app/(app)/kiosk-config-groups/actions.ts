"use server";

import { db } from "@/db";
import {
  kioskConfigGroups,
  kiosks,
  kioskAssignments,
  locationProducts,
} from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { eq, sql } from "drizzle-orm";
import { fetchAllItems } from "@/lib/monday-client";

export type ConfigGroupListItem = {
  id: string;
  name: string;
  productAvailability: number;
  hotelCount: number;
  kioskCount: number;
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
    // Count kiosks in this group
    const kioskCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(kiosks)
      .where(eq(kiosks.kioskConfigGroupId, group.id));

    // Count unique locations (hotels) that have kiosks in this group via kioskAssignments
    const hotelCountResult = await db
      .select({ count: sql<number>`count(distinct ${kioskAssignments.locationId})::int` })
      .from(kiosks)
      .innerJoin(kioskAssignments, eq(kiosks.id, kioskAssignments.kioskId))
      .where(eq(kiosks.kioskConfigGroupId, group.id));

    // Count distinct products available across locations that have kiosks in this group
    const locationIds = await db
      .selectDistinct({ locationId: kioskAssignments.locationId })
      .from(kiosks)
      .innerJoin(kioskAssignments, eq(kiosks.id, kioskAssignments.kioskId))
      .where(eq(kiosks.kioskConfigGroupId, group.id));

    let productCount = 0;
    if (locationIds.length > 0) {
      const ids = locationIds.map((r) => r.locationId);
      const productCountResult = await db
        .select({ count: sql<number>`count(distinct ${locationProducts.productId})::int` })
        .from(locationProducts)
        .where(
          sql`${locationProducts.locationId} = ANY(${ids}) AND ${locationProducts.availability} = 'yes'`
        );
      productCount = productCountResult[0]?.count ?? 0;
    }

    result.push({
      id: group.id,
      name: group.name,
      productAvailability: productCount,
      kioskCount: kioskCountResult[0]?.count ?? 0,
      hotelCount: hotelCountResult[0]?.count ?? 0,
    });
  }
  return result;
}

export async function importConfigGroups(boardId: string): Promise<
  { imported: number; assigned: number } | { error: string }
> {
  try {
    await requireRole("admin");

    // Fetch all items from the Monday.com board
    const allItems = [];
    for await (const page of fetchAllItems(boardId)) {
      allItems.push(...page);
    }

    if (allItems.length === 0) {
      return { error: "No items found on board " + boardId };
    }

    // Map item names to kioskConfigGroups rows (upsert)
    let importedCount = 0;
    const groupNameToId = new Map<string, string>();

    for (const item of allItems) {
      const groupName = item.name?.trim();
      if (!groupName) continue;

      const existing = await db
        .select({ id: kioskConfigGroups.id })
        .from(kioskConfigGroups)
        .where(eq(kioskConfigGroups.name, groupName))
        .limit(1);

      if (existing.length > 0) {
        groupNameToId.set(groupName, existing[0].id);
      } else {
        const [inserted] = await db
          .insert(kioskConfigGroups)
          .values({ name: groupName })
          .returning({ id: kioskConfigGroups.id });
        groupNameToId.set(groupName, inserted.id);
        importedCount++;
      }
    }

    // Assign kioskConfigGroupId FK on kiosks where regionGroup matches the group name
    let assignedCount = 0;
    for (const [groupName, groupId] of groupNameToId) {
      await db
        .update(kiosks)
        .set({ kioskConfigGroupId: groupId })
        .where(eq(kiosks.regionGroup, groupName));
      const countResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(kiosks)
        .where(eq(kiosks.kioskConfigGroupId, groupId));
      assignedCount += countResult[0]?.count ?? 0;
    }

    return { imported: importedCount, assigned: assignedCount };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to import config groups",
    };
  }
}
