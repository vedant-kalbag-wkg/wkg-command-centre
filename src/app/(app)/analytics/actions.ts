"use server";

import { db } from "@/db";
import { locations, products, hotelGroups, regions, locationGroups } from "@/db/schema";
import { isNull } from "drizzle-orm";
import type { DimensionOptions } from "@/lib/analytics/types";

export async function getDimensionOptions(): Promise<DimensionOptions> {
  const [locs, prods, hGroups, regs, lGroups] = await Promise.all([
    db
      .select({ id: locations.id, name: locations.name, outletCode: locations.outletCode })
      .from(locations)
      .where(isNull(locations.archivedAt)),
    db
      .select({ id: products.id, name: products.name })
      .from(products),
    db.select({ id: hotelGroups.id, name: hotelGroups.name }).from(hotelGroups),
    db.select({ id: regions.id, name: regions.name }).from(regions),
    db.select({ id: locationGroups.id, name: locationGroups.name }).from(locationGroups),
  ]);

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
