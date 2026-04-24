/**
 * Outlet-types admin pipeline — internal helpers.
 *
 * This file deliberately does NOT carry the "use server" directive. Per the
 * convention established in `src/app/(app)/settings/data-import/sales/pipeline.ts`:
 *
 *   1. A "use server" file can only export async functions. Exporting the
 *      `UnclassifiedOutletRow` type from a "use server" file would make
 *      Turbopack emit broken server-action bundles.
 *
 *   2. Exporting any async helper from a "use server" file registers it as a
 *      network-callable RPC. Keeping the `_*ForActor` helpers here means only
 *      the public wrappers in `./actions.ts` (gated on requireRole('admin'))
 *      are reachable from the network.
 *
 * The `_*ForActor` helpers accept the db + actor as explicit parameters so
 * integration tests can drive them directly against Testcontainers Postgres.
 */

import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { auditLogs, locations, salesRecords } from "@/db/schema";
import { suggestLocationType } from "@/lib/locations/suggest-location-type";
import type { LocationType } from "@/lib/analytics/types";
import { writeAuditLog } from "@/lib/audit";

// Loose db type so callers can inject a testcontainers node-pg drizzle
// instance OR rely on the production postgres-js default.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export type OutletTypeActor = { id: string; name: string };

/**
 * Review-reason flag. `missing_type` is the default — a new outlet surfaced by
 * the ETL that still needs human classification. `imported_from_monday` marks
 * the placeholder rows produced by `scripts/import-location-products-from-monday.ts`
 * when a Monday hotel had no mirror9 outlet code (outletCode gets a
 * `MONDAY-<mondayItemId>` placeholder and the region defaults to UK, so the
 * operator needs to both classify AND verify the region before these rows are
 * analytics-safe).
 */
export type ReviewReason = "missing_type" | "imported_from_monday";

export type UnclassifiedOutletRow = {
  id: string;
  outletCode: string;
  name: string;
  last30dRevenue: number;
  last30dTransactions: number;
  suggestedType: LocationType | null;
  notes: string | null;
  reviewReason: ReviewReason;
};

/**
 * List all locations with `locationType IS NULL AND archivedAt IS NULL`,
 * annotated with their last-30d revenue + transaction count (LEFT JOIN so
 * outlets with zero recent sales still surface) and a classifier suggestion.
 *
 * Ordered by revenue DESC NULLS LAST — the busiest unclassified outlets
 * float to the top for the admin to triage first.
 */
export async function _listUnclassifiedOutletsForActor(
  db: AnyDb,
): Promise<UnclassifiedOutletRow[]> {
  // Snapshot "now - 30d" once in JS so every row sees the same cutoff; easier
  // to reason about than pushing `now()` into SQL.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgoDate = thirtyDaysAgo.toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: locations.id,
      outletCode: locations.outletCode,
      name: locations.name,
      hotelGroup: locations.hotelGroup,
      numRooms: locations.numRooms,
      starRating: locations.starRating,
      notes: locations.notes,
      revenue: sql<string>`COALESCE(SUM(${salesRecords.netAmount}), 0)`,
      transactions: sql<string>`COALESCE(COUNT(${salesRecords.id}), 0)`,
    })
    .from(locations)
    .leftJoin(
      salesRecords,
      and(
        eq(salesRecords.locationId, locations.id),
        gte(salesRecords.transactionDate, thirtyDaysAgoDate),
      ),
    )
    .where(and(isNull(locations.locationType), isNull(locations.archivedAt)))
    .groupBy(locations.id)
    .orderBy(desc(sql`COALESCE(SUM(${salesRecords.netAmount}), 0)`));

  return rows.map(
    (r: {
      id: string;
      outletCode: string;
      name: string;
      hotelGroup: string | null;
      numRooms: number | null;
      starRating: number | null;
      notes: string | null;
      revenue: string;
      transactions: string;
    }) => ({
      id: r.id,
      outletCode: r.outletCode,
      name: r.name,
      last30dRevenue: Number(r.revenue),
      last30dTransactions: Number(r.transactions),
      suggestedType: suggestLocationType({
        name: r.name,
        outletCode: r.outletCode,
        hotelGroup: r.hotelGroup,
        numRooms: r.numRooms,
        starRating: r.starRating,
      }),
      notes: r.notes,
      // The Monday placeholder script stamps outletCode=`MONDAY-<mondayItemId>`
      // (see scripts/import-location-products-from-monday.ts). That prefix is
      // how we distinguish a placeholder from a genuine new outlet surfaced by
      // the ETL; we don't add a separate `review_reason` column because the
      // prefix already encodes the signal 1:1 with `notes`.
      reviewReason: r.outletCode.startsWith("MONDAY-")
        ? ("imported_from_monday" as const)
        : ("missing_type" as const),
    }),
  );
}

/**
 * Classify a single location. Runs the read + update + audit-write inside a
 * single transaction so the audit row and the column mutation are atomic.
 */
export async function _setLocationTypeForActor(
  db: AnyDb,
  actor: OutletTypeActor,
  locationId: string,
  type: LocationType,
): Promise<void> {
  await db.transaction(async (tx: AnyDb) => {
    const [before] = await tx
      .select({ locationType: locations.locationType, name: locations.name })
      .from(locations)
      .where(eq(locations.id, locationId));
    if (!before) throw new Error(`Location ${locationId} not found`);

    await tx
      .update(locations)
      .set({ locationType: type, updatedAt: new Date() })
      .where(eq(locations.id, locationId));

    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "location",
        entityId: locationId,
        entityName: before.name,
        action: "set_location_type",
        field: "location_type",
        oldValue: before.locationType ?? undefined,
        newValue: type,
      },
      tx,
    );
  });
}

/**
 * Classify many locations at once. Read-then-update-then-audit all in a single
 * transaction so partial bulk failures roll back cleanly. Empty input is a
 * no-op — we skip opening the transaction entirely so the audit log stays
 * clean.
 */
export async function _bulkSetLocationTypeForActor(
  db: AnyDb,
  actor: OutletTypeActor,
  locationIds: string[],
  type: LocationType,
): Promise<void> {
  if (locationIds.length === 0) return;
  await db.transaction(async (tx: AnyDb) => {
    const rows = await tx
      .select({
        id: locations.id,
        name: locations.name,
        locationType: locations.locationType,
      })
      .from(locations)
      .where(inArray(locations.id, locationIds));

    await tx
      .update(locations)
      .set({ locationType: type, updatedAt: new Date() })
      .where(inArray(locations.id, locationIds));

    // Single multi-row INSERT rather than N sequential writeAuditLog calls.
    // On 290-row bulk classifies this collapses 290 Neon round-trips into one.
    await tx.insert(auditLogs).values(
      (rows as Array<{ id: string; name: string; locationType: string | null }>).map((r) => ({
        actorId: actor.id,
        actorName: actor.name,
        entityType: "location" as const,
        entityId: r.id,
        entityName: r.name,
        action: "set_location_type" as const,
        field: "location_type",
        oldValue: r.locationType ?? undefined,
        newValue: type,
      })),
    );
  });
}
