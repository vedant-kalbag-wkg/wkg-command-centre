import { db } from "@/db";
import {
  outletExclusions,
  locations,
  salesRecords,
  kioskAssignments,
  locationHotelGroupMemberships,
  locationRegionMemberships,
  locationGroupMemberships,
} from "@/db/schema";
import { sql, inArray, type SQL } from "drizzle-orm";
import type { AnalyticsFilters } from "@/lib/analytics/types";

export async function buildExclusionCondition(): Promise<SQL | undefined> {
  const exclusions = await db.select().from(outletExclusions);
  if (exclusions.length === 0) return undefined;

  const conditions: SQL[] = [];
  for (const ex of exclusions) {
    if (ex.patternType === "exact") {
      conditions.push(sql`${locations.outletCode} = ${ex.outletCode}`);
    } else if (ex.patternType === "regex") {
      conditions.push(sql`${locations.outletCode} ~ ${ex.outletCode}`);
    }
  }

  if (conditions.length === 0) return undefined;
  return sql`NOT (${sql.join(conditions, sql` OR `)})`;
}

export function buildDateCondition(filters: AnalyticsFilters): SQL {
  return sql`${salesRecords.transactionDate} >= ${filters.dateFrom} AND ${salesRecords.transactionDate} <= ${filters.dateTo}`;
}

export function buildDimensionFilters(filters: AnalyticsFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.productIds?.length) {
    conditions.push(inArray(salesRecords.productId, filters.productIds));
  }
  if (filters.hotelIds?.length) {
    conditions.push(inArray(salesRecords.locationId, filters.hotelIds));
  }
  if (filters.hotelGroupIds?.length) {
    conditions.push(
      sql`${salesRecords.locationId} IN (
        SELECT ${locationHotelGroupMemberships.locationId}
        FROM ${locationHotelGroupMemberships}
        WHERE ${inArray(locationHotelGroupMemberships.hotelGroupId, filters.hotelGroupIds)}
      )`,
    );
  }
  if (filters.regionIds?.length) {
    conditions.push(
      sql`${salesRecords.locationId} IN (
        SELECT ${locationRegionMemberships.locationId}
        FROM ${locationRegionMemberships}
        WHERE ${inArray(locationRegionMemberships.regionId, filters.regionIds)}
      )`,
    );
  }
  if (filters.locationGroupIds?.length) {
    conditions.push(
      sql`${salesRecords.locationId} IN (
        SELECT ${locationGroupMemberships.locationId}
        FROM ${locationGroupMemberships}
        WHERE ${inArray(locationGroupMemberships.locationGroupId, filters.locationGroupIds)}
      )`,
    );
  }

  return conditions;
}

/**
 * Subquery that returns the earliest kiosk assignment date for a location.
 * This is the "kiosk live date" — the first time any kiosk was assigned
 * to the location, regardless of whether it's still active.
 */
export const kioskLiveDateSubquery = sql`(SELECT MIN(${kioskAssignments.assignedAt}) FROM ${kioskAssignments} WHERE ${kioskAssignments.locationId} = ${locations.id})`;

export function buildMaturityCondition(filters: AnalyticsFilters): SQL | undefined {
  if (!filters.maturityBuckets?.length) return undefined;

  // Maturity buckets are relative to the user-selected reporting window's end
  // date, not NOW(). Using NOW() would shift bucket boundaries as time passes
  // and misclassify kiosks for historical date ranges.
  const referenceDate = sql`${filters.dateTo}::timestamp`;

  const bucketConditions: SQL[] = [];

  for (const bucket of filters.maturityBuckets) {
    switch (bucket) {
      case "0-1mo":
        bucketConditions.push(
          sql`${kioskLiveDateSubquery} >= (${referenceDate} - INTERVAL '1 month')`,
        );
        break;
      case "1-3mo":
        bucketConditions.push(
          sql`(${kioskLiveDateSubquery} >= (${referenceDate} - INTERVAL '3 months') AND ${kioskLiveDateSubquery} < (${referenceDate} - INTERVAL '1 month'))`,
        );
        break;
      case "3-6mo":
        bucketConditions.push(
          sql`(${kioskLiveDateSubquery} >= (${referenceDate} - INTERVAL '6 months') AND ${kioskLiveDateSubquery} < (${referenceDate} - INTERVAL '3 months'))`,
        );
        break;
      case "6+mo":
        bucketConditions.push(
          sql`${kioskLiveDateSubquery} < (${referenceDate} - INTERVAL '6 months')`,
        );
        break;
    }
  }

  if (bucketConditions.length === 0) return undefined;
  if (bucketConditions.length === 1) return bucketConditions[0];
  return sql`(${sql.join(bucketConditions, sql` OR `)})`;
}

export function combineConditions(conditions: (SQL | undefined)[]): SQL | undefined {
  const valid = conditions.filter((c): c is SQL => c !== undefined);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];
  return sql.join(valid, sql` AND `);
}
