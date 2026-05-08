/**
 * Phase 7 Plan 07-03 — Audit-log entry detail page (DATA-02 / UI-SPEC Surface 4).
 *
 * Lives at `/admin/audit-log/[id]/` (NOT /settings/audit-log/[id]) so the
 * Undo merge action can co-locate at `actions/undo-merge.ts` under the same
 * route segment. The legacy /settings/audit-log/ list page stays unchanged.
 *
 * Render rules:
 *   - audit row's action='merge' AND a linked location_merge_snapshots row
 *     still exists ⇒ render the Undo merge section (button live).
 *   - action='merge' but no linked snapshot ⇒ render "Undo no longer
 *     available" copy (snapshot deleted by an earlier undo or future 30-day
 *     cron).
 *   - any other action ⇒ neither section renders.
 */
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db } from "@/db";
import { auditLogs, locationMergeSnapshots } from "@/db/schema";
import { requireRole } from "@/lib/rbac";

import { UndoMergeButton } from "./undo-merge-button";

export default async function AuditLogDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("admin");
  const { id } = await params;

  const entry = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.id, id))
    .limit(1);
  if (!entry[0]) notFound();
  const log = entry[0];
  const isMerge = log.action === "merge";

  // Snapshot existence is the single source of truth for "undo still
  // available". The undoMerge action DELETEs the snapshot row on success;
  // a future 30-day cron will delete aged-out snapshots — both paths surface
  // here as "no button rendered".
  const snap = isMerge
    ? await db
        .select({ id: locationMergeSnapshots.id })
        .from(locationMergeSnapshots)
        .where(eq(locationMergeSnapshots.auditLogId, log.id))
        .limit(1)
    : [];
  const hasSnapshot = snap.length > 0;
  const snapshotId = snap[0]?.id ?? null;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold tracking-[-0.01em]">
        Audit log entry
      </h1>
      <pre className="bg-muted/50 p-3 rounded-lg text-xs overflow-x-auto">
        {JSON.stringify(log, null, 2)}
      </pre>

      {isMerge && hasSnapshot && snapshotId && (
        <section className="border rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-bold tracking-[-0.01em]">
            Undo this merge
          </h3>
          <p className="text-sm text-muted-foreground">
            Restores archived locations and reverses every recorded FK
            migration from the snapshot. The snapshot row is deleted on
            success; this action cannot be undone again.
          </p>
          <UndoMergeButton snapshotId={snapshotId} />
        </section>
      )}

      {isMerge && !hasSnapshot && (
        <section className="border rounded-xl p-4 space-y-2 bg-muted/20">
          <p className="text-sm text-muted-foreground">
            Undo is no longer available — snapshot has been deleted (either
            already undone, or aged out).
          </p>
        </section>
      )}
    </div>
  );
}
