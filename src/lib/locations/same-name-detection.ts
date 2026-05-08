/**
 * Phase 7 Plan 07-04 (DATA-03 / D-09) — same-name detection helper.
 *
 * Source of truth for "two or more active locations rows share a normalised
 * name". Used by:
 *   - `/locations` RSC route load — renders the warning banner
 *   - `/admin/health` RSC route load — renders the duplicate-names status card
 *
 * The query is index-friendly (matches the partial unique index's predicate)
 * and excludes the `LOCATION_NEEDED` sentinel — the sentinel is unique by
 * construction (one row keyed by `(GLOBAL, __LOCATION_NEEDED__)`) but its
 * normalised name "locationneeded" would otherwise show up as a singleton
 * group; explicit exclusion makes the helper future-proof against extra
 * accidental duplicates of the sentinel itself (T-07.04-02 mitigation).
 */

import { sql } from "drizzle-orm";

import { db as defaultDb } from "@/db";
import { executeRowsFromResult } from "@/db/execute-rows";
import { normaliseName } from "@/lib/normalise";
import { LOCATION_NEEDED_NAME } from "@/lib/sentinel";

export type SameNameGroup = {
  normalisedName: string;
  count: number;
  locationIds: string[];
};

/**
 * Canonical normalised form of the sentinel name. Computed via `normaliseName`
 * so it stays in lock-step with the importer / runbook contract: any change
 * to the normalisation function automatically re-derives this value, and the
 * sentinel row's `normalised_name` (set in v2-wipe-and-reseed STEP 3) tracks
 * the same source of truth.
 */
const SENTINEL_NORMALISED = normaliseName(LOCATION_NEEDED_NAME); // "locationneeded"

export async function detectSameNameGroups(
  db: typeof defaultDb = defaultDb,
): Promise<SameNameGroup[]> {
  const result = await db.execute(sql`
    SELECT
      normalised_name AS normalised_name,
      COUNT(*)::int AS count,
      array_agg(id::text) AS location_ids
    FROM locations
    WHERE archived_at IS NULL
      AND normalised_name IS NOT NULL
      AND normalised_name <> ${SENTINEL_NORMALISED}
    GROUP BY normalised_name
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, normalised_name ASC
  `);
  // postgres-js returns an array; neon-serverless returns `{ rows: [...] }`.
  // executeRowsFromResult flattens both shapes so callers don't branch.
  const rows = executeRowsFromResult<{
    normalised_name: string;
    count: number | string;
    location_ids: string[];
  }>(result);
  return rows.map((r) => ({
    normalisedName: r.normalised_name,
    count: typeof r.count === "string" ? parseInt(r.count, 10) : r.count,
    locationIds: r.location_ids,
  }));
}
