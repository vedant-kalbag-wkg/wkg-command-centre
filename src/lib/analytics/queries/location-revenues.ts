import { cache } from "react";
import { sql, type SQL } from "drizzle-orm";
import { executeRows } from "@/db/execute-rows";
import { salesRecords, locations } from "@/db/schema";
import { db } from "@/db";
import { scopedSalesCondition } from "@/lib/scoping/scoped-query";
import type { UserCtx } from "@/lib/scoping/scoped-query";
import {
  buildAmountModeCondition,
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
 *
 * Phase 9.1 / D-11 — `revenue` is GBP-bound (the column projected as `revenue`
 * in the SQL is `SUM(net_amount_gbp)`) so high-performer-analysis percentile
 * ranking compares cross-currency outlets like-for-like (D-12). The native
 * sibling + currency_key are also returned for any future native-display
 * surface (e.g., per-tier native breakdowns); existing consumers that read
 * `.revenue` continue to work without code change.
 */
export type LocationRevenueRow = {
  location_id: string;
  location_name: string;
  revenue: string; // GBP-bound (SUM(net_amount_gbp)); D-11/D-12
  revenue_native: string; // SUM(net_amount); for renderer dispatch (09.1-07)
  currency_key: string | null;
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

    // High-performer tiering ranks by the active metric mode (sales = customer
    // non-fee SUM; revenue = WKG fee SUM). Toggling the global metric switch
    // flips the tier order accordingly.
    // Phase 9.1 / D-11 — dual-emit. Public alias `revenue` binds to the GBP
    // sum (D-12: high-performer percentile rank is cross-cohort and must
    // compare on a single base). Native + currency_key are projected as
    // siblings for the renderer dispatch (09.1-07).
    return executeRows<LocationRevenueRow>(sql`
      SELECT
        ${salesRecords.locationId} AS location_id,
        ${locations.name} AS location_name,
        COALESCE(SUM(${salesRecords.netAmountGbp}) FILTER (WHERE ${buildAmountModeCondition(filters)}), 0) AS revenue,
        COALESCE(SUM(${salesRecords.netAmount})     FILTER (WHERE ${buildAmountModeCondition(filters)}), 0) AS revenue_native,
        CASE WHEN COUNT(DISTINCT ${salesRecords.currency}) FILTER (WHERE ${buildAmountModeCondition(filters)}) = 1
             THEN MIN(${salesRecords.currency}) FILTER (WHERE ${buildAmountModeCondition(filters)})
             ELSE NULL END AS currency_key,
        ${locations.numRooms}::text AS num_rooms
      FROM ${salesRecords}
        INNER JOIN ${locations} ON ${salesRecords.locationId} = ${locations.id}
      ${whereClause ? sql`WHERE ${whereClause}` : sql``}
      GROUP BY ${salesRecords.locationId}, ${locations.name}, ${locations.numRooms}
    `);
  },
);
