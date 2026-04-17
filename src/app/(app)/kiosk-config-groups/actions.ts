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
