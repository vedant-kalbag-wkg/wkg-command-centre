/**
 * Phase 6 Plan 06-01 — D8 multi-POS merge CLI.
 *
 * Loads pending merge_proposals (decision IN ('approved','swapped'),
 * applied_at IS NULL) and applies the bulk merge. Mirrors
 * scripts/backfill-kiosk-install-dates.ts:
 *   - --apply flag (default = dry-run; no writes)
 *   - reads DATABASE_URL from env
 *   - ETL_SYSTEM_USER_ID actor for audit-log
 *
 * Usage:
 *   Dry-run (prints planned merges, no writes):
 *     DATABASE_URL=... npx tsx scripts/multi-pos-merge.ts
 *
 *   Apply (single transaction across all pending pairs):
 *     DATABASE_URL=... npx tsx scripts/multi-pos-merge.ts --apply
 *
 * Idempotency: re-running --apply after a successful apply prints
 * "0 pairs to merge" and exits 0. Guarded by `applied_at IS NULL` on the
 * proposal rows.
 *
 * Rollback: each rewrite emits an aggregate audit_logs row carrying
 * { script, oldLocationId, newLocationId, table } in metadata. Rollback SQL
 * keys on metadata->>'script' = 'scripts/multi-pos-merge.ts' and the
 * oldLocationId / newLocationId pair to reverse the FK rewrites.
 */
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import {
  applyBulkMerge,
  type MergePair,
} from "@/lib/multi-pos-merge";

const APPLY = process.argv.includes("--apply");
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
const ETL_SYSTEM_USER_NAME = "scripts/multi-pos-merge.ts";

type PendingProposal = {
  id: string;
  cluster_id: number;
  canonical_id: string;
  defunct_id: string;
  decision: "approved" | "swapped";
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));
  console.log("Mode:  ", APPLY ? "APPLY (writes + audit log)" : "DRY RUN (no writes)");

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  try {
    // Load pending proposals using raw SQL — we don't need the full Drizzle
    // schema import here since the only consumer is this script.
    const pendingResult = await db.execute<PendingProposal>(sql`
      SELECT id::text          AS id,
             cluster_id::int   AS cluster_id,
             canonical_id::text AS canonical_id,
             defunct_id::text  AS defunct_id,
             decision
        FROM merge_proposals
       WHERE applied_at IS NULL
         AND decision IN ('approved', 'swapped')
       ORDER BY cluster_id, decided_at
    `);
    const pending: PendingProposal[] = (pendingResult as { rows?: PendingProposal[] }).rows
      ?? (Array.isArray(pendingResult) ? (pendingResult as unknown as PendingProposal[]) : []);

    console.log(`Found ${pending.length} pending merge proposal(s) to apply.`);
    if (pending.length === 0) {
      console.log("Nothing to do — exiting.");
      return;
    }

    // Build pairs: 'swapped' decisions invert canonical/defunct.
    const pairs: MergePair[] = pending.map((row) => {
      if (row.decision === "swapped") {
        return { canonicalId: row.defunct_id, defunctId: row.canonical_id };
      }
      return { canonicalId: row.canonical_id, defunctId: row.defunct_id };
    });

    // Print dry-run summary by cluster.
    const byCluster = new Map<number, PendingProposal[]>();
    for (const p of pending) {
      const list = byCluster.get(p.cluster_id) ?? [];
      list.push(p);
      byCluster.set(p.cluster_id, list);
    }
    console.log("\nPlanned merges (cluster_id, decision, canonical → defunct):");
    for (const [clusterId, rows] of [...byCluster.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      console.log(`  Cluster ${clusterId}:`);
      for (const r of rows) {
        console.log(
          `    [${r.decision}] ${r.canonical_id} ← ${r.defunct_id}`,
        );
      }
    }

    if (!APPLY) {
      console.log("\nDry-run complete. Re-run with --apply to commit.");
      return;
    }

    console.log("\nApplying merges in a single transaction...");
    const result = await applyBulkMerge(
      pairs,
      { id: ETL_SYSTEM_USER_ID, name: ETL_SYSTEM_USER_NAME },
      db,
    );

    // Stamp applied_at on every applied row so re-runs are no-ops.
    const ids = pending.map((p) => p.id);
    await db.execute(sql`
      UPDATE merge_proposals
         SET applied_at = NOW()
       WHERE id = ANY(${ids}::uuid[])
    `);

    console.log("\nApplied successfully. Result:");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
