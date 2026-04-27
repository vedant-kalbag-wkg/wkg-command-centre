/**
 * Idempotent cleanup of the multi-location-group membership bug per audit
 * Resolved Decision D5 (tasks/todo.md, PR-6 Part B).
 *
 * Background: Monday import historically inserted a UK city-group membership
 * for every active location AND a second membership to the location's real
 * city group. Audit found 19 active locations with this shape (18 non-UK
 * regions paired with a spurious UK city group; 1 UK location with two UK
 * city groups).
 *
 * Selection rule (per Part B handoff):
 *
 *   For each multi-LG active location, compute the MODAL primary_region_id
 *   among each candidate group's OTHER active members. Keep the membership
 *   whose group's modal region matches the location's own primary_region_id;
 *   delete the others.
 *
 *   Tie-breakers (rare):
 *     (a) prefer the group whose name appears in the location's name
 *         (case-insensitive substring),
 *     (b) then the membership with MIN(created_at).
 *
 * Mirrors the inline cleanup in
 * migrations/0030_location_group_membership_dedup.sql so a fresh DB replaying
 * migrations is also clean. The migration also adds UNIQUE(location_id) which
 * prevents this shape from re-emerging.
 *
 * Run:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *       scripts/cleanup-multi-location-group-memberships.ts
 *   Apply:
 *     npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *       scripts/cleanup-multi-location-group-memberships.ts --apply
 */
import { Pool } from "pg";

const APPLY = process.argv.includes("--apply");
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

type CandidateRow = {
  location_id: string;
  location_name: string;
  primary_region_id: string;
  primary_region_code: string;
  location_group_id: string;
  group_name: string;
  membership_created_at: Date;
  modal_region_id: string | null;
  modal_region_code: string | null;
};

type Decision = {
  location_id: string;
  location_name: string;
  primary_region_code: string;
  keep_group_id: string;
  keep_group_name: string;
  drop: { group_id: string; group_name: string }[];
};

function decide(rows: CandidateRow[]): Decision[] {
  const byLoc = new Map<string, CandidateRow[]>();
  for (const r of rows) {
    const arr = byLoc.get(r.location_id) ?? [];
    arr.push(r);
    byLoc.set(r.location_id, arr);
  }
  const out: Decision[] = [];
  for (const [, group] of byLoc) {
    // Stage 1: filter to candidates whose modal region matches loc.primary.
    const matchModal = group.filter(
      (r) => r.modal_region_id === r.primary_region_id,
    );
    // If exactly one survives -> winner. If multiple, tie-break within them.
    // If none survive, fall back to the original set so we still pick something.
    const pool0 =
      matchModal.length === 1
        ? matchModal
        : matchModal.length > 1
          ? matchModal
          : group;
    const sorted = [...pool0].sort((a, b) => {
      const an = a.location_name.toLowerCase().includes(a.group_name.toLowerCase()) ? 1 : 0;
      const bn = b.location_name.toLowerCase().includes(b.group_name.toLowerCase()) ? 1 : 0;
      if (bn !== an) return bn - an;
      const ta = a.membership_created_at.getTime();
      const tb = b.membership_created_at.getTime();
      if (ta !== tb) return ta - tb;
      // Final stable tiebreak so the script and the migration agree.
      return a.location_group_id < b.location_group_id ? -1 : 1;
    });
    const winner = sorted[0];
    const drop = group
      .filter((r) => r.location_group_id !== winner.location_group_id)
      .map((r) => ({ group_id: r.location_group_id, group_name: r.group_name }));
    out.push({
      location_id: winner.location_id,
      location_name: winner.location_name,
      primary_region_code: winner.primary_region_code,
      keep_group_id: winner.location_group_id,
      keep_group_name: winner.group_name,
      drop,
    });
  }
  return out;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));
  console.log("Mode:  ", APPLY ? "APPLY (writes + audit log)" : "DRY RUN (no writes)");

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const candidates = await client.query<CandidateRow>(`
      WITH multi_loc AS (
        SELECT l.id AS location_id, l.name AS location_name, l.primary_region_id
        FROM locations l
        WHERE l.archived_at IS NULL
          AND l.primary_region_id IS NOT NULL
          AND (
            SELECT COUNT(*) FROM location_group_memberships lgm
            WHERE lgm.location_id = l.id
          ) > 1
      )
      SELECT
        m.location_id,
        m.location_name,
        m.primary_region_id,
        pr.code AS primary_region_code,
        lgm.location_group_id,
        lg.name AS group_name,
        lgm.created_at AS membership_created_at,
        (
          SELECT l2.primary_region_id
          FROM location_group_memberships lgm2
          JOIN locations l2 ON l2.id = lgm2.location_id
          WHERE lgm2.location_group_id = lgm.location_group_id
            AND lgm2.location_id <> m.location_id
            AND l2.archived_at IS NULL
            AND l2.primary_region_id IS NOT NULL
          GROUP BY l2.primary_region_id
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ) AS modal_region_id,
        (
          SELECT mr.code
          FROM regions mr
          WHERE mr.id = (
            SELECT l2.primary_region_id
            FROM location_group_memberships lgm2
            JOIN locations l2 ON l2.id = lgm2.location_id
            WHERE lgm2.location_group_id = lgm.location_group_id
              AND lgm2.location_id <> m.location_id
              AND l2.archived_at IS NULL
              AND l2.primary_region_id IS NOT NULL
            GROUP BY l2.primary_region_id
            ORDER BY COUNT(*) DESC
            LIMIT 1
          )
        ) AS modal_region_code
      FROM multi_loc m
      JOIN location_group_memberships lgm ON lgm.location_id = m.location_id
      JOIN location_groups lg ON lg.id = lgm.location_group_id
      JOIN regions pr ON pr.id = m.primary_region_id
      ORDER BY m.location_name, lg.name
    `);

    if (candidates.rowCount === 0) {
      console.log("\nNo multi-LG active locations — nothing to do (idempotent re-run).");
      await client.query("ROLLBACK");
      return;
    }

    const decisions = decide(candidates.rows);

    console.log(`\n--- ${decisions.length} multi-LG active locations ---`);
    for (const d of decisions) {
      console.log(
        `  ${d.primary_region_code.padEnd(3)} ${d.location_name}\n` +
          `    KEEP: ${d.keep_group_name}\n` +
          `    DROP: ${d.drop.map((x) => x.group_name).join(", ")}`,
      );
    }

    if (!APPLY) {
      console.log("\n--- DRY RUN — would delete the DROP memberships above ---");
      console.log("  Re-run with --apply to execute.");
      await client.query("ROLLBACK");
      return;
    }

    // Build the (location_id, location_group_id) pairs to delete and run a
    // single DELETE keyed by both columns of the composite PK.
    const dropLocIds: string[] = [];
    const dropGroupIds: string[] = [];
    for (const d of decisions) {
      for (const x of d.drop) {
        dropLocIds.push(d.location_id);
        dropGroupIds.push(x.group_id);
      }
    }
    const del = await client.query(
      `
      DELETE FROM location_group_memberships
      WHERE (location_id, location_group_id) IN (
        SELECT * FROM unnest($1::uuid[], $2::uuid[])
      )
      `,
      [dropLocIds, dropGroupIds],
    );
    console.log(`\n  Deleted ${del.rowCount} location_group_membership rows.`);

    // Audit log — one row per dropped membership. Direct INSERT (not
    // writeAuditLog) because this script uses the raw pg pool, not the
    // drizzle singleton; mirroring writeAuditLog's column shape.
    let auditCount = 0;
    for (const d of decisions) {
      for (const x of d.drop) {
        await client.query(
          `
          INSERT INTO audit_logs
            (actor_id, actor_name, entity_type, entity_id, entity_name,
             action, field, old_value, new_value, metadata, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
          `,
          [
            ETL_SYSTEM_USER_ID,
            "ETL System (cleanup-multi-location-group-memberships)",
            "location",
            d.location_id,
            d.location_name,
            "unassign",
            "location_group_membership",
            x.group_name,
            null,
            JSON.stringify({
              reason:
                "D5 PR-6 Part B — modal-region rule selected the group whose other members share the location's primary region",
              primary_region_code: d.primary_region_code,
              kept_group_id: d.keep_group_id,
              kept_group_name: d.keep_group_name,
              removed_group_id: x.group_id,
              script: "scripts/cleanup-multi-location-group-memberships.ts",
            }),
          ],
        );
        auditCount += 1;
      }
    }
    console.log(`  Wrote ${auditCount} audit_logs rows.`);

    // Idempotency self-check inside the same tx — should report 0.
    const post = await client.query<{ n: number }>(`
      SELECT COUNT(*)::int AS n
      FROM (
        SELECT lgm.location_id
        FROM location_group_memberships lgm
        JOIN locations l ON l.id = lgm.location_id
        WHERE l.archived_at IS NULL
        GROUP BY lgm.location_id
        HAVING COUNT(*) > 1
      ) t
    `);
    console.log(
      `  Post-delete multi-LG active locations: ${post.rows[0].n} (idempotent: re-run would do nothing).`,
    );

    await client.query("COMMIT");
    console.log("\nCommitted.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\nRolled back:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
