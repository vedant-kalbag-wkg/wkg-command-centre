import { db } from "@/db";
import {
  outletExclusions,
  locations,
  salesRecords,
  kioskAssignments,
  hotelGroups,
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

// Netsuite codes of all WKG-collected fee rows. 9991=Booking Fee sets
// is_booking_fee=true; 9992=Cash Handling Fee does NOT (the flag is named
// after its original single purpose). Keep both here so "revenue" mode and
// the non-fee exclusion agree on what a "fee row" is.
export const FEE_NETSUITE_CODES = ["9991", "9992"] as const;

// "A fee row" — either is_booking_fee=true (covers 9991) or netsuite_code=9992.
// Using an explicit OR keeps us future-proof: a new fee code can be added to
// FEE_NETSUITE_CODES without requiring a schema change.
export function buildIsFeeCondition(): SQL {
  return sql`(${salesRecords.isBookingFee} = true OR ${salesRecords.netsuiteCode} IN ('9991', '9992'))`;
}

// Metric-mode filter: 'revenue' restricts to fee rows (WKG's take);
// 'sales' (default) adds no predicate so every row counts.
export function buildMetricModeCondition(filters: AnalyticsFilters): SQL | undefined {
  return filters.metricMode === "revenue" ? buildIsFeeCondition() : undefined;
}

// Top-Products excludes fee rows unconditionally (per product-reporting spec:
// Booking Fee / Cash Handling Fee are not "products" and skew the ranking).
export function buildNonFeeCondition(): SQL {
  return sql`NOT (${salesRecords.isBookingFee} = true OR ${salesRecords.netsuiteCode} IN ('9991', '9992'))`;
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
  if (filters.locationTypes?.length) {
    // Subquery predicate (rather than JOIN) keeps this composable with the
    // existing buildPortfolioWhere/buildHeatMapWhere call sites that already
    // filter off sales_records only.
    conditions.push(
      sql`${salesRecords.locationId} IN (
        SELECT ${locations.id} FROM ${locations}
        WHERE ${inArray(locations.locationType, filters.locationTypes)}
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

/**
 * Returns a SQL fragment resolving each location's canonical hotel-group name.
 *
 * A location can belong to multiple hotel groups via
 * `location_hotel_group_memberships`; to keep tier tables from double-counting
 * a hotel across groups we collapse to exactly one group per location.
 *
 * Rule (first non-null wins):
 *   1. `hotel_groups.name` via `locations.operating_group_id` (the operator's
 *      own canonical group, if set on the location row).
 *   2. `MIN(hotel_group_id)` from `location_hotel_group_memberships` — joined
 *      back to `hotel_groups.name`. Lexicographic MIN by UUID is arbitrary but
 *      deterministic, so the same location always resolves to the same group.
 *   3. NULL — the location has no operating group and no membership rows
 *      (unaffiliated).
 *
 * Emitted as a correlated subquery so the enclosing query can use it in
 * SELECT without adding a LEFT JOIN / GROUP BY churn. Callers must ensure
 * `locations` is in scope (either the table itself or a `locations`-aliased
 * source).
 */
export function canonicalHotelGroupNameFragment(): SQL {
  return sql`COALESCE(
    (SELECT ${hotelGroups.name}
       FROM ${hotelGroups}
       WHERE ${hotelGroups.id} = ${locations.operatingGroupId}),
    (SELECT ${hotelGroups.name}
       FROM ${locationHotelGroupMemberships}
       INNER JOIN ${hotelGroups}
         ON ${hotelGroups.id} = ${locationHotelGroupMemberships.hotelGroupId}
       WHERE ${locationHotelGroupMemberships.locationId} = ${locations.id}
       ORDER BY ${locationHotelGroupMemberships.hotelGroupId}
       LIMIT 1)
  )`;
}

/**
 * Correlated subquery returning the count of currently-active kiosk
 * assignments on each location (`unassigned_at IS NULL`). Mirrors the
 * pattern in high-performer-analysis.ts. Requires `locations` to be in scope.
 */
export function activeKioskCountFragment(): SQL {
  return sql`(
    SELECT COUNT(*)::int
    FROM ${kioskAssignments}
    WHERE ${kioskAssignments.locationId} = ${locations.id}
      AND ${kioskAssignments.unassignedAt} IS NULL
  )`;
}
