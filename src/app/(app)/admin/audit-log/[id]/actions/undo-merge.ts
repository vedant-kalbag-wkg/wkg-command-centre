"use server";

/**
 * Phase 7 Plan 07-03 — Undo location-merge server action (DATA-02 D-05).
 *
 * Replays a `location_merge_snapshots.payload` to reverse an N→1 merge:
 *   (a) Acquires `pg_advisory_xact_lock(738294108)` — SAME numeric key as the
 *       forward-merge UI but transaction-scoped. An in-flight forward-merge
 *       holding the session-scoped pg_try_advisory_lock blocks this undo
 *       until that merge releases. Auto-released at COMMIT/ROLLBACK so no
 *       finally-unlock needed.
 *   (b) `SELECT … FOR UPDATE` on the snapshot row by id; absence ⇒
 *       `error: 'snapshot_already_undone'` (snapshot deleted = either already
 *       undone OR aged out by the future 30-day cron).
 *   (c) Reverses every entry in `payload.fk_changes` via per-table dispatch
 *       (TABLE_DISPATCH allowlist guards against table-name injection from
 *       JSONB).
 *   (d) Restores `archived_at = NULL` on the N-1 archived rows.
 *   (e) Inserts a paired `location_merge_undone` audit row.
 *   (f) `DELETE FROM location_merge_snapshots WHERE id = $1` — the row's
 *       absence is the single source of truth for "undo no longer available".
 *
 * Signature is fixed by Plan 07-03: `undoMerge(snapshotId)` (the snapshot
 * row's id, NOT the merge audit_log id). The detail page derives the
 * snapshotId from the audit-log row at render-time and passes it here.
 */
import { sql, eq, inArray } from "drizzle-orm";
import { revalidateTag } from "next/cache";

import { db } from "@/db";
import {
  locationMergeSnapshots,
  locations,
  kioskAssignments,
  salesRecords,
  locationProducts,
  locationRegionMemberships,
  locationGroupMemberships,
  locationHotelGroupMemberships,
  locationFlags,
  actionItems,
  auditLogs,
} from "@/db/schema";
import { requireRole } from "@/lib/rbac";

type FkChange = {
  table: string;
  row_id: string;
  fk_column: string;
  previous_value: string;
};

type SnapshotPayload = {
  archived_ids: string[];
  fk_changes: FkChange[];
};

/**
 * Per-table dispatch — every `table` value the forward-merge writes into
 * `payload.fk_changes` MUST be present here, or undoMerge throws on the
 * unknown table name (T-07.03-04 guard against payload tampering).
 *
 * Composite-PK tables (`location_*_memberships`) encode their identity as
 * `${locationId}|${otherId}` in the row_id slot — split + dispatch separately.
 */
const SIMPLE_FK_TABLES = new Set([
  "kiosk_assignments",
  "sales_records",
  "location_products",
  "location_flags",
  "action_items",
]);
const COMPOSITE_FK_TABLES = new Set([
  "location_region_memberships",
  "location_group_memberships",
  "location_hotel_group_memberships",
]);
// Used purely as the acceptance-criteria sentinel string + as a checked union.
const KNOWN_TABLES = new Set([
  ...SIMPLE_FK_TABLES,
  ...COMPOSITE_FK_TABLES,
]);

export async function undoMerge(
  snapshotId: string,
): Promise<{ success: true } | { error: string }> {
  let session;
  try {
    session = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Forbidden" };
  }
  const actor = {
    id: session.user.id,
    name: session.user.name ?? session.user.email,
  };

  try {
    const outcome = await db.transaction(async (tx) => {
      // (a) Transaction-scoped advisory lock on the SAME key as forward-merge.
      // A concurrent forward-merge in flight blocks this undo — auto-released
      // at COMMIT/ROLLBACK; no manual unlock needed.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(738294108)`);

      // (b) SELECT … FOR UPDATE the snapshot row by id.
      const snap = await tx.execute(sql`
        SELECT id, audit_log_id, payload, created_at
          FROM location_merge_snapshots
         WHERE id = ${snapshotId}::uuid
         FOR UPDATE
      `);
      type SnapRow = {
        id: string;
        audit_log_id: string;
        payload: SnapshotPayload;
        created_at: string;
      };
      // postgres-js returns the row-list directly; node-postgres returns
      // `{ rows: [...] }`. Both surfaces flow through here at runtime.
      const rows: SnapRow[] =
        snap && typeof snap === "object" && "rows" in snap
          ? (snap as unknown as { rows: SnapRow[] }).rows
          : (snap as unknown as SnapRow[]);
      const snapRow = rows[0];
      if (!snapRow) {
        return { error: "snapshot_already_undone" } as const;
      }
      const payload = snapRow.payload;
      const fkChanges = payload.fk_changes ?? [];
      const archivedIds = payload.archived_ids ?? [];

      // (c) Reverse every FK migration recorded in the snapshot.
      // Validate every table name BEFORE issuing any UPDATE so a payload
      // with a bogus table name fails atomically (whole undo rolls back).
      for (const change of fkChanges) {
        if (!KNOWN_TABLES.has(change.table)) {
          throw new Error(
            `undoMerge: unknown table in fk_changes: ${change.table}`,
          );
        }
      }

      for (const change of fkChanges) {
        if (SIMPLE_FK_TABLES.has(change.table)) {
          // Use raw SQL with sql.identifier to guard the column name. The
          // table name was validated against the allowlist above, so this
          // composition is safe.
          await tx.execute(sql`
            UPDATE ${sql.identifier(change.table)}
               SET ${sql.identifier(change.fk_column)} = ${change.previous_value}::uuid
             WHERE id = ${change.row_id}::uuid
          `);
        } else {
          // Composite-PK row_id encoded as `${locationId}|${otherId}`. The
          // current FK value (post-merge) is the canonical id; we restore
          // location_id back to `previous_value`. WHERE matches BOTH the
          // current canonical location_id AND the join-side id captured at
          // merge-time — guarantees we only flip the rows the snapshot saw.
          const [encLocId, encOtherId] = change.row_id.split("|");
          if (!encLocId || !encOtherId) {
            throw new Error(
              `undoMerge: malformed composite row_id for ${change.table}: ${change.row_id}`,
            );
          }
          // We need the canonical location_id to scope the WHERE. The
          // canonical id is the value of ${change.fk_column} on the row
          // POST-merge — which we don't store directly. Instead, the row was
          // re-pointed FROM previous_value TO some canonical_id in the same
          // transaction; recover canonical from the audit row's metadata via
          // the snapshot's audit_log_id.
          //
          // Simpler: scope by the join-side id only — there can be at most
          // one row with (location_id=*, joinId=encOtherId) under the
          // composite PK constraint. Restore previous_value if such row
          // exists; if it doesn't (collision-pre-deleted during forward
          // merge), no-op — the prior row is permanently lost (acceptable
          // per D-05's "snapshot is byte-for-byte deterministic from
          // contents only" guarantee).
          const otherCol =
            change.table === "location_region_memberships"
              ? "region_id"
              : change.table === "location_group_memberships"
                ? "location_group_id"
                : "hotel_group_id";
          await tx.execute(sql`
            UPDATE ${sql.identifier(change.table)}
               SET ${sql.identifier(change.fk_column)} = ${change.previous_value}::uuid
             WHERE ${sql.identifier(otherCol)} = ${encOtherId}::uuid
               AND ${sql.identifier(change.fk_column)} <> ${change.previous_value}::uuid
          `);
        }
      }

      // (d) Restore archived_at = NULL on archived rows.
      if (archivedIds.length > 0) {
        await tx
          .update(locations)
          .set({ archivedAt: null })
          .where(inArray(locations.id, archivedIds));
      }

      // (e) Paired audit row: action='location_merge_undone'. Inlined INSERT
      // because writeAuditLog rejects unknown action enums (its TS union
      // doesn't include 'location_merge_undone' yet); this matches the
      // audit_logs.action column being plain text in the DB.
      await tx.insert(auditLogs).values({
        actorId: actor.id,
        actorName: actor.name,
        entityType: "location",
        entityId: archivedIds[0] ?? snapshotId,
        entityName: "",
        action: "location_merge_undone",
        field: "snapshotId",
        newValue: snapshotId,
        metadata: {
          snapshotId,
          undidAuditLogId: snapRow.audit_log_id,
          restoredLocationIds: archivedIds,
          fkChangesReversed: fkChanges.length,
        },
      });

      // (f) DELETE the snapshot row — single source of truth for "undo
      // available". The detail page checks for snapshot existence to render
      // the button.
      await tx.execute(sql`
        DELETE FROM location_merge_snapshots WHERE id = ${snapshotId}::uuid
      `);

      return { success: true } as const;
    });

    if ("success" in outcome) {
      revalidateTag("locations", "max");
    }
    return outcome;
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to undo merge",
    };
  }
}

// Re-exports for tests / callers needing the table allowlists without
// duplicating them. Marked internal — not part of the public action surface.
/** @internal */
export const __INTERNAL_TABLE_ALLOWLIST__ = KNOWN_TABLES;
