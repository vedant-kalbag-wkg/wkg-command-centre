/**
 * Phase 6 Plan 06-01 — D8 multi-POS bulk-merge primitive.
 *
 * STUB — Task 4 fills this in with the transactional bulk-merger that
 * rewrites every FK to defunct → canonical and emits the audit-log shape
 * the rollback SQL keys off. Until then, calling applyBulkMerge() throws.
 */
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/db/schema";

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

// Loose DB type so both the prod postgres-js client AND the testcontainer
// node-postgres client satisfy it. The implementation in Task 4 narrows the
// type internally where needed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MergeDb = PostgresJsDatabase<typeof schema> | any;

/**
 * Apply a set of merge pairs in ONE transaction. Per-cluster atomicity is
 * the caller's responsibility — pass all approved pairs to a single call to
 * keep the operation atomic.
 *
 * NOTE: STUB — replaced by Task 4. Callers (the apply-button server action,
 * the CLI script) should expect this to be implemented before they run.
 */
export async function applyBulkMerge(
  pairs: MergePair[],
  actor: MergeActor,
  db: MergeDb,
): Promise<BulkMergeResult> {
  void pairs;
  void actor;
  void db;
  throw new Error(
    "applyBulkMerge is not yet implemented (Phase 6 Plan 06-01 Task 4 — STUB)",
  );
}
