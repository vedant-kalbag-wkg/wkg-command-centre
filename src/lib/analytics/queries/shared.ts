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

  // Region-scoped match (Task 1.9 / PR-6 Part F). An exclusion only applies
  // to locations in the same region — outlet codes are unique per region, not
  // globally, so 'Q5' in UK and 'Q5' in DE are distinct outlets.
  const conditions: SQL[] = [];
  for (const ex of exclusions) {
    if (ex.patternType === "exact") {
      conditions.push(
        sql`(${locations.outletCode} = ${ex.outletCode} AND ${locations.primaryRegionId} = ${ex.regionId})`,
      );
    } else if (ex.patternType === "regex") {
      conditions.push(
        sql`(${locations.outletCode} ~ ${ex.outletCode} AND ${locations.primaryRegionId} = ${ex.regionId})`,
      );
    }
  }

  if (conditions.length === 0) return undefined;
  return sql`NOT (${sql.join(conditions, sql` OR `)})`;
}

export function buildDateCondition(filters: AnalyticsFilters): SQL {
  return sql`${salesRecords.transactionDate} >= ${filters.dateFrom} AND ${salesRecords.transactionDate} <= ${filters.dateTo}`;
}

// "A fee row" — single-column predicate post-D10. Parser sets is_weknow_fee=true
// for NetSuite 9991 (Booking Fee) and 9992 (Cash Handling Fee).
export function buildIsFeeCondition(): SQL {
  return sql`${salesRecords.isWeknowFee} = true`;
}

// Per-aggregate amount predicate (D1): in sales mode the SUM is over non-fee
// rows ("Total Sales" = customer purchase volume); in revenue mode it's over
// fee rows only ("Total Revenue" = WKG's take). Use as a FILTER (WHERE …)
// arm on SUM(net_amount) so the same query can carry mode-invariant counts.
export function buildAmountModeCondition(filters: AnalyticsFilters): SQL {
  return filters.metricMode === "revenue"
    ? buildIsFeeCondition()
    : buildNonFeeCondition();
}

// Top-Products excludes fee rows unconditionally (per product-reporting spec:
// Booking Fee / Cash Handling Fee are not "products" and skew the ranking).
export function buildNonFeeCondition(): SQL {
  return sql`${salesRecords.isWeknowFee} = false`;
}

// Reversal helpers (D2). is_reversal is true on every refund row (net_amount<0);
// original_record_id is set when the refund matched a positive original at
// ingest. Together they let KPIs distinguish gross bookings from cancellations,
// partial refunds, and orphan refunds without re-deriving the join.

export function buildNonReversalCondition(): SQL {
  return sql`${salesRecords.isReversal} = false`;
}

// Canonical "real Sales transaction" predicate — what every COUNT(*) on the
// "Transactions" / "Bookings" KPI tile should use post-D1+D2. Excludes both
// fee rows (not customer purchases) and reversal rows (refunds aren't new
// bookings; PR-4 wires this into the dashboards).
export function buildSalesTxnCondition(): SQL {
  return sql`(${buildNonFeeCondition()}) AND (${buildNonReversalCondition()})`;
}

// Cancellations = refund rows that fully reversed a matched original.
// Partial-refund rows are excluded so the Cancellations KPI is a pure count
// of bookings nullified end-to-end. Callers typically wrap this with
// COUNT(DISTINCT original_record_id) to get one cancellation per booking.
export function buildCancellationCondition(): SQL {
  return sql`${salesRecords.isReversal} = true AND ${salesRecords.isPartialReversal} = false AND ${salesRecords.originalRecordId} IS NOT NULL`;
}

// Partial Refunds — separate KPI tile per D2. abs(refund) < abs(original) at
// the matched original, computed and stored at ingest time on the column.
export function buildPartialReversalCondition(): SQL {
  return sql`${salesRecords.isReversal} = true AND ${salesRecords.isPartialReversal} = true AND ${salesRecords.originalRecordId} IS NOT NULL`;
}

// Orphan Refunds — refunds whose original predates the data window or could
// not be matched by ref_no/magnitude. Surfaced in the portfolio-level health
// badge (D2.4); their amounts still net into portfolio-level revenue SUM.
export function buildOrphanReversalCondition(): SQL {
  return sql`${salesRecords.isReversal} = true AND ${salesRecords.originalRecordId} IS NULL`;
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
  // and misclassify kiosks for historical date ranges. Buckets follow D3:
  // left-inclusive / right-exclusive months-since-liveDate (see maturity.ts).
  const referenceDate = sql`${filters.dateTo}::timestamp`;

  const bucketConditions: SQL[] = [];

  for (const bucket of filters.maturityBuckets) {
    switch (bucket) {
      case "0-1mo":
        bucketConditions.push(
          sql`${kioskLiveDateSubquery} > (${referenceDate} - INTERVAL '1 month')`,
        );
        break;
      case "1-3mo":
        bucketConditions.push(
          sql`(${kioskLiveDateSubquery} > (${referenceDate} - INTERVAL '3 months') AND ${kioskLiveDateSubquery} <= (${referenceDate} - INTERVAL '1 month'))`,
        );
        break;
      case "3-6mo":
        bucketConditions.push(
          sql`(${kioskLiveDateSubquery} > (${referenceDate} - INTERVAL '6 months') AND ${kioskLiveDateSubquery} <= (${referenceDate} - INTERVAL '3 months'))`,
        );
        break;
      case "6-9mo":
        bucketConditions.push(
          sql`(${kioskLiveDateSubquery} > (${referenceDate} - INTERVAL '9 months') AND ${kioskLiveDateSubquery} <= (${referenceDate} - INTERVAL '6 months'))`,
        );
        break;
      case "9+mo":
        bucketConditions.push(
          sql`${kioskLiveDateSubquery} <= (${referenceDate} - INTERVAL '9 months')`,
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
 * Total `num_rooms` across the active members of a location group, as a scalar
 * subquery. Used by location-groups.ts (list + detail) and regions.ts
 * (location-group breakdown) to fix Tasks 2.1 + 2.2 — the original queries SUM
 * `locations.num_rooms` over a `sales_records → locations → memberships` JOIN,
 * which fans each location's rooms across its sales rows. SUM(DISTINCT
 * num_rooms) doesn't help (it dedupes by VALUE, not by location). The fix
 * computes rooms in an isolated subquery that touches `locations` exactly once
 * per member.
 *
 * Semantic choice (D2.1 fix note): we count rooms for ALL active members of
 * the group regardless of whether they had sales in the date window — i.e.
 * "current capacity", not "active capacity in window". revenuePerRoom only
 * makes sense when at least one member contributed sales, in which case the
 * numerator (revenue SUM) is non-zero anyway; this matches the operator's
 * intuition that the denominator is the group's deployable footprint.
 *
 * @param groupScope SQL fragment placed after `lgm.location_group_id` —
 *   typically `= ${locationGroups.id}` for correlated subqueries inside a
 *   GROUP BY, or `IN (...)` for an aggregate over a fixed group set.
 * @param activeLocationIds the request-scoped active-location id list from
 *   `getActiveLocationIds()`. Empty list → subquery returns 0.
 * @param extraLocationFilter optional extra constraint joined with AND, used
 *   by regions.ts to additionally scope to locations within the region.
 */
export function locationGroupRoomsSubquery(
  groupScope: SQL,
  activeLocationIds: string[],
  extraLocationFilter?: SQL,
): SQL {
  // Empty active set → no rooms. Avoids emitting `ANY('{}'::uuid[])` and keeps
  // the COALESCE → 0 fallback explicit at the call site shape.
  if (activeLocationIds.length === 0) return sql`0`;
  const activeFilter = sql`l.id = ANY(${sql.param(activeLocationIds)}::uuid[])`;
  const filters: SQL[] = [
    sql`lgm.location_group_id ${groupScope}`,
    sql`l.archived_at IS NULL`,
    activeFilter,
  ];
  if (extraLocationFilter) filters.push(extraLocationFilter);
  return sql`COALESCE((
    SELECT SUM(l.num_rooms)
    FROM ${locations} l
    INNER JOIN ${locationGroupMemberships} lgm ON lgm.location_id = l.id
    WHERE ${sql.join(filters, sql` AND `)}
  ), 0)`;
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
