/**
 * Idempotent cleanup of the {UK, X} multi-region membership bug per audit
 * Resolved Decision D5 (tasks/todo.md, PR-6 Part A).
 *
 * Background: Monday import historically inserted a UK region membership for
 * every active location AND a second membership to the location's real
 * region (DE / ES). Audit found 18 active locations stuck in this shape; the
 * UK row is the wrong one (location.primary_region_id matches the non-UK row).
 *
 * What this script does — for each active location with exactly TWO
 * memberships, where one is UK and primary_region_id != UK: delete the UK
 * membership. Conservative: skips any other multi-region case so we don't
 * mask unknown bugs.
 *
 * Mirrors the inline cleanup in migrations/0029_region_membership_dedup.sql
 * so a fresh DB replaying migrations is also clean. The migration also adds
 * UNIQUE(location_id) which prevents this shape from re-emerging.
 *
 * Run:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *       scripts/cleanup-bogus-region-memberships.ts
 *   Apply:
 *     npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *       scripts/cleanup-bogus-region-memberships.ts --apply
 */
import { Pool } from "pg";

const APPLY = process.argv.includes("--apply");
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

type BogusRow = {
  location_id: string;
  location_name: string;
  uk_region_id: string;
  primary_region_id: string;
  primary_region_code: string;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));
  console.log("Mode:  ", APPLY ? "APPLY (writes + audit log)" : "DRY RUN (no writes)");

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ukRow = await client.query<{ id: string }>(
      `SELECT id FROM regions WHERE code = 'UK'`,
    );
    if (ukRow.rowCount !== 1) {
      throw new Error(`Expected exactly one UK region; got ${ukRow.rowCount}`);
    }
    const ukRegionId = ukRow.rows[0].id;

    // Identify bogus UK memberships matching the documented bug shape:
    // active location, exactly 2 memberships, primary_region_id != UK.
    const candidates = await client.query<BogusRow>(
      `
      SELECT
        l.id            AS location_id,
        l.name          AS location_name,
        $1::uuid        AS uk_region_id,
        l.primary_region_id,
        pr.code         AS primary_region_code
      FROM locations l
      JOIN location_region_memberships lrm_uk
        ON lrm_uk.location_id = l.id
       AND lrm_uk.region_id = $1::uuid
      JOIN regions pr ON pr.id = l.primary_region_id
      WHERE l.archived_at IS NULL
        AND l.primary_region_id IS NOT NULL
        AND l.primary_region_id <> $1::uuid
        AND (
          SELECT COUNT(*) FROM location_region_memberships lrm2
          WHERE lrm2.location_id = l.id
        ) = 2
      ORDER BY l.name
      `,
      [ukRegionId],
    );

    console.log(`\n--- Bogus UK memberships found: ${candidates.rowCount} ---`);
    for (const r of candidates.rows.slice(0, 30)) {
      console.log(
        `  ${r.location_id}  primary=${r.primary_region_code.padEnd(3)}  ${r.location_name}`,
      );
    }
    if (candidates.rowCount! > 30) {
      console.log(`  ... and ${candidates.rowCount! - 30} more`);
    }

    // Wider sanity: report any other multi-region active locations so a human
    // notices if the shape ever drifts. Script does NOT touch these.
    const otherMulti = await client.query<{
      location_id: string;
      location_name: string;
      n: number;
    }>(
      `
      SELECT l.id AS location_id, l.name AS location_name,
             COUNT(*)::int AS n
      FROM locations l
      JOIN location_region_memberships lrm ON lrm.location_id = l.id
      WHERE l.archived_at IS NULL
      GROUP BY l.id, l.name
      HAVING COUNT(*) > 1
         AND NOT (
           COUNT(*) = 2
           AND BOOL_OR(lrm.region_id = $1::uuid)
           AND l.primary_region_id IS NOT NULL
           AND l.primary_region_id <> $1::uuid
         )
      ORDER BY l.name
      `,
      [ukRegionId],
    );
    if (otherMulti.rowCount! > 0) {
      console.log(
        `\n  WARNING: ${otherMulti.rowCount} other multi-region active locations exist (NOT touched):`,
      );
      for (const r of otherMulti.rows.slice(0, 20)) {
        console.log(`    ${r.location_id}  n=${r.n}  ${r.location_name}`);
      }
    }

    if (candidates.rowCount === 0) {
      console.log("\n✓ Nothing to clean — re-run is a no-op (idempotent).");
      await client.query("ROLLBACK");
      return;
    }

    if (!APPLY) {
      console.log(
        "\n--- DRY RUN — would delete the UK membership for each row above ---",
      );
      console.log("  Re-run with --apply to execute.");
      await client.query("ROLLBACK");
      return;
    }

    // Single DELETE keyed by (location_id, region_id) — composite PK matches.
    const del = await client.query(
      `
      DELETE FROM location_region_memberships
      WHERE region_id = $1::uuid
        AND location_id = ANY($2::uuid[])
      `,
      [ukRegionId, candidates.rows.map((r) => r.location_id)],
    );
    console.log(`\n  Deleted ${del.rowCount} UK membership rows.`);

    // Audit log — one row per affected location. Direct INSERT (not
    // writeAuditLog) because this script uses the raw pg pool, not the
    // drizzle singleton; mirroring writeAuditLog's column shape.
    for (const r of candidates.rows) {
      await client.query(
        `
        INSERT INTO audit_logs
          (actor_id, actor_name, entity_type, entity_id, entity_name,
           action, field, old_value, new_value, metadata, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
        `,
        [
          ETL_SYSTEM_USER_ID,
          "ETL System (cleanup-bogus-region-memberships)",
          "location",
          r.location_id,
          r.location_name,
          "unassign",
          "region_membership",
          "UK",
          null,
          JSON.stringify({
            reason:
              "D5 PR-6 Part A — Monday-import UK-default cleanup; primary_region != UK",
            primary_region_code: r.primary_region_code,
            removed_region_id: r.uk_region_id,
            script: "scripts/cleanup-bogus-region-memberships.ts",
          }),
        ],
      );
    }
    console.log(`  Wrote ${candidates.rowCount} audit_logs rows.`);

    // Idempotency self-check — re-run the candidate query inside the same tx.
    // Expect 0: every bogus UK row is gone, so a second run finds nothing.
    const post = await client.query<{ n: number }>(
      `
      SELECT COUNT(*)::int AS n
      FROM locations l
      JOIN location_region_memberships lrm_uk
        ON lrm_uk.location_id = l.id
       AND lrm_uk.region_id = $1::uuid
      WHERE l.archived_at IS NULL
        AND l.primary_region_id IS NOT NULL
        AND l.primary_region_id <> $1::uuid
        AND (
          SELECT COUNT(*) FROM location_region_memberships lrm2
          WHERE lrm2.location_id = l.id
        ) = 2
      `,
      [ukRegionId],
    );
    console.log(
      `  Post-delete candidate count: ${post.rows[0].n} (idempotent: re-run would do nothing).`,
    );

    await client.query("COMMIT");
    console.log("\n✓ Committed.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n✗ Rolled back:", err);
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
