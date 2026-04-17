"use server";

import { db } from "@/db";
import {
  user,
  userScopes,
  hotelGroups,
  regions,
  locationGroups,
  locations,
  products,
  providers,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

type ScopeDisplay = {
  dimensionType: string;
  dimensionLabel: string;
  dimensionName: string;
};

export async function getInviteContext(email: string): Promise<{
  userType: string;
  scopes: ScopeDisplay[];
} | null> {
  if (!email) return null;

  const [found] = await db
    .select({ id: user.id, userType: user.userType })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (!found || found.userType !== "external") return null;

  const scopeRows = await db
    .select({
      dimensionType: userScopes.dimensionType,
      dimensionId: userScopes.dimensionId,
    })
    .from(userScopes)
    .where(eq(userScopes.userId, found.id));

  if (scopeRows.length === 0) return null;

  // Resolve dimension IDs to human-readable names
  const resolved: ScopeDisplay[] = [];

  // Group by type for batch lookups
  const byType = new Map<string, string[]>();
  for (const s of scopeRows) {
    if (!byType.has(s.dimensionType)) byType.set(s.dimensionType, []);
    byType.get(s.dimensionType)!.push(s.dimensionId);
  }

  const typeLabels: Record<string, string> = {
    hotel_group: "Hotel Group",
    location: "Location",
    region: "Region",
    product: "Product",
    provider: "Provider",
    location_group: "Location Group",
  };

  for (const [dimType, ids] of byType) {
    let names: Map<string, string> = new Map();

    // Try to look up friendly names for known dimension types
    try {
      if (dimType === "hotel_group") {
        const rows = await db
          .select({ id: hotelGroups.id, name: hotelGroups.name })
          .from(hotelGroups)
          .where(inArray(hotelGroups.id, ids));
        names = new Map(rows.map((r) => [r.id, r.name]));
      } else if (dimType === "region") {
        const rows = await db
          .select({ id: regions.id, name: regions.name })
          .from(regions)
          .where(inArray(regions.id, ids));
        names = new Map(rows.map((r) => [r.id, r.name]));
      } else if (dimType === "location_group") {
        const rows = await db
          .select({ id: locationGroups.id, name: locationGroups.name })
          .from(locationGroups)
          .where(inArray(locationGroups.id, ids));
        names = new Map(rows.map((r) => [r.id, r.name]));
      } else if (dimType === "location") {
        const rows = await db
          .select({ id: locations.id, name: locations.name })
          .from(locations)
          .where(inArray(locations.id, ids));
        names = new Map(rows.map((r) => [r.id, r.name]));
      } else if (dimType === "product") {
        const rows = await db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(inArray(products.id, ids));
        names = new Map(rows.map((r) => [r.id, r.name]));
      } else if (dimType === "provider") {
        const rows = await db
          .select({ id: providers.id, name: providers.name })
          .from(providers)
          .where(inArray(providers.id, ids));
        names = new Map(rows.map((r) => [r.id, r.name]));
      }
    } catch {
      // If lookup fails, fall back to raw ID
    }

    for (const id of ids) {
      resolved.push({
        dimensionType: dimType,
        dimensionLabel: typeLabels[dimType] ?? dimType,
        dimensionName: names.get(id) ?? id,
      });
    }
  }

  return { userType: "external", scopes: resolved };
}
