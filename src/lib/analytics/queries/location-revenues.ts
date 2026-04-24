import { cache } from "react";
import { sql, type SQL } from "drizzle-orm";
import { executeRows } from "@/db/execute-rows";
import { salesRecords, locations } from "@/db/schema";
import { db } from "@/db";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildDateCondition,
  buildDimensionFilters,
  buildMaturityCondition,
  combineConditions,
} from "@/lib/analytics/queries/shared";
import { buildActiveLocationCondition } from "@/lib/analytics/active-locations";
import type { AnalyticsFilters } from "@/lib/analytics/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dbAny = db as any;

/**
 * Per-row shape returned by `getLocationRevenuesForRequest`. Kept separate
 * so call-sites can destructure without re-declaring the SQL result type.
 */
export type LocationRevenueRow = {
  location_id: string;
  location_name: string;
  revenue: string; // numeric as text (matches existing caller expectations)
  num_rooms: string | null;
};

// Internal: identical WHERE assembly used by portfolio / high-performer
// queries. Duplicating the three-line builder here (rather than importing
// from a query module) keeps the helper free of circular deps with
// `high-performer-analysis.ts`.
async function buildWhere(
  filters: AnalyticsFilters,
  userCtx: UserCtx,
): Promise<SQL | undefined> {
  const [scopeCondition, activeLocationCondition] = await Promise.all([
    scopedSalesCondition(dbAny, userCtx),
    buildActiveLocationCondition(),
  ]);

  return combineConditions([
    buildDateCondition(filters),
    scopeCondition,
    activeLocationCondition,
    buildMaturityCondition(filters),
    ...buildDimensionFilters(filters),
  ]);
}

/**
 * Request-scoped aggregate of per-location revenue + rooms for the given
 * filters and user scope.
 *
 * Phase 2 perf #5 — `computePerformerPatterns` ran this aggregate twice per
 * portfolio page load (once each for high- and low-performer tiers) even
 * though the raw rows are identical. Wrapping in `React.cache` means within
 * a single server render, repeated calls with the same `(filters, userCtx)`
 * references collapse to one DB round-trip.
 *
 * Caching key semantics — React.cache uses SameValueZero equality on the
 * argument list. `AnalyticsFilters` and `UserCtx` are plain data, so two
 * calls that share the same object references hit the cache; calls with
 * fresh objects (or different filter content) do not. Callers that want to
 * guarantee a hit should pass the same object through.
 *
 * Scope note — reuses the INNER JOIN on `locations` because
 * `computePerformerPatterns` needs `locations.name` and `locations.num_rooms`
 * for downstream per-tier aggregations. This is Class B per the
 * active-locations classification — keep the JOIN, but let the
 * active-location predicate filter sales_records via the covering index
 * first.
 */
export const getLocationRevenuesForRequest = cache(
  async (
    filters: AnalyticsFilters,
    userCtx: UserCtx,
  ): Promise<LocationRevenueRow[]> => {
    const whereClause = await buildWhere(filters, userCtx);

    return executeRows<LocationRevenueRow>(sql`
      SELECT
        ${salesRecords.locationId} AS location_id,
        ${locations.name} AS location_name,
        COALESCE(SUM(${salesRecords.grossAmount}), 0) AS revenue,
        ${locations.numRooms}::text AS num_rooms
      FROM ${salesRecords}
        INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
      ${whereClause ? sql`WHERE ${whereClause}` : sql``}
      GROUP BY ${salesRecords.locationId}, ${locations.name}, ${locations.numRooms}
    `);
  },
);
