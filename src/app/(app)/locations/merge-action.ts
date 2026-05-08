"use server";

/**
 * Phase 7 Plan 07-03 — N→1 location merge server action (DATA-02).
 *
 * Replaces the legacy thin wrapper around `mergeLocations` (src/lib/merge.ts).
 * New shape:
 *   - admin-only (requireRole)
 *   - session-scoped advisory lock 738294108 (distinct from Azure ETL 105,
 *     Monday import 106, wipe runbook 107) — same key as undoMerge's
 *     transaction-scoped lock so an in-flight forward-merge BLOCKS any
 *     concurrent undo against potentially-overlapping rows.
 *   - delegates to `applyLocationMerge` for snapshot-before-commit + sentinel
 *     guard.
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
import { sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";

import { db } from "@/db";
import { applyLocationMerge } from "@/lib/location-merge";
import { requireRole } from "@/lib/rbac";

// Location merge UI lock key. Distinct from the Azure ETL, Monday import, and
// wipe-runbook keys (see PATTERNS.md § Lock key registry). Same key is used
// by undoMerge as a transaction-scoped advisory_xact_lock so an in-flight
// forward merge blocks any concurrent undo.
const LOCK_KEY = 738294108;

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

  // Session-scoped advisory lock. pg_try_advisory_lock returns immediately
  // (no blocking) so a contention surfaces as a typed envelope the UI can show.
  const lockResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(${LOCK_KEY})::boolean AS lock`,
  );
  // postgres-js returns the row-list directly (array-shaped); node-postgres
  // returns `{ rows: [...] }`. Both surfaces flow through here at runtime.
  const lockRows: Array<{ lock: boolean }> =
    lockResult && typeof lockResult === "object" && "rows" in lockResult
      ? (lockResult as unknown as { rows: Array<{ lock: boolean }> }).rows
      : (lockResult as unknown as Array<{ lock: boolean }>);
  const acquired = lockRows[0]?.lock === true;
  if (!acquired) return { status: "lock_contention" };

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
    return {
      error: err instanceof Error ? err.message : "Failed to merge locations",
    };
  } finally {
    try {
      await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`);
    } catch {
      /* ignore — session may have already been released */
    }
  }
}
