// LOCATION_NEEDED sentinel — single global location row that absorbs sales-ETL
// orphans (D-06 / DATA-04). The wipe-and-reseed runbook ensures exactly one
// row exists keyed by `(primaryRegionId=GLOBAL, outletCode=__LOCATION_NEEDED__)`,
// and the Plan C merge UI is the operator surface for triaging the orphan
// kiosks attached to it.

import { and, eq } from "drizzle-orm";

import type { db as defaultDb } from "@/db";
import { locations } from "@/db/schema";

export const LOCATION_NEEDED_NAME = "LOCATION_NEEDED";
export const LOCATION_NEEDED_OUTLET_CODE = "__LOCATION_NEEDED__";
export const LOCATION_NEEDED_ADDRESS = "PENDING ASSIGNMENT";

export async function getSentinelLocationId(
  db: typeof defaultDb,
): Promise<string> {
  const rows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        eq(locations.outletCode, LOCATION_NEEDED_OUTLET_CODE),
        eq(locations.name, LOCATION_NEEDED_NAME),
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
