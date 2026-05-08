// LOCATION_NEEDED sentinel — single global location row that absorbs sales-ETL
// orphans (D-06 / DATA-04). The wipe-and-reseed runbook ensures exactly one
// row exists keyed by `(name='LOCATION_NEEDED', primaryRegionId=GLOBAL)`,
// and the Plan C merge UI is the operator surface for triaging the orphan
// kiosks attached to it.
//
// Phase 07-06 — sentinel keying changed from
// `(outlet_code='__LOCATION_NEEDED__', name='LOCATION_NEEDED')` to
// `(name='LOCATION_NEEDED', primary_region_id=GLOBAL)`. The outlet_code
// column on locations is gone (migration 0040); the GLOBAL region's
// LOCATION_NEEDED row is unambiguous on its own. The legacy
// LOCATION_NEEDED_OUTLET_CODE constant is intentionally removed — any
// remaining reference is a compile-time error pointing at code that needs
// updating.

import { and, eq } from "drizzle-orm";

import type { db as defaultDb } from "@/db";
import { locations, regions } from "@/db/schema";

export const LOCATION_NEEDED_NAME = "LOCATION_NEEDED";
export const LOCATION_NEEDED_ADDRESS = "PENDING ASSIGNMENT";
/**
 * Phase 07-06 — the canonical region code for the sentinel. The GLOBAL
 * region is seeded by the wipe-and-reseed runbook before the sentinel row
 * is inserted; this constant pairs with `LOCATION_NEEDED_NAME` to
 * unambiguously identify the sentinel without consulting outlet_code.
 */
export const SENTINEL_REGION_CODE = "GLOBAL";

export async function getSentinelLocationId(
  db: typeof defaultDb,
): Promise<string> {
  // Resolve sentinel via the (name, primary_region_id) pair. The GLOBAL
  // region's LOCATION_NEEDED row is unique by construction (the runbook's
  // STEP 3 ensures this; the locations partial unique index on
  // normalised_name WHERE archived_at IS NULL backstops it for active rows
  // even though the sentinel is excluded from same-name detection).
  const rows = await db
    .select({ id: locations.id })
    .from(locations)
    .innerJoin(regions, eq(regions.id, locations.primaryRegionId))
    .where(
      and(
        eq(locations.name, LOCATION_NEEDED_NAME),
        eq(regions.code, SENTINEL_REGION_CODE),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(
      "LOCATION_NEEDED sentinel missing — runbook STEP 3 must run first",
    );
  }
  return row.id;
}
