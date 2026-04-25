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

import { and, asc, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { auditLogs, locations, regions, salesRecords } from "@/db/schema";
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
 *
 * `classified` is set only when the caller passes `includeClassified: true` —
 * surfaces rows that already have a `location_type`, so operators can re-edit
 * them (correct misclassifications without going via the audit log).
 */
export type ReviewReason =
  | "missing_type"
  | "imported_from_monday"
  | "classified";

export type UnclassifiedOutletRow = {
  id: string;
  outletCode: string;
  name: string;
  last30dRevenue: number;
  last30dTransactions: number;
  suggestedType: LocationType | null;
  /**
   * Current location type — null for unclassified rows (the default state),
   * populated for classified rows surfaced via `includeClassified: true` so
   * the table can pre-select the row's existing type in the picker.
   */
  currentType: LocationType | null;
  notes: string | null;
  reviewReason: ReviewReason;
  // The location's current region — surfaced so operators can sanity-check the
  // Monday placeholders (which all default to UK) and reassign in-place.
  primaryRegionId: string;
  primaryRegionCode: string;
};

export type RegionOption = {
  id: string;
  code: string;
  name: string;
};

export type ListUnclassifiedOutletsOptions = {
  /**
   * When true, drops the `location_type IS NULL` filter so already-classified
   * rows surface alongside unclassified ones. Operators can then re-edit a
   * misclassification without going via the audit log. Archived rows stay
   * excluded regardless.
   */
  includeClassified?: boolean;
};

/**
 * List locations with `archivedAt IS NULL`, annotated with their last-30d
 * revenue + transaction count (LEFT JOIN so outlets with zero recent sales
 * still surface) and a classifier suggestion.
 *
 * By default scoped to `locationType IS NULL` — the "needs review" backlog.
 * Pass `{ includeClassified: true }` to surface classified rows as well so
 * operators can re-classify in place.
 *
 * Ordered by revenue DESC NULLS LAST — the busiest outlets float to the top
 * for the admin to triage first.
 */
export async function _listUnclassifiedOutletsForActor(
  db: AnyDb,
  options: ListUnclassifiedOutletsOptions = {},
): Promise<UnclassifiedOutletRow[]> {
  // Snapshot "now - 30d" once in JS so every row sees the same cutoff; easier
  // to reason about than pushing `now()` into SQL.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgoDate = thirtyDaysAgo.toISOString().slice(0, 10);

  // Conditional WHERE: archived always excluded; locationType IS NULL only
  // when includeClassified is false (the default).
  const whereClause = options.includeClassified
    ? isNull(locations.archivedAt)
    : and(isNull(locations.locationType), isNull(locations.archivedAt));

  const rows = await db
    .select({
      id: locations.id,
      outletCode: locations.outletCode,
      name: locations.name,
      hotelGroup: locations.hotelGroup,
      numRooms: locations.numRooms,
      starRating: locations.starRating,
      notes: locations.notes,
      locationType: locations.locationType,
      primaryRegionId: locations.primaryRegionId,
      primaryRegionCode: regions.code,
      revenue: sql<string>`COALESCE(SUM(${salesRecords.netAmount}), 0)`,
      transactions: sql<string>`COALESCE(COUNT(${salesRecords.id}), 0)`,
    })
    .from(locations)
    .innerJoin(regions, eq(regions.id, locations.primaryRegionId))
    .leftJoin(
      salesRecords,
      and(
        eq(salesRecords.locationId, locations.id),
        gte(salesRecords.transactionDate, thirtyDaysAgoDate),
      ),
    )
    .where(whereClause)
    .groupBy(locations.id, regions.code)
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
      locationType: LocationType | null;
      primaryRegionId: string;
      primaryRegionCode: string;
      revenue: string;
      transactions: string;
    }) => {
      // Review-reason precedence: a classified row reports `classified` even
      // when its outletCode is a MONDAY-* placeholder — the operator already
      // resolved that placeholder, so the relevant signal now is "this row
      // is editable, not new".
      const reviewReason: ReviewReason =
        r.locationType !== null
          ? "classified"
          : r.outletCode.startsWith("MONDAY-")
            ? "imported_from_monday"
            : "missing_type";
      return {
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
        currentType: r.locationType,
        notes: r.notes,
        reviewReason,
        primaryRegionId: r.primaryRegionId,
        primaryRegionCode: r.primaryRegionCode,
      };
    },
  );
}

/**
 * List all regions for the bulk + per-row region picker, ordered by name.
 * Surfaced via the actions wrapper so the page can pass DB-backed options
 * to the client island (vs hardcoding CZ/DE/ES/IE/UK).
 */
export async function _listRegionsForActor(db: AnyDb): Promise<RegionOption[]> {
  const rows = await db
    .select({ id: regions.id, code: regions.code, name: regions.name })
    .from(regions)
    .orderBy(asc(regions.name));
  return rows as RegionOption[];
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

/**
 * Look up a region by id, throw a clean message if it doesn't exist. Used as
 * a pre-flight by both region setters so a bad regionId doesn't surface as an
 * opaque PG FK violation.
 */
async function assertRegionExists(db: AnyDb, regionId: string): Promise<void> {
  const [region] = await db
    .select({ id: regions.id })
    .from(regions)
    .where(eq(regions.id, regionId));
  if (!region) throw new Error(`Region ${regionId} not found`);
}

/**
 * Reassign a single location's primaryRegionId. Validates the region first,
 * then read + update + audit inside one transaction. The composite-unique
 * constraint on (primaryRegionId, outletCode) can fire here; we surface the
 * conflict as a recognisable error message rather than a raw PG code.
 */
export async function _setPrimaryRegionForActor(
  db: AnyDb,
  actor: OutletTypeActor,
  locationId: string,
  regionId: string,
): Promise<void> {
  await assertRegionExists(db, regionId);
  await db.transaction(async (tx: AnyDb) => {
    const [before] = await tx
      .select({
        primaryRegionId: locations.primaryRegionId,
        name: locations.name,
        outletCode: locations.outletCode,
      })
      .from(locations)
      .where(eq(locations.id, locationId));
    if (!before) throw new Error(`Location ${locationId} not found`);

    // Pre-flight composite-unique check: would another location in the target
    // region already own this outletCode? Cheaper to check than to catch the
    // PG 23505 and re-classify it.
    if (before.primaryRegionId !== regionId) {
      const conflicts = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(
          and(
            eq(locations.primaryRegionId, regionId),
            eq(locations.outletCode, before.outletCode),
          ),
        );
      if (conflicts.length > 0) {
        throw new Error(
          `Cannot move ${before.outletCode}: another location with that outlet code already exists in the target region`,
        );
      }
    }

    await tx
      .update(locations)
      .set({ primaryRegionId: regionId, updatedAt: new Date() })
      .where(eq(locations.id, locationId));

    await writeAuditLog(
      {
        actorId: actor.id,
        actorName: actor.name,
        entityType: "location",
        entityId: locationId,
        entityName: before.name,
        action: "set_primary_region",
        field: "primary_region_id",
        oldValue: before.primaryRegionId,
        newValue: regionId,
      },
      tx,
    );
  });
}

export type BulkRegionResult = {
  okIds: string[];
  conflictingIds: string[];
};

/**
 * Bulk reassign primaryRegionId for many locations. Pre-flight pass identifies
 * which ids would collide on the (primary_region_id, outlet_code) composite
 * unique — those are skipped, the rest are applied + audited atomically.
 *
 * Mirrors `_bulkSetLocationTypeForActor`: read-current + UPDATE + multi-row
 * INSERT into audit_logs, all in one transaction. Empty input is a no-op so
 * the audit log stays clean (matches the type-bulk helper).
 */
export async function _bulkSetPrimaryRegionForActor(
  db: AnyDb,
  actor: OutletTypeActor,
  locationIds: string[],
  regionId: string,
): Promise<BulkRegionResult> {
  if (locationIds.length === 0) return { okIds: [], conflictingIds: [] };
  await assertRegionExists(db, regionId);

  return await db.transaction(async (tx: AnyDb) => {
    const rows = (await tx
      .select({
        id: locations.id,
        name: locations.name,
        outletCode: locations.outletCode,
        primaryRegionId: locations.primaryRegionId,
      })
      .from(locations)
      .where(inArray(locations.id, locationIds))) as Array<{
      id: string;
      name: string;
      outletCode: string;
      primaryRegionId: string;
    }>;

    // Conflict pre-flight: any other location already in the target region
    // with one of our outlet codes? Build a set of "taken" outlet codes in
    // the target region, then filter our candidates against it. We exclude
    // the candidates themselves from the lookup (a location moving from
    // region X to region Y can keep its own outlet code).
    const candidateOutletCodes = rows
      .filter((r) => r.primaryRegionId !== regionId)
      .map((r) => r.outletCode);

    const takenOutletCodes = new Set<string>();
    if (candidateOutletCodes.length > 0) {
      const candidateIds = rows.map((r) => r.id);
      const taken = (await tx
        .select({ outletCode: locations.outletCode })
        .from(locations)
        .where(
          and(
            eq(locations.primaryRegionId, regionId),
            inArray(locations.outletCode, candidateOutletCodes),
            // Exclude the candidates themselves — if loc X is already in the
            // target region with code Q5, moving it "to itself" is a no-op,
            // not a conflict.
            notInArray(locations.id, candidateIds),
          ),
        )) as Array<{ outletCode: string }>;
      for (const t of taken) takenOutletCodes.add(t.outletCode);
    }

    const okRows = rows.filter(
      (r) =>
        r.primaryRegionId === regionId || !takenOutletCodes.has(r.outletCode),
    );
    const conflictingIds = rows
      .filter(
        (r) =>
          r.primaryRegionId !== regionId && takenOutletCodes.has(r.outletCode),
      )
      .map((r) => r.id);

    if (okRows.length === 0) {
      return { okIds: [], conflictingIds };
    }

    const okIds = okRows.map((r) => r.id);

    await tx
      .update(locations)
      .set({ primaryRegionId: regionId, updatedAt: new Date() })
      .where(inArray(locations.id, okIds));

    await tx.insert(auditLogs).values(
      okRows.map((r) => ({
        actorId: actor.id,
        actorName: actor.name,
        entityType: "location" as const,
        entityId: r.id,
        entityName: r.name,
        action: "set_primary_region" as const,
        field: "primary_region_id",
        oldValue: r.primaryRegionId,
        newValue: regionId,
      })),
    );

    return { okIds, conflictingIds };
  });
}
