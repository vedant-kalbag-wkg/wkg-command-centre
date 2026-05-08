"use server";

/**
 * Phase 7 Plan 07-03 — N→1 location merge server action (DATA-02).
 *
 * Replaces the legacy thin wrapper around `mergeLocations` (src/lib/merge.ts).
 * New shape:
 *   - admin-only (requireRole)
 *   - delegates to `applyLocationMerge` for snapshot-before-commit + sentinel
 *     guard. The merge primitive acquires its own transaction-scoped
 *     `pg_try_advisory_xact_lock(LOCATION_MERGE_LOCK_KEY)` (key 738294108,
 *     same as undoMerge) so the lock and the work it guards run on the same
 *     pool connection. On contention the primitive throws a typed error
 *     that we catch and surface as `{ status: "lock_contention" }` for a
 *     fast-fail UI envelope.
 *
 * Signature kept as `(targetId, sourceIds, fieldResolutions)` to preserve the
 * existing `MergeDialog.onMerge` wiring at:
 *   - src/components/locations/location-table.tsx
 *   - src/app/(app)/settings/duplicates/duplicates-client.tsx
 *
 * `fieldResolutions` is forwarded as the 5th positional arg of
 * `applyLocationMerge`. The merge primitive (src/lib/location-merge.ts)
 * filters keys through its server-side allowlist, captures the canonical's
 * pre-write values in the snapshot for undo, and writes one
 * `action='update'` audit row per applied resolution.
 */
import { revalidateTag } from "next/cache";

import { db } from "@/db";
import {
  applyLocationMerge,
  LOCATION_MERGE_LOCK_CONTENTION,
} from "@/lib/location-merge";
import { requireRole } from "@/lib/rbac";

export type MergeLocationsResult =
  | { success: true; merged: number }
  | { error: string }
  | { status: "lock_contention" };

export async function mergeLocationsAction(
  targetId: string,
  sourceIds: string[],
  fieldResolutions: Record<string, unknown> = {},
): Promise<MergeLocationsResult> {
  let session;
  try {
    session = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Forbidden" };
  }

  try {
    const actor = {
      id: session.user.id,
      name: session.user.name ?? session.user.email,
    };
    const _result = await applyLocationMerge(
      targetId,
      sourceIds,
      actor,
      db,
      fieldResolutions,
    );
    revalidateTag("locations", "max");
    return { success: true, merged: sourceIds.length };
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === LOCATION_MERGE_LOCK_CONTENTION
    ) {
      return { status: "lock_contention" };
    }
    return {
      error: err instanceof Error ? err.message : "Failed to merge locations",
    };
  }
}
