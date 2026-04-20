"use server";

import { db } from "@/db";
import {
  kioskConfigGroups,
  kiosks,
  kioskAssignments,
  locationProducts,
  locations,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export type ConfigGroupListItem = {
  id: string;
  name: string;
  productAvailability: number;
  hotelCount: number;
  kioskCount: number;
  // Locations now own the group link (Phase 4.x — Monday col 1466686598).
  // `linkedLocationCount` counts locations.kiosk_config_group_id = group.id
  // directly; `hotelCount` above is the legacy kiosk-assignment-derived count
  // and is kept for backwards compatibility with the existing Kiosks column.
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

    // Count locations directly linked via locations.kiosk_config_group_id
    const linkedLocationResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(locations)
      .where(eq(locations.kioskConfigGroupId, group.id));

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
      linkedLocationCount: linkedLocationResult[0]?.count ?? 0,
    });
  }
  return result;
}
