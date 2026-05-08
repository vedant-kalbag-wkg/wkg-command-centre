/**
 * Phase 7 Plan 07-03 — N→1 location-merge primitive with snapshot-before-commit.
 *
 * Lifted from `src/lib/multi-pos-merge.ts:applyBulkMerge` (Phase 6 Plan 06-01)
 * with two surgical additions:
 *
 *   1. Sentinel guard at the top — refuses to merge into or archive the
 *      LOCATION_NEEDED sentinel row (DATA-04 D-07: sentinel is reassign-only).
 *   2. Snapshot-before-commit (D-03) — captures the pre-merge FK state of every
 *      row that the merge will rewrite, INSIDE the same transaction, BEFORE the
 *      UPDATEs run. The snapshot's audit_log_id keys onto the merge audit-log
 *      row so the audit-log detail page (`/admin/audit-log/[id]`) can render an
 *      Undo merge button by joining on it.
 *
 * Signature change vs. applyBulkMerge:
 *   N→1 form: `applyLocationMerge(canonicalId, defunctIds, actor, db)`
 *   instead of pairs[]. Internally fans out to the same per-pair shape.
 *
 * Audit row writes:
 *   - 1× action='merge' entityType='location' entityId=canonicalId
 *     (the snapshot row keys onto this id; written FIRST so the snapshot can
 *     reference it).
 *   - per-table action='update' rows for each FK rewrite (preserves the
 *     existing rollback-by-script-tag UI surface).
 *   - per-defunct action='archive' rows for the archive event.
 *
 * Undo path:
 *   - The snapshot's `payload.fk_changes` records prior FK values per row.
 *   - `payload.archived_ids` lists the rows whose `archived_at` got stamped.
 *   - `undoMerge(snapshotId)` (sibling file) replays these to restore state.
 *   - On successful undo, the snapshot row is DELETEd — its existence is the
 *     single source of truth for "undo still available".
 */
import { sql, and, eq, inArray } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";
import { getSentinelLocationId } from "@/lib/sentinel";
import {
  auditLogs,
  locations,
  kioskAssignments,
  salesRecords,
  locationProducts,
  locationRegionMemberships,
  locationGroupMemberships,
  locationHotelGroupMemberships,
  locationFlags,
  actionItems,
  locationMergeSnapshots,
} from "@/db/schema";

export type MergeActor = { id: string; name: string };

/**
 * Whitelist of `locations` columns the MergeDialog is allowed to overwrite on
 * the canonical row. Mirrors `locationMergeFields` in
 * src/components/locations/location-table.tsx and the subset
 * `MERGE_FIELDS` in src/app/(app)/settings/duplicates/duplicates-client.tsx.
 *
 * Keys here are the Drizzle TS field names (camelCase) — they get passed
 * straight to `tx.update(locations).set({...})`, which Drizzle maps to the
 * underlying snake_case columns. Adding a key here without also adding it to
 * the dialog's `fields` prop is harmless; adding it to the dialog without
 * adding it here means the resolution is silently dropped (correct
 * behaviour — server-side allowlist is the source of truth).
 *
 * Legacy `mergeLocations` (src/lib/merge.ts:33-44) had NO server-side
 * allowlist — it passed the entire `fieldResolutions` object straight into
 * `db.update(locations).set(...)`. The lift here adds the allowlist as a
 * defence-in-depth measure (a malicious client otherwise could overwrite
 * primary_region_id, archived_at, internal_poc_id, etc. by crafting a
 * fieldResolutions key not in the dialog).
 */
export const LOCATION_FIELD_RESOLUTION_ALLOWLIST: ReadonlySet<string> =
  new Set([
    "name",
    "address",
    "hotelGroup",
    "starRating",
    "roomCount",
    "sourcedBy",
    "status",
    "maintenanceFee",
    "customerCode",
    "locationGroup",
  ]);

export type LocationMergeResult = {
  canonicalId: string;
  defunctIds: string[];
  pairsMerged: number;
  salesRecordsRewritten: number;
  kioskAssignmentsRewritten: number;
  locationProductsRewritten: number;
  locationProductsDeleted: number;
  hotelGroupMembershipsRewritten: number;
  hotelGroupMembershipsDeleted: number;
  regionMembershipsRewritten: number;
  regionMembershipsDeleted: number;
  groupMembershipsRewritten: number;
  groupMembershipsDeleted: number;
  locationFlagsRewritten: number;
  actionItemsRewritten: number;
  locationsArchived: number;
  auditLogsWritten: number;
  snapshotId: string | null;
  fkChangeCount: number;
  /**
   * Number of canonical-row fields written via fieldResolutions. 0 when the
   * caller passed no resolutions (or every key was filtered by the
   * allowlist). One per-field audit row is written per increment.
   */
  canonicalFieldChangeCount: number;
};

export const LOCATION_MERGE_SCRIPT_TAG = "src/lib/location-merge.ts";

// Loose DB type — both prod's postgres-js client AND test fixtures expose the
// `transaction()` + `execute()` Drizzle surface this primitive uses.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LocationMergeDb = any;

type FkChange = {
  table: string;
  row_id: string;
  fk_column: string;
  previous_value: string;
};

/**
 * Pre-write canonical field values captured into the snapshot for undo.
 *
 * Shape:
 *   - `canonical_id` — the canonical row whose fields were overwritten.
 *   - `fields` — { columnTsName: previousValue, ... } for every applied
 *     resolution. Values are stored as-read from the row (Drizzle's TS-typed
 *     return), which means numeric columns appear as numbers, jsonb as
 *     objects, etc. The undo path just passes them straight back into
 *     `tx.update(locations).set(...)` — Drizzle handles the round-trip.
 *
 * Absent from the snapshot payload when `fieldResolutions` was empty (or
 * fully stripped by the allowlist). undoMerge tolerates the optional shape.
 */
type CanonicalFieldChanges = {
  canonical_id: string;
  fields: Record<string, unknown>;
};

/**
 * The full snapshot payload shape v2 — adds `canonical_field_changes` to v1.
 * Exported so undoMerge + tests can share the type without redefining it.
 */
export type LocationMergeSnapshotPayload = {
  archived_ids: string[];
  fk_changes: FkChange[];
  canonical_field_changes?: CanonicalFieldChanges;
};

/**
 * Apply an N→1 location merge: archives `defunctIds`, re-points every FK to
 * `canonicalId`, writes a snapshot of the pre-merge state for Undo support.
 *
 * Throws on:
 *   - canonicalId or any defunctId equal to the LOCATION_NEEDED sentinel.
 *   - canonicalId appearing in defunctIds (callers must dedupe).
 *
 * Returns aggregate counts including the snapshot row id (or null if the merge
 * was a no-op because every defunct row was already archived).
 */
export async function applyLocationMerge(
  canonicalId: string,
  defunctIds: string[],
  actor: MergeActor,
  db: LocationMergeDb,
  fieldResolutions: Record<string, unknown> = {},
): Promise<LocationMergeResult> {
  const totals: LocationMergeResult = {
    canonicalId,
    defunctIds,
    pairsMerged: 0,
    salesRecordsRewritten: 0,
    kioskAssignmentsRewritten: 0,
    locationProductsRewritten: 0,
    locationProductsDeleted: 0,
    hotelGroupMembershipsRewritten: 0,
    hotelGroupMembershipsDeleted: 0,
    regionMembershipsRewritten: 0,
    regionMembershipsDeleted: 0,
    groupMembershipsRewritten: 0,
    groupMembershipsDeleted: 0,
    locationFlagsRewritten: 0,
    actionItemsRewritten: 0,
    locationsArchived: 0,
    auditLogsWritten: 0,
    snapshotId: null,
    fkChangeCount: 0,
    canonicalFieldChangeCount: 0,
  };

  if (defunctIds.length === 0) return totals;
  if (defunctIds.includes(canonicalId)) {
    throw new Error("canonicalId cannot appear in defunctIds");
  }

  // Filter the caller-supplied resolutions through the server-side allowlist.
  // Any key not in `LOCATION_FIELD_RESOLUTION_ALLOWLIST` is silently dropped
  // (defence-in-depth — see allowlist docstring above for the threat model).
  // Use Object.entries → Object.keys safe iteration; reject prototype keys
  // explicitly via Object.hasOwn so a `{ __proto__: { admin: true } }`
  // payload can't sneak past the allowlist via the prototype chain.
  const filteredResolutions: Record<string, unknown> = {};
  for (const key of Object.keys(fieldResolutions)) {
    if (
      Object.hasOwn(fieldResolutions, key) &&
      LOCATION_FIELD_RESOLUTION_ALLOWLIST.has(key)
    ) {
      filteredResolutions[key] = fieldResolutions[key];
    }
  }
  const hasFieldResolutions = Object.keys(filteredResolutions).length > 0;

  // Sentinel guard (T-07.03-02). Resolve the sentinel id once outside the
  // transaction; the rejection happens BEFORE any writes so a sentinel-passed
  // call costs only one SELECT.
  //
  // Phase 07-06 — sentinel is now keyed by (name, GLOBAL region) via
  // getSentinelLocationId(). The helper THROWS if the sentinel row is
  // missing; we tolerate that here (some test environments don't seed the
  // sentinel and that should remain non-fatal for non-sentinel merges) by
  // catching the throw and continuing without the guard.
  let sentinelId: string | undefined;
  try {
    sentinelId = await getSentinelLocationId(db);
  } catch {
    sentinelId = undefined;
  }
  if (sentinelId) {
    if (canonicalId === sentinelId) {
      throw new Error(
        "Cannot merge into LOCATION_NEEDED sentinel — sentinel is reassign-only",
      );
    }
    if (defunctIds.includes(sentinelId)) {
      throw new Error(
        "Cannot archive LOCATION_NEEDED sentinel — sentinel is reassign-only",
      );
    }
  }

  // Resolve the canonical row's name once — used for the merge audit row's
  // entityName denormalization (audit.ts requires it as notNull).
  const canonicalRow = await db
    .select({ name: locations.name })
    .from(locations)
    .where(eq(locations.id, canonicalId))
    .limit(1);
  const canonicalName: string = canonicalRow[0]?.name ?? "";

  await db.transaction(async (tx: LocationMergeDb) => {
    // ----------------------------------------------------------------------
    // Step A — write the merge audit row FIRST so the snapshot can reference
    // its id. We inline the INSERT...RETURNING because writeAuditLog returns
    // void (audit.ts:9-59). Smaller diff than modifying every audit caller.
    // ----------------------------------------------------------------------
    const mergeAuditInsert = await tx
      .insert(auditLogs)
      .values({
        actorId: actor.id,
        actorName: actor.name,
        entityType: "location",
        entityId: canonicalId,
        entityName: canonicalName,
        action: "merge",
        field: "mergedFrom",
        newValue: defunctIds.join(","),
        metadata: {
          script: LOCATION_MERGE_SCRIPT_TAG,
          mode: "n_to_one",
          defunctIds,
          canonicalId,
        },
      })
      .returning({ id: auditLogs.id });
    const mergeAuditId: string = mergeAuditInsert[0].id;
    totals.auditLogsWritten++;

    // ----------------------------------------------------------------------
    // Step A.5 — read canonical pre-write values for any resolved fields, so
    // the snapshot can capture them for undo. Skipped entirely when no
    // resolutions came in (saves one round-trip on the common case where the
    // dialog had no conflicts to resolve). Lifted from the legacy
    // `mergeLocations` (src/lib/merge.ts:33-44) which wrote resolutions
    // straight onto the canonical without snapshotting the prior values.
    // The new lift adds the snapshot read so undoMerge can reverse the write.
    // ----------------------------------------------------------------------
    let canonicalFieldChanges: CanonicalFieldChanges | undefined;
    if (hasFieldResolutions) {
      const preRows = await tx
        .select()
        .from(locations)
        .where(eq(locations.id, canonicalId))
        .limit(1);
      const preRow: Record<string, unknown> | undefined = preRows[0];
      if (!preRow) {
        throw new Error(
          `applyLocationMerge: canonical row ${canonicalId} not found for fieldResolutions snapshot`,
        );
      }
      const fields: Record<string, unknown> = {};
      for (const key of Object.keys(filteredResolutions)) {
        // Capture even null/undefined — undoMerge restores back to the
        // pre-write value byte-for-byte, including NULLs.
        fields[key] = preRow[key] ?? null;
      }
      canonicalFieldChanges = { canonical_id: canonicalId, fields };
    }

    // ----------------------------------------------------------------------
    // Step B — capture pre-merge FK state for every table the merge rewrites.
    // The snapshot replays these in undoMerge to restore prior FK values
    // byte-for-byte from snapshot contents alone (no read-from-current-state).
    // Every table named here MUST appear in undoMerge's TABLE_DISPATCH allow-
    // list (sibling file), or undoMerge throws on the unknown table name.
    // ----------------------------------------------------------------------
    const fkChanges: FkChange[] = [];

    // kiosk_assignments.location_id
    const kaRows = await tx
      .select({ id: kioskAssignments.id, locationId: kioskAssignments.locationId })
      .from(kioskAssignments)
      .where(inArray(kioskAssignments.locationId, defunctIds));
    for (const r of kaRows) {
      fkChanges.push({
        table: "kiosk_assignments",
        row_id: r.id,
        fk_column: "location_id",
        previous_value: r.locationId,
      });
    }

    // sales_records.location_id (and processed_at_location_id — captured as a
    // separate fk_changes entry per row so undoMerge can restore each column
    // independently via its single-column UPDATE loop).
    const srPrimary = await tx
      .select({ id: salesRecords.id, locationId: salesRecords.locationId })
      .from(salesRecords)
      .where(inArray(salesRecords.locationId, defunctIds));
    for (const r of srPrimary) {
      fkChanges.push({
        table: "sales_records",
        row_id: r.id,
        fk_column: "location_id",
        previous_value: r.locationId,
      });
    }
    const srProcessed = await tx
      .select({
        id: salesRecords.id,
        processedAtLocationId: salesRecords.processedAtLocationId,
      })
      .from(salesRecords)
      .where(inArray(salesRecords.processedAtLocationId, defunctIds));
    for (const r of srProcessed) {
      if (r.processedAtLocationId) {
        fkChanges.push({
          table: "sales_records",
          row_id: r.id,
          fk_column: "processed_at_location_id",
          previous_value: r.processedAtLocationId,
        });
      }
    }

    // location_products.location_id
    const lpRows = await tx
      .select({ id: locationProducts.id, locationId: locationProducts.locationId })
      .from(locationProducts)
      .where(inArray(locationProducts.locationId, defunctIds));
    for (const r of lpRows) {
      fkChanges.push({
        table: "location_products",
        row_id: r.id,
        fk_column: "location_id",
        previous_value: r.locationId,
      });
    }

    // location_region_memberships — composite PK (location_id, region_id);
    // row_id is the location_id (no surrogate id column on this table). undo
    // dispatches via {locationId + regionId} compound key — encoded as
    // `${locationId}|${regionId}` to fit the single row_id slot.
    const lrmRows = await tx
      .select({
        locationId: locationRegionMemberships.locationId,
        regionId: locationRegionMemberships.regionId,
      })
      .from(locationRegionMemberships)
      .where(inArray(locationRegionMemberships.locationId, defunctIds));
    for (const r of lrmRows) {
      fkChanges.push({
        table: "location_region_memberships",
        row_id: `${r.locationId}|${r.regionId}`,
        fk_column: "location_id",
        previous_value: r.locationId,
      });
    }

    // location_group_memberships — composite PK (location_id, location_group_id).
    const lgmRows = await tx
      .select({
        locationId: locationGroupMemberships.locationId,
        locationGroupId: locationGroupMemberships.locationGroupId,
      })
      .from(locationGroupMemberships)
      .where(inArray(locationGroupMemberships.locationId, defunctIds));
    for (const r of lgmRows) {
      fkChanges.push({
        table: "location_group_memberships",
        row_id: `${r.locationId}|${r.locationGroupId}`,
        fk_column: "location_id",
        previous_value: r.locationId,
      });
    }

    // location_hotel_group_memberships — composite PK (location_id, hotel_group_id).
    const lhgmRows = await tx
      .select({
        locationId: locationHotelGroupMemberships.locationId,
        hotelGroupId: locationHotelGroupMemberships.hotelGroupId,
      })
      .from(locationHotelGroupMemberships)
      .where(inArray(locationHotelGroupMemberships.locationId, defunctIds));
    for (const r of lhgmRows) {
      fkChanges.push({
        table: "location_hotel_group_memberships",
        row_id: `${r.locationId}|${r.hotelGroupId}`,
        fk_column: "location_id",
        previous_value: r.locationId,
      });
    }

    // location_flags.location_id
    const lfRows = await tx
      .select({ id: locationFlags.id, locationId: locationFlags.locationId })
      .from(locationFlags)
      .where(inArray(locationFlags.locationId, defunctIds));
    for (const r of lfRows) {
      fkChanges.push({
        table: "location_flags",
        row_id: r.id,
        fk_column: "location_id",
        previous_value: r.locationId,
      });
    }

    // action_items.location_id (nullable — only surface rows where the FK is
    // currently a defunct id; rows with NULL stay untouched and need no entry).
    const aiRows = await tx
      .select({ id: actionItems.id, locationId: actionItems.locationId })
      .from(actionItems)
      .where(inArray(actionItems.locationId, defunctIds));
    for (const r of aiRows) {
      if (r.locationId) {
        fkChanges.push({
          table: "action_items",
          row_id: r.id,
          fk_column: "location_id",
          previous_value: r.locationId,
        });
      }
    }

    // ----------------------------------------------------------------------
    // Step C — write the snapshot row (only if there's anything to capture).
    // No-op merges (every defunct already archived, no FK rows to rewrite)
    // produce no snapshot — undoMerge would have nothing to do anyway.
    // ----------------------------------------------------------------------
    if (fkChanges.length > 0 || defunctIds.length > 0) {
      const payload: LocationMergeSnapshotPayload = {
        archived_ids: defunctIds,
        fk_changes: fkChanges,
        ...(canonicalFieldChanges
          ? { canonical_field_changes: canonicalFieldChanges }
          : {}),
      };
      const snapInsert = await tx
        .insert(locationMergeSnapshots)
        .values({
          auditLogId: mergeAuditId,
          payload,
        })
        .returning({ id: locationMergeSnapshots.id });
      totals.snapshotId = snapInsert[0].id;
      totals.fkChangeCount = fkChanges.length;
    }

    // ----------------------------------------------------------------------
    // Step C.5 — apply field resolutions to the canonical row + write a
    // per-field action='update' audit entry (one row per resolved field).
    // Runs AFTER the snapshot capture so undoMerge has the pre-write values
    // to restore, BEFORE the FK rewrites so the canonical's new field values
    // are visible to any downstream read inside the same transaction.
    // ----------------------------------------------------------------------
    if (hasFieldResolutions && canonicalFieldChanges) {
      await tx
        .update(locations)
        .set(filteredResolutions)
        .where(eq(locations.id, canonicalId));

      for (const key of Object.keys(filteredResolutions)) {
        const oldValue = canonicalFieldChanges.fields[key];
        const newValue = filteredResolutions[key];
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "location",
            entityId: canonicalId,
            entityName: canonicalName,
            action: "update",
            field: key,
            oldValue: oldValue == null ? undefined : String(oldValue),
            newValue: newValue == null ? undefined : String(newValue),
            metadata: {
              script: LOCATION_MERGE_SCRIPT_TAG,
              source: "merge_field_resolution",
              mergeAuditId,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
        totals.canonicalFieldChangeCount++;
      }
    }

    // ----------------------------------------------------------------------
    // Step D — per-pair FK rewrites + collision pre-deletion + archive.
    // Mirrors src/lib/multi-pos-merge.ts:applyBulkMerge with the loop converted
    // to fan out from `(canonicalId, defunctIds[i])`.
    // ----------------------------------------------------------------------
    for (const defunctId of defunctIds) {
      // Region UNIQUE(location_id) collision — drop defunct's row if canonical
      // already has one.
      const regionCollision = await tx.execute(sql`
        DELETE FROM location_region_memberships
         WHERE location_id = ${defunctId}::uuid
           AND EXISTS (
             SELECT 1 FROM location_region_memberships
              WHERE location_id = ${canonicalId}::uuid
           )
      `);
      totals.regionMembershipsDeleted += rowCount(regionCollision);

      // Group UNIQUE(location_id) collision.
      const groupCollision = await tx.execute(sql`
        DELETE FROM location_group_memberships
         WHERE location_id = ${defunctId}::uuid
           AND EXISTS (
             SELECT 1 FROM location_group_memberships
              WHERE location_id = ${canonicalId}::uuid
           )
      `);
      totals.groupMembershipsDeleted += rowCount(groupCollision);

      // Hotel-group composite-PK collision.
      const hotelGroupCollision = await tx.execute(sql`
        DELETE FROM location_hotel_group_memberships d
         WHERE d.location_id = ${defunctId}::uuid
           AND EXISTS (
             SELECT 1 FROM location_hotel_group_memberships c
              WHERE c.location_id = ${canonicalId}::uuid
                AND c.hotel_group_id = d.hotel_group_id
           )
      `);
      totals.hotelGroupMembershipsDeleted += rowCount(hotelGroupCollision);

      // location_products soft-duplicate (same (product, provider) on both sides).
      const productsCollision = await tx.execute(sql`
        DELETE FROM location_products d
         WHERE d.location_id = ${defunctId}::uuid
           AND EXISTS (
             SELECT 1 FROM location_products c
              WHERE c.location_id = ${canonicalId}::uuid
                AND c.product_id  = d.product_id
                AND c.provider_id IS NOT DISTINCT FROM d.provider_id
           )
      `);
      totals.locationProductsDeleted += rowCount(productsCollision);

      // FK rewrites.
      const salesPrimary = await tx.execute(sql`
        UPDATE sales_records
           SET location_id = ${canonicalId}::uuid
         WHERE location_id = ${defunctId}::uuid
      `);
      const salesPrimaryCount = rowCount(salesPrimary);
      totals.salesRecordsRewritten += salesPrimaryCount;
      if (salesPrimaryCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: defunctId,
            entityName: "location-merge",
            action: "update",
            field: "sales_records.location_id",
            metadata: {
              script: LOCATION_MERGE_SCRIPT_TAG,
              table: "sales_records",
              oldLocationId: defunctId,
              newLocationId: canonicalId,
              rowsRewritten: salesPrimaryCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const salesProcessed = await tx.execute(sql`
        UPDATE sales_records
           SET processed_at_location_id = ${canonicalId}::uuid
         WHERE processed_at_location_id = ${defunctId}::uuid
      `);
      const salesProcessedCount = rowCount(salesProcessed);
      if (salesProcessedCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: defunctId,
            entityName: "location-merge",
            action: "update",
            field: "sales_records.processed_at_location_id",
            metadata: {
              script: LOCATION_MERGE_SCRIPT_TAG,
              table: "sales_records",
              column: "processed_at_location_id",
              oldLocationId: defunctId,
              newLocationId: canonicalId,
              rowsRewritten: salesProcessedCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const ka = await tx.execute(sql`
        UPDATE kiosk_assignments
           SET location_id = ${canonicalId}::uuid
         WHERE location_id = ${defunctId}::uuid
      `);
      const kaCount = rowCount(ka);
      totals.kioskAssignmentsRewritten += kaCount;
      if (kaCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: defunctId,
            entityName: "location-merge",
            action: "update",
            field: "kiosk_assignments.location_id",
            metadata: {
              script: LOCATION_MERGE_SCRIPT_TAG,
              table: "kiosk_assignments",
              oldLocationId: defunctId,
              newLocationId: canonicalId,
              rowsRewritten: kaCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const lp = await tx.execute(sql`
        UPDATE location_products
           SET location_id = ${canonicalId}::uuid
         WHERE location_id = ${defunctId}::uuid
      `);
      const lpCount = rowCount(lp);
      totals.locationProductsRewritten += lpCount;
      if (lpCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: defunctId,
            entityName: "location-merge",
            action: "update",
            field: "location_products.location_id",
            metadata: {
              script: LOCATION_MERGE_SCRIPT_TAG,
              table: "location_products",
              oldLocationId: defunctId,
              newLocationId: canonicalId,
              rowsRewritten: lpCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const lrm = await tx.execute(sql`
        UPDATE location_region_memberships
           SET location_id = ${canonicalId}::uuid
         WHERE location_id = ${defunctId}::uuid
      `);
      totals.regionMembershipsRewritten += rowCount(lrm);

      const lgm = await tx.execute(sql`
        UPDATE location_group_memberships
           SET location_id = ${canonicalId}::uuid
         WHERE location_id = ${defunctId}::uuid
      `);
      totals.groupMembershipsRewritten += rowCount(lgm);

      const lhgm = await tx.execute(sql`
        UPDATE location_hotel_group_memberships
           SET location_id = ${canonicalId}::uuid
         WHERE location_id = ${defunctId}::uuid
      `);
      totals.hotelGroupMembershipsRewritten += rowCount(lhgm);

      const lf = await tx.execute(sql`
        UPDATE location_flags
           SET location_id = ${canonicalId}::uuid
         WHERE location_id = ${defunctId}::uuid
      `);
      totals.locationFlagsRewritten += rowCount(lf);

      const ai = await tx.execute(sql`
        UPDATE action_items
           SET location_id = ${canonicalId}::uuid
         WHERE location_id = ${defunctId}::uuid
      `);
      totals.actionItemsRewritten += rowCount(ai);

      // Archive defunct (idempotent — only stamps archived_at if currently NULL).
      const archive = await tx.execute(sql`
        UPDATE locations
           SET archived_at = NOW()
         WHERE id = ${defunctId}::uuid
           AND archived_at IS NULL
      `);
      const archiveCount = rowCount(archive);
      if (archiveCount > 0) {
        totals.locationsArchived += archiveCount;
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "location",
            entityId: defunctId,
            entityName: "",
            action: "archive",
            field: "archived_at",
            newValue: "NOW()",
            metadata: {
              script: LOCATION_MERGE_SCRIPT_TAG,
              mergedInto: canonicalId,
              mergeAuditId,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      totals.pairsMerged++;
    }
  });

  return totals;
}

// Both pg (node-postgres) and postgres-js return rowCount differently. Keep
// the extraction loose so this primitive runs unchanged in both environments.
function rowCount(result: unknown): number {
  if (result == null) return 0;
  if (typeof (result as { rowCount?: number }).rowCount === "number") {
    return (result as { rowCount: number }).rowCount;
  }
  if (typeof (result as { count?: number }).count === "number") {
    return (result as { count: number }).count;
  }
  if (Array.isArray(result)) {
    return result.length;
  }
  return 0;
}
