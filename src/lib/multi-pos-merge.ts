/**
 * Phase 6 Plan 06-01 — D8 multi-POS bulk-merge primitive.
 *
 * Pure transactional bulk-merger: rewrites every FK to `locations.id` from
 * defunct → canonical for a list of pairs in ONE transaction, then archives
 * defunct rows by stamping `locations.archived_at`. Emits an audit-log shape
 * the rollback SQL keys directly off (`metadata->>'script' = 'scripts/multi-pos-merge.ts'`).
 *
 * Transaction shape & ALL-OR-NOTHING choice (per CONTEXT D-03 & RESEARCH
 * "open question 3"): a single transaction is feasible at the magnitudes
 * we're dealing with (~7,531 sales rows, 22 cluster pairs, ~30 audit-log
 * inserts) and gives us the cleanest rollback story. If the operator wants
 * per-cluster atomicity instead, they can call `applyBulkMerge` once per
 * cluster — the function itself does not loop over multiple transactions.
 *
 * Order of operations per pair (collision handling — see RESEARCH "Open
 * question 1"):
 *   1. Delete defunct's row from location_region_memberships if canonical
 *      already has one (UNIQUE(location_id) collision).
 *   2. Delete defunct's row from location_group_memberships if canonical
 *      already has one (UNIQUE(location_id) collision).
 *   3. Delete defunct's rows from location_hotel_group_memberships where
 *      (canonical, hotel_group_id) already exists (PK collision on
 *      (location_id, hotel_group_id)).
 *   4. Delete defunct's rows from location_products where canonical already
 *      has the same (product_id, provider_id) — not enforced by a DB PK
 *      today but rewriting both produces a logical duplicate availability
 *      row. NULL provider_id is treated as a distinct slot (matches the
 *      schema's `providerId` nullability) so a defunct row with NULL
 *      provider does not collide with a canonical row with a populated
 *      provider for the same product.
 *   5. UPDATE every remaining FK to point at canonical_id:
 *        - sales_records.location_id
 *        - sales_records.processed_at_location_id (D2 reversal column)
 *        - kiosk_assignments.location_id
 *        - location_products.location_id
 *        - location_region_memberships.location_id
 *        - location_group_memberships.location_id
 *        - location_hotel_group_memberships.location_id
 *        - location_flags.location_id
 *        - action_items.location_id
 *   6. Set locations.archived_at = NOW() on defunct.
 *
 * Audit-log shape:
 *   - One AGGREGATE row per (defunct, table) pair: action='update',
 *     entityType='system', entityId=defunctId, field='<table>.location_id',
 *     metadata={ script, oldLocationId, newLocationId, table, rowsRewritten }.
 *     Used for both reporting (operator sees the rewrite count) and rollback
 *     (the rollback SQL keys on metadata->>'oldLocationId' /
 *     metadata->>'newLocationId').
 *   - One row per pair with action='merge', entityType='location',
 *     entityId=defunctId, field='mergedInto', newValue=canonicalId.
 *     Mirrors src/lib/merge.ts's pair-merge shape so the global audit-log UI
 *     surfaces these rows.
 *   - One row per defunct with action='archive', entityType='location',
 *     entityId=defunctId. Marks the archive event itself.
 *
 * Idempotency: callers (the apply server action + scripts/multi-pos-merge.ts)
 * load merge_proposals where `applied_at IS NULL` and stamp `applied_at`
 * after applyBulkMerge returns. A re-run with no pending pairs is a no-op
 * (this function still completes cleanly with all-zero counts).
 */
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";

export type MergePair = {
  canonicalId: string;
  defunctId: string;
};

export type MergeActor = { id: string; name: string };

export type BulkMergeResult = {
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
};

export const MULTI_POS_MERGE_SCRIPT_TAG = "scripts/multi-pos-merge.ts";

// Loose DB type — both prod's postgres-js client AND the testcontainer's
// node-postgres client expose the `transaction()` + `execute()` Drizzle
// surface this primitive uses. Keeping the type loose lets a single
// implementation serve both call sites (apply server action + integration test).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MergeDb = any;

/**
 * Apply a set of merge pairs in ONE transaction.
 */
export async function applyBulkMerge(
  pairs: MergePair[],
  actor: MergeActor,
  db: MergeDb,
): Promise<BulkMergeResult> {
  const totals: BulkMergeResult = {
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
  };
  if (pairs.length === 0) return totals;

  // Use a single transaction across all pairs. If any pair fails (e.g. a
  // post-probe collision the operator missed), the whole batch rolls back.
  await db.transaction(async (tx: MergeDb) => {
    for (const pair of pairs) {
      // Step 1 — region UNIQUE(location_id) collision: drop defunct's row if
      // canonical already has one. Returns the count of deleted rows.
      const regionCollisionResult = await tx.execute(sql`
        DELETE FROM location_region_memberships
         WHERE location_id = ${pair.defunctId}::uuid
           AND EXISTS (
             SELECT 1 FROM location_region_memberships
              WHERE location_id = ${pair.canonicalId}::uuid
           )
      `);
      const regionDeleted = rowCount(regionCollisionResult);
      totals.regionMembershipsDeleted += regionDeleted;

      // Step 2 — group UNIQUE(location_id) collision.
      const groupCollisionResult = await tx.execute(sql`
        DELETE FROM location_group_memberships
         WHERE location_id = ${pair.defunctId}::uuid
           AND EXISTS (
             SELECT 1 FROM location_group_memberships
              WHERE location_id = ${pair.canonicalId}::uuid
           )
      `);
      const groupDeleted = rowCount(groupCollisionResult);
      totals.groupMembershipsDeleted += groupDeleted;

      // Step 3 — hotel_group composite-PK collision.
      const hotelGroupCollisionResult = await tx.execute(sql`
        DELETE FROM location_hotel_group_memberships d
         WHERE d.location_id = ${pair.defunctId}::uuid
           AND EXISTS (
             SELECT 1 FROM location_hotel_group_memberships c
              WHERE c.location_id = ${pair.canonicalId}::uuid
                AND c.hotel_group_id = d.hotel_group_id
           )
      `);
      const hotelDeleted = rowCount(hotelGroupCollisionResult);
      totals.hotelGroupMembershipsDeleted += hotelDeleted;

      // Step 4 — location_products soft-duplicate (same (product, provider) on
      // both sides). NULL provider_id is treated as a distinct slot via
      // IS NOT DISTINCT FROM so a NULL/NULL pair collides cleanly while
      // NULL vs. 'foo' does not.
      const productsCollisionResult = await tx.execute(sql`
        DELETE FROM location_products d
         WHERE d.location_id = ${pair.defunctId}::uuid
           AND EXISTS (
             SELECT 1 FROM location_products c
              WHERE c.location_id = ${pair.canonicalId}::uuid
                AND c.product_id  = d.product_id
                AND c.provider_id IS NOT DISTINCT FROM d.provider_id
           )
      `);
      const productsDeleted = rowCount(productsCollisionResult);
      totals.locationProductsDeleted += productsDeleted;

      // Step 5 — rewrite every remaining FK from defunct → canonical.
      const salesPrimary = await tx.execute(sql`
        UPDATE sales_records
           SET location_id = ${pair.canonicalId}::uuid
         WHERE location_id = ${pair.defunctId}::uuid
      `);
      const salesPrimaryCount = rowCount(salesPrimary);
      totals.salesRecordsRewritten += salesPrimaryCount;
      if (salesPrimaryCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: pair.defunctId,
            entityName: "multi-pos-merge",
            action: "update",
            field: "sales_records.location_id",
            metadata: {
              script: MULTI_POS_MERGE_SCRIPT_TAG,
              table: "sales_records",
              oldLocationId: pair.defunctId,
              newLocationId: pair.canonicalId,
              rowsRewritten: salesPrimaryCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const salesProcessed = await tx.execute(sql`
        UPDATE sales_records
           SET processed_at_location_id = ${pair.canonicalId}::uuid
         WHERE processed_at_location_id = ${pair.defunctId}::uuid
      `);
      const salesProcessedCount = rowCount(salesProcessed);
      if (salesProcessedCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: pair.defunctId,
            entityName: "multi-pos-merge",
            action: "update",
            field: "sales_records.processed_at_location_id",
            metadata: {
              script: MULTI_POS_MERGE_SCRIPT_TAG,
              table: "sales_records",
              column: "processed_at_location_id",
              oldLocationId: pair.defunctId,
              newLocationId: pair.canonicalId,
              rowsRewritten: salesProcessedCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const ka = await tx.execute(sql`
        UPDATE kiosk_assignments
           SET location_id = ${pair.canonicalId}::uuid
         WHERE location_id = ${pair.defunctId}::uuid
      `);
      const kaCount = rowCount(ka);
      totals.kioskAssignmentsRewritten += kaCount;
      if (kaCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: pair.defunctId,
            entityName: "multi-pos-merge",
            action: "update",
            field: "kiosk_assignments.location_id",
            metadata: {
              script: MULTI_POS_MERGE_SCRIPT_TAG,
              table: "kiosk_assignments",
              oldLocationId: pair.defunctId,
              newLocationId: pair.canonicalId,
              rowsRewritten: kaCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const lp = await tx.execute(sql`
        UPDATE location_products
           SET location_id = ${pair.canonicalId}::uuid
         WHERE location_id = ${pair.defunctId}::uuid
      `);
      const lpCount = rowCount(lp);
      totals.locationProductsRewritten += lpCount;
      if (lpCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: pair.defunctId,
            entityName: "multi-pos-merge",
            action: "update",
            field: "location_products.location_id",
            metadata: {
              script: MULTI_POS_MERGE_SCRIPT_TAG,
              table: "location_products",
              oldLocationId: pair.defunctId,
              newLocationId: pair.canonicalId,
              rowsRewritten: lpCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const lrm = await tx.execute(sql`
        UPDATE location_region_memberships
           SET location_id = ${pair.canonicalId}::uuid
         WHERE location_id = ${pair.defunctId}::uuid
      `);
      const lrmCount = rowCount(lrm);
      totals.regionMembershipsRewritten += lrmCount;
      if (lrmCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: pair.defunctId,
            entityName: "multi-pos-merge",
            action: "update",
            field: "location_region_memberships.location_id",
            metadata: {
              script: MULTI_POS_MERGE_SCRIPT_TAG,
              table: "location_region_memberships",
              oldLocationId: pair.defunctId,
              newLocationId: pair.canonicalId,
              rowsRewritten: lrmCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const lgm = await tx.execute(sql`
        UPDATE location_group_memberships
           SET location_id = ${pair.canonicalId}::uuid
         WHERE location_id = ${pair.defunctId}::uuid
      `);
      const lgmCount = rowCount(lgm);
      totals.groupMembershipsRewritten += lgmCount;
      if (lgmCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: pair.defunctId,
            entityName: "multi-pos-merge",
            action: "update",
            field: "location_group_memberships.location_id",
            metadata: {
              script: MULTI_POS_MERGE_SCRIPT_TAG,
              table: "location_group_memberships",
              oldLocationId: pair.defunctId,
              newLocationId: pair.canonicalId,
              rowsRewritten: lgmCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const lhgm = await tx.execute(sql`
        UPDATE location_hotel_group_memberships
           SET location_id = ${pair.canonicalId}::uuid
         WHERE location_id = ${pair.defunctId}::uuid
      `);
      const lhgmCount = rowCount(lhgm);
      totals.hotelGroupMembershipsRewritten += lhgmCount;
      if (lhgmCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: pair.defunctId,
            entityName: "multi-pos-merge",
            action: "update",
            field: "location_hotel_group_memberships.location_id",
            metadata: {
              script: MULTI_POS_MERGE_SCRIPT_TAG,
              table: "location_hotel_group_memberships",
              oldLocationId: pair.defunctId,
              newLocationId: pair.canonicalId,
              rowsRewritten: lhgmCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const lf = await tx.execute(sql`
        UPDATE location_flags
           SET location_id = ${pair.canonicalId}::uuid
         WHERE location_id = ${pair.defunctId}::uuid
      `);
      const lfCount = rowCount(lf);
      totals.locationFlagsRewritten += lfCount;
      if (lfCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: pair.defunctId,
            entityName: "multi-pos-merge",
            action: "update",
            field: "location_flags.location_id",
            metadata: {
              script: MULTI_POS_MERGE_SCRIPT_TAG,
              table: "location_flags",
              oldLocationId: pair.defunctId,
              newLocationId: pair.canonicalId,
              rowsRewritten: lfCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      const ai = await tx.execute(sql`
        UPDATE action_items
           SET location_id = ${pair.canonicalId}::uuid
         WHERE location_id = ${pair.defunctId}::uuid
      `);
      const aiCount = rowCount(ai);
      totals.actionItemsRewritten += aiCount;
      if (aiCount > 0) {
        await writeAuditLog(
          {
            actorId: actor.id,
            actorName: actor.name,
            entityType: "system",
            entityId: pair.defunctId,
            entityName: "multi-pos-merge",
            action: "update",
            field: "action_items.location_id",
            metadata: {
              script: MULTI_POS_MERGE_SCRIPT_TAG,
              table: "action_items",
              oldLocationId: pair.defunctId,
              newLocationId: pair.canonicalId,
              rowsRewritten: aiCount,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      // Step 6 — archive the defunct row. Idempotency-friendly: only stamps
      // archived_at if currently NULL; re-run after a manual resurrection
      // would no-op.
      const archive = await tx.execute(sql`
        UPDATE locations
           SET archived_at = NOW()
         WHERE id = ${pair.defunctId}::uuid
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
            entityId: pair.defunctId,
            entityName: "",
            action: "archive",
            field: "archived_at",
            newValue: "NOW()",
            metadata: {
              script: MULTI_POS_MERGE_SCRIPT_TAG,
              mergedInto: pair.canonicalId,
            },
          },
          tx,
        );
        totals.auditLogsWritten++;
      }

      // Pair-level merge audit row (mirrors src/lib/merge.ts:60–69).
      await writeAuditLog(
        {
          actorId: actor.id,
          actorName: actor.name,
          entityType: "location",
          entityId: pair.defunctId,
          entityName: "",
          action: "merge",
          field: "mergedInto",
          newValue: pair.canonicalId,
          metadata: { script: MULTI_POS_MERGE_SCRIPT_TAG },
        },
        tx,
      );
      totals.auditLogsWritten++;
      totals.pairsMerged++;
    }
  });

  return totals;
}

// Both pg (node-postgres) and postgres-js return rowCount differently. Keep
// the extraction loose so this primitive runs unchanged in both environments.
function rowCount(result: unknown): number {
  if (result == null) return 0;
  // node-postgres `Result.rowCount`
  if (typeof (result as { rowCount?: number }).rowCount === "number") {
    return (result as { rowCount: number }).rowCount;
  }
  // postgres-js — `count` property on the array-shaped result
  if (typeof (result as { count?: number }).count === "number") {
    return (result as { count: number }).count;
  }
  // Drizzle's execute() may return an array directly
  if (Array.isArray(result)) {
    return result.length;
  }
  return 0;
}
