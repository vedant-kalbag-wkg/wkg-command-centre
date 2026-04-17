"use server";

import { getUserCtx } from "@/lib/auth/get-user-ctx";
import { db } from "@/db";
import { eq, inArray, isNull } from "drizzle-orm";
import {
  locations,
  products,
  hotelGroups,
  regions,
  locationGroups,
  userScopes,
  locationHotelGroupMemberships,
  locationRegionMemberships,
  locationGroupMemberships,
} from "@/db/schema";
import type { DimensionOptions } from "@/lib/analytics/types";

export async function getScopedDimensionOptions(): Promise<DimensionOptions> {
  const userCtx = await getUserCtx();
  const userId = userCtx.id;
  const scopes = await db
    .select({
      dimensionType: userScopes.dimensionType,
      dimensionId: userScopes.dimensionId,
    })
    .from(userScopes)
    .where(eq(userScopes.userId, userId));

  // Expand scopes to location IDs
  const allowedLocationIds = await expandToLocationIds(scopes);

  // Fetch all base options
  const [allLocs, allProds, allHGroups, allRegs, allLGroups] =
    await Promise.all([
      db
        .select({
          id: locations.id,
          name: locations.name,
          outletCode: locations.outletCode,
        })
        .from(locations)
        .where(isNull(locations.archivedAt)),
      db.select({ id: products.id, name: products.name }).from(products),
      db
        .select({ id: hotelGroups.id, name: hotelGroups.name })
        .from(hotelGroups),
      db.select({ id: regions.id, name: regions.name }).from(regions),
      db
        .select({ id: locationGroups.id, name: locationGroups.name })
        .from(locationGroups),
    ]);

  if (allowedLocationIds === null) {
    return formatOptions(allLocs, allProds, allHGroups, allRegs, allLGroups);
  }

  const filteredLocs = allLocs.filter((l) => allowedLocationIds.has(l.id));

  // Find which groups contain at least one allowed location
  const locArr = [...allowedLocationIds];
  const [hgRows, regRows, lgRows] =
    locArr.length > 0
      ? await Promise.all([
          db
            .select({
              hotelGroupId: locationHotelGroupMemberships.hotelGroupId,
            })
            .from(locationHotelGroupMemberships)
            .where(
              inArray(locationHotelGroupMemberships.locationId, locArr),
            ),
          db
            .select({ regionId: locationRegionMemberships.regionId })
            .from(locationRegionMemberships)
            .where(
              inArray(locationRegionMemberships.locationId, locArr),
            ),
          db
            .select({
              locationGroupId: locationGroupMemberships.locationGroupId,
            })
            .from(locationGroupMemberships)
            .where(
              inArray(locationGroupMemberships.locationId, locArr),
            ),
        ])
      : [[], [], []];

  const hgIds = new Set(hgRows.map((r) => r.hotelGroupId));
  const regIds = new Set(regRows.map((r) => r.regionId));
  const lgIds = new Set(lgRows.map((r) => r.locationGroupId));

  return formatOptions(
    filteredLocs,
    allProds,
    allHGroups.filter((g) => hgIds.has(g.id)),
    allRegs.filter((r) => regIds.has(r.id)),
    allLGroups.filter((g) => lgIds.has(g.id)),
  );
}

async function expandToLocationIds(
  scopes: { dimensionType: string; dimensionId: string }[],
): Promise<Set<string> | null> {
  if (scopes.length === 0) return null;

  const locationIds = new Set<string>();

  for (const s of scopes) {
    if (s.dimensionType === "location") locationIds.add(s.dimensionId);
  }

  const hgIds = scopes
    .filter((s) => s.dimensionType === "hotel_group")
    .map((s) => s.dimensionId);
  const regIds = scopes
    .filter((s) => s.dimensionType === "region")
    .map((s) => s.dimensionId);
  const lgIds = scopes
    .filter((s) => s.dimensionType === "location_group")
    .map((s) => s.dimensionId);

  const expansions = await Promise.all([
    hgIds.length > 0
      ? db
          .select({ locationId: locationHotelGroupMemberships.locationId })
          .from(locationHotelGroupMemberships)
          .where(inArray(locationHotelGroupMemberships.hotelGroupId, hgIds))
      : Promise.resolve([]),
    regIds.length > 0
      ? db
          .select({ locationId: locationRegionMemberships.locationId })
          .from(locationRegionMemberships)
          .where(inArray(locationRegionMemberships.regionId, regIds))
      : Promise.resolve([]),
    lgIds.length > 0
      ? db
          .select({ locationId: locationGroupMemberships.locationId })
          .from(locationGroupMemberships)
          .where(inArray(locationGroupMemberships.locationGroupId, lgIds))
      : Promise.resolve([]),
  ]);

  for (const rows of expansions) {
    for (const row of rows) locationIds.add(row.locationId);
  }

  return locationIds;
}

function formatOptions(
  locs: { id: string; name: string | null; outletCode: string | null }[],
  prods: { id: string; name: string }[],
  hGroups: { id: string; name: string }[],
  regs: { id: string; name: string }[],
  lGroups: { id: string; name: string }[],
): DimensionOptions {
  return {
    locations: locs.map((l) => ({
      id: l.id,
      name: l.name ?? l.outletCode ?? l.id,
      outletCode: l.outletCode ?? "",
    })),
    products: prods.map((p) => ({ id: p.id, name: p.name, category: null })),
    hotelGroups: hGroups.map((g) => ({ id: g.id, name: g.name })),
    regions: regs.map((r) => ({ id: r.id, name: r.name })),
    locationGroups: lGroups.map((g) => ({ id: g.id, name: g.name })),
  };
}
