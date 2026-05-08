import { cache } from "react";
import { sql, inArray, type SQL } from "drizzle-orm";
import { executeRows } from "@/db/execute-rows";
import { locations, salesRecords } from "@/db/schema";

/**
 * Phase 1 perf #6 — cross-cutting cache of "active" location IDs.
 *
 * Every top-10 analytics query used to `INNER JOIN locations` solely to apply
 * `buildExclusionCondition` (`NOT (locations.outlet_code = 'TEST' OR ...)`).
 * That JOIN costs ~700–2000 buffer hits per query via a Memoize lookup on
 * locations-pk.
 *
 * Instead, we compute the "allowed" location ID list once per request and
 * replace the JOIN + exclusion filter with `sales_records.location_id =
 * ANY($1::uuid[])`. The new predicate hits the covering index
 * `sales_records_txn_loc_covering_idx` directly → index-only scan, no
 * locations touch.
 *
 * `React.cache` guarantees the underlying query runs at most once per
 * request; subsequent callers get the cached array. The helper intentionally
 * sits outside `queries/shared.ts` so the caching semantics are obvious at
 * the import site.
 *
 * Phase 07-06 — outlet codes are now per-kiosk (not per-location). An
 * outlet exclusion now reads as: a location is excluded iff at least one
 * of its CURRENT kiosks has an `outlet_code` matching an exclusion in the
 * same region. The NOT EXISTS subquery scans active kiosk_assignments →
 * kiosks; the exact + regex match is unchanged.
 */
export const getActiveLocationIds = cache(async (): Promise<string[]> => {
  // Region-scoped exclusion — outlet codes are unique per region, so 'TEST'
  // in UK and 'TEST' in AU are distinct exclusions and don't cross-match.
  // The location is excluded iff ANY active kiosk currently assigned to it
  // has an outlet_code matching at least one exclusion in the location's
  // primary region.
  const rows = await executeRows<{ id: string }>(sql`
    SELECT l.id AS id
    FROM locations l
    WHERE l.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM outlet_exclusions oe
        INNER JOIN kiosk_assignments ka ON ka.location_id = l.id
        INNER JOIN kiosks k ON k.id = ka.kiosk_id
        WHERE oe.region_id = l.primary_region_id
          AND ka.unassigned_at IS NULL
          AND k.outlet_code IS NOT NULL
          AND (
            (oe.pattern_type = 'exact' AND k.outlet_code = oe.outlet_code)
            OR (oe.pattern_type = 'regex' AND k.outlet_code ~ oe.outlet_code)
          )
      )
  `);

  return rows.map((r) => r.id);
});

/**
 * Build the request-scoped `sales_records.location_id = ANY($ids::uuid[])`
 * predicate. Callers can drop their INNER JOIN locations + exclusion filter
 * and use this instead — or keep the JOIN (if other locations columns are
 * needed) and just add this as an extra WHERE condition so the planner can
 * filter on the covering index before joining.
 *
 * Returns `undefined` when there are no active locations (an empty filter
 * would otherwise become `= ANY('{}'::uuid[])`, which is valid but misleading
 * — we surface it as a no-op `FALSE` guard so the caller's semantics are
 * explicit).
 */
export async function buildActiveLocationCondition(): Promise<SQL | undefined> {
  const ids = await getActiveLocationIds();
  if (ids.length === 0) {
    // No active locations → every query should return zero rows.
    return sql`FALSE`;
  }
  return sql`${salesRecords.locationId} = ANY(${sql.param(ids)}::uuid[])`;
}

/**
 * Raw-context variant for callers that serialize the SQL to a literal string
 * (see `queries/pivot.ts`). Uses `IN ($1, $2, ...)` with scalar params —
 * which the pivot string-replacement loop handles — instead of
 * `ANY($1::uuid[])`, whose single array param doesn't serialize cleanly via
 * `String(param)`.
 *
 * Semantically identical to `buildActiveLocationCondition`.
 */
export async function buildActiveLocationConditionForRawContext(): Promise<
  SQL | undefined
> {
  const ids = await getActiveLocationIds();
  if (ids.length === 0) return sql`FALSE`;
  return inArray(salesRecords.locationId, ids);
}
