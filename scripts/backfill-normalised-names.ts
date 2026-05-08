/**
 * Phase 7 Plan 07-04 Task 1 — backfill `locations.normalised_name`.
 *
 * Idempotent re-runnable maintenance op. Populates the canonical normalised
 * form of `locations.name` on every active row whose `normalised_name IS NULL`.
 * Once the partial unique index `locations_normalised_name_unique_active`
 * lands (Task 1 Step 3) any row inserted without an explicit `normalised_name`
 * also needs the value set — but that's the importer's contract; this script
 * is the one-shot backfill for legacy rows that predate Plan B.
 *
 * Usage:
 *   Dry-run (default — prints what it would do, ROLLBACKs):
 *     DATABASE_URL=... npx tsx scripts/backfill-normalised-names.ts
 *   Apply (writes + COMMITs):
 *     DATABASE_URL=... npx tsx scripts/backfill-normalised-names.ts --apply
 *
 * Re-running with `--apply` after the backfill is a no-op: the WHERE clause
 * filters by `normalised_name IS NULL` so populated rows are never overwritten.
 * (Threat T-07.04-04 mitigation.)
 */

import { Pool } from "pg";

import { normaliseName } from "@/lib/normalise";

const APPLY = process.argv.includes("--apply");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM locations WHERE normalised_name IS NULL`,
    );
    console.log(
      `Found ${rows.rows.length} row(s) with NULL normalised_name (${
        APPLY ? "applying" : "dry-run"
      })`,
    );
    let updated = 0;
    for (const r of rows.rows) {
      const n = normaliseName(r.name);
      if (APPLY) {
        await client.query(
          `UPDATE locations SET normalised_name = $1 WHERE id = $2`,
          [n, r.id],
        );
        updated++;
      } else {
        console.log(`  [dry] ${r.id}: "${r.name}" -> "${n}"`);
      }
    }
    if (APPLY) {
      await client.query("COMMIT");
      console.log(`Backfill applied. Updated ${updated} row(s).`);
    } else {
      await client.query("ROLLBACK");
      console.log("Dry-run — no changes committed.");
    }
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* best-effort */
    }
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
