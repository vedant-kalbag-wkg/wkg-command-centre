"use server";

import { db } from "@/db";
import { locations, products, hotelGroups, regions, locationGroups } from "@/db/schema";
import { isNull } from "drizzle-orm";
import type { DimensionOptions } from "@/lib/analytics/types";

export async function getDimensionOptions(): Promise<DimensionOptions> {
  const [locs, prods, hGroups, regs, lGroups] = await Promise.all([
    db
      // Phase 07-06 — outlet_code is gone from locations; the operator-facing
      // dimension picker now surfaces customer_code as the secondary
      // identifier. The DimensionOption shape kept the field name `outletCode`
      // (the consumer label is "Outlet Code") but the source column is now
      // `customer_code` — semantically the hotel-level RPS account code.
      .select({ id: locations.id, name: locations.name, outletCode: locations.customerCode })
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
