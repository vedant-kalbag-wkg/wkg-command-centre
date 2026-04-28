"use server";

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "@/db";
import { mergeProposals, locations } from "@/db/schema";
import { requireRole, getSessionOrThrow } from "@/lib/rbac";
import { writeAuditLog } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { and, isNull, sql } from "drizzle-orm";
import {
  applyBulkMerge,
  type MergePair,
  type BulkMergeResult,
} from "@/lib/multi-pos-merge";

// =============================================================================
// Phase 6 Plan 06-01 — D8 multi-POS merge review server actions
//
// Loads the 22 clusters from the proposal CSV at request time (CSV is small,
// 52 lines, so re-parsing per request is cheap), persists per-cluster
// decisions to merge_proposals, and triggers the bulk-merge primitive when
// the admin clicks Apply.
//
// Decision values:
//   approved    — merge defunct → canonical (FK rewrite + archive defunct)
//   swapped     — invert canonical/defunct then proceed as approved
//   rejected    — leave both rows in place; not actually a duplicate
//   address_fix — leave rows in place; address-data-quality fix riding along
//                 (Phase 5.7); operator captures corrective notes in `notes`
// =============================================================================

const CSV_PATH = join(
  process.cwd(),
  "tasks/analytics-audit/multi-pos-merge-proposal.csv",
);

export type ClusterDefunctPair = {
  defunctId: string;
  defunctName: string;
  defunctOutletCode: string;
  defunctSalesCount: number;
  defunctAmountTotal: number;
  defunctKiosksCount: number;
  notes: string;
};

export type ClusterRow = {
  clusterId: number;
  clusterBasis: string;
  address: string;
  region: string;
  canonicalId: string;
  canonicalName: string;
  canonicalOutletCode: string;
  canonicalSalesCount: number;
  canonicalAmountTotal: number;
  defunctPairs: ClusterDefunctPair[];
};

export type SavedDecision = {
  canonicalId: string;
  defunctId: string;
  decision: "approved" | "swapped" | "rejected" | "address_fix";
  notes: string | null;
  appliedAt: Date | null;
};

// CSV parser that honours double-quoted fields with embedded commas. Mirrors
// scripts/probe-multi-pos-merge-collisions.ts to keep parsing consistent.
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export async function loadMergeProposalClusters(): Promise<ClusterRow[]> {
  await requireRole("admin");
  if (!existsSync(CSV_PATH)) return [];
  const csv = readFileSync(CSV_PATH, "utf8");
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(",");
  const idx = (name: string) => header.indexOf(name);

  // Group rows by cluster_id. The first row in each cluster (with empty
  // defunct_id) carries the canonical announcement; subsequent rows in the
  // same cluster carry distinct defunct triples.
  const clusterMap = new Map<number, ClusterRow>();
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const clusterId = Number(cols[idx("cluster_id")]);
    if (!Number.isFinite(clusterId)) continue;
    let cluster = clusterMap.get(clusterId);
    if (!cluster) {
      cluster = {
        clusterId,
        clusterBasis: cols[idx("cluster_basis")],
        address: cols[idx("address")],
        region: cols[idx("region")],
        canonicalId: cols[idx("canonical_id")],
        canonicalName: cols[idx("canonical_name")],
        canonicalOutletCode: cols[idx("canonical_outlet_code")],
        canonicalSalesCount: Number(cols[idx("canonical_sales_count")] ?? 0),
        canonicalAmountTotal: Number(cols[idx("canonical_amount_total")] ?? 0),
        defunctPairs: [],
      };
      clusterMap.set(clusterId, cluster);
    }
    const defunctId = cols[idx("defunct_id")];
    if (defunctId && defunctId.trim() !== "") {
      cluster.defunctPairs.push({
        defunctId,
        defunctName: cols[idx("defunct_name")] ?? "",
        defunctOutletCode: cols[idx("defunct_outlet_code")] ?? "",
        defunctSalesCount: Number(cols[idx("defunct_sales_count")] ?? 0),
        defunctAmountTotal: Number(cols[idx("defunct_amount_total")] ?? 0),
        defunctKiosksCount: Number(cols[idx("defunct_kiosks_count")] ?? 0),
        notes: cols[idx("notes")] ?? "",
      });
    }
  }
  return [...clusterMap.values()].sort((a, b) => a.clusterId - b.clusterId);
}

export async function listSavedDecisions(): Promise<SavedDecision[]> {
  await requireRole("admin");
  return db
    .select({
      canonicalId: mergeProposals.canonicalId,
      defunctId: mergeProposals.defunctId,
      decision: mergeProposals.decision,
      notes: mergeProposals.notes,
      appliedAt: mergeProposals.appliedAt,
    })
    .from(mergeProposals);
}

export async function saveClusterDecision(args: {
  canonicalId: string;
  defunctId: string;
  clusterId: number;
  decision: "approved" | "swapped" | "rejected" | "address_fix";
  notes?: string;
}): Promise<{ success: true } | { error: string }> {
  try {
    await requireRole("admin");
    const session = await getSessionOrThrow();

    if (args.decision === "address_fix" && (!args.notes || args.notes.trim() === "")) {
      return { error: "Notes are required when decision is 'address_fix'" };
    }

    // Upsert keyed on (canonical_id, defunct_id). Re-saving the same pair
    // updates decision/notes; once applied_at is set the apply path treats
    // the row as a no-op so re-decisions after apply do not re-trigger merge.
    await db
      .insert(mergeProposals)
      .values({
        clusterId: args.clusterId,
        canonicalId: args.canonicalId,
        defunctId: args.defunctId,
        decision: args.decision,
        notes: args.notes ?? null,
        decidedBy: session.user.id,
        decidedByName: session.user.name,
      })
      .onConflictDoUpdate({
        target: [mergeProposals.canonicalId, mergeProposals.defunctId],
        set: {
          decision: args.decision,
          notes: args.notes ?? null,
          decidedBy: session.user.id,
          decidedByName: session.user.name,
          decidedAt: new Date(),
        },
      });

    // Audit-log the decision so the global timeline reflects who chose what.
    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "location",
      entityId: args.defunctId,
      entityName: "",
      action: "update",
      field: "merge_proposal_decision",
      newValue: args.decision,
      metadata: {
        clusterId: args.clusterId,
        canonicalId: args.canonicalId,
        notes: args.notes ?? null,
      },
    });

    revalidatePath("/settings/duplicates/merge-review");
    return { success: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to save decision",
    };
  }
}

export async function applyApprovedMerges(): Promise<
  | { success: true; result: BulkMergeResult }
  | { error: string }
> {
  try {
    await requireRole("admin");
    const session = await getSessionOrThrow();

    // Load all decisions that imply a merge AND have not been applied yet.
    // 'rejected' and 'address_fix' decisions are excluded — they are
    // documentation-only.
    const pending = await db
      .select({
        id: mergeProposals.id,
        canonicalId: mergeProposals.canonicalId,
        defunctId: mergeProposals.defunctId,
        decision: mergeProposals.decision,
      })
      .from(mergeProposals)
      .where(
        and(
          isNull(mergeProposals.appliedAt),
          // decision IN ('approved','swapped')
          sql`${mergeProposals.decision} IN ('approved','swapped')`,
        ),
      );

    if (pending.length === 0) {
      return {
        success: true,
        result: emptyResult(),
      };
    }

    // For 'swapped' decisions, invert canonical/defunct: the operator told us
    // the original canonical pick was wrong. The bulk merger always treats
    // canonicalId as the survivor.
    const pairs: MergePair[] = pending.map((row) => {
      if (row.decision === "swapped") {
        return { canonicalId: row.defunctId, defunctId: row.canonicalId };
      }
      return { canonicalId: row.canonicalId, defunctId: row.defunctId };
    });

    const result = await applyBulkMerge(
      pairs,
      { id: session.user.id, name: session.user.name },
      db,
    );

    // Stamp applied_at on every applied row.
    const ids = pending.map((p) => p.id);
    await db
      .update(mergeProposals)
      .set({ appliedAt: new Date() })
      .where(sql`${mergeProposals.id} = ANY(${ids}::uuid[])`);

    // Summary audit-log; per-pair / per-table audit rows are emitted inside
    // applyBulkMerge so the rollback SQL keys directly off them.
    await writeAuditLog({
      actorId: session.user.id,
      actorName: session.user.name,
      entityType: "system",
      entityId: "multi-pos-merge",
      entityName: "Multi-POS merge apply",
      action: "merge",
      metadata: {
        script: "scripts/multi-pos-merge.ts",
        pairsMerged: result.pairsMerged,
        salesRecordsRewritten: result.salesRecordsRewritten,
        locationsArchived: result.locationsArchived,
      },
    });

    revalidatePath("/settings/duplicates/merge-review");
    return { success: true, result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Failed to apply merges",
    };
  }
}

function emptyResult(): BulkMergeResult {
  return {
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
}

// Lightweight existence check used by the page.tsx server component to
// decide whether canonical/defunct rows are still active. Surfaces stale CSV
// entries (where a location has already been archived since the proposal
// was generated) so the UI can grey them out.
export async function listActiveLocationIds(ids: string[]): Promise<Set<string>> {
  await requireRole("admin");
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: locations.id })
    .from(locations)
    .where(
      and(
        sql`${locations.id} = ANY(${ids}::uuid[])`,
        isNull(locations.archivedAt),
      ),
    );
  return new Set(rows.map((r) => r.id));
}
