"use server";

import { db } from "@/db";
import { locations, locationRegionMemberships, locationHotelGroupMemberships } from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { sql, isNull } from "drizzle-orm";

export type DataQualityRow = {
  id: string;
  name: string;
  outletCode: string | null;
  hasRegion: boolean;
  hasHotelGroup: boolean;
  hasOperatingGroup: boolean;
  hasMarket: boolean;
  qualityScore: number;
};

export type DataQualityReport = {
  rows: DataQualityRow[];
  pctWithRegion: number;
  pctWithHotelGroup: number;
  pctWithOperatingGroup: number;
  pctWithMarket: number;
};

export async function fetchDataQualityReport(): Promise<DataQualityReport> {
  await requireRole("admin");

  const result = await db
    .select({
      id: locations.id,
      name: locations.name,
      outletCode: locations.outletCode,
      operatingGroupId: locations.operatingGroupId,
      hasRegion: sql<boolean>`EXISTS(
        SELECT 1 FROM ${locationRegionMemberships}
        WHERE ${locationRegionMemberships.locationId} = ${locations.id}
      )`.as("has_region"),
      hasHotelGroup: sql<boolean>`EXISTS(
        SELECT 1 FROM ${locationHotelGroupMemberships}
        WHERE ${locationHotelGroupMemberships.locationId} = ${locations.id}
      )`.as("has_hotel_group"),
      hasMarket: sql<boolean>`EXISTS(
        SELECT 1 FROM location_region_memberships lrm
        JOIN regions r ON lrm.region_id = r.id
        WHERE lrm.location_id = ${locations.id}
          AND r.market_id IS NOT NULL
      )`.as("has_market"),
    })
    .from(locations)
    .where(isNull(locations.archivedAt))
    .orderBy(locations.name);

  const rows: DataQualityRow[] = result.map((r) => {
    const checks = [r.hasRegion, r.hasHotelGroup, !!r.operatingGroupId, r.hasMarket];
    const score = Math.round((checks.filter(Boolean).length / 4) * 100);
    return {
      id: r.id,
      name: r.name,
      outletCode: r.outletCode,
      hasRegion: r.hasRegion,
      hasHotelGroup: r.hasHotelGroup,
      hasOperatingGroup: !!r.operatingGroupId,
      hasMarket: r.hasMarket,
      qualityScore: score,
    };
  });

  // Sort by quality score ascending (worst first)
  rows.sort((a, b) => a.qualityScore - b.qualityScore);

  const total = rows.length;
  const pct = (count: number) => (total === 0 ? 0 : Math.round((count / total) * 100));

  return {
    rows,
    pctWithRegion: pct(rows.filter((r) => r.hasRegion).length),
    pctWithHotelGroup: pct(rows.filter((r) => r.hasHotelGroup).length),
    pctWithOperatingGroup: pct(rows.filter((r) => r.hasOperatingGroup).length),
    pctWithMarket: pct(rows.filter((r) => r.hasMarket).length),
  };
}
