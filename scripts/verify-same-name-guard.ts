/**
 * Phase 7 Plan 07-04 Task 3 — partial unique index probe.
 *
 * Wraps everything in BEGIN/ROLLBACK so the probe row never persists. Picks
 * an existing active normalised_name and attempts an INSERT with a fresh
 * `outlet_code` but the colliding `normalised_name`. If the partial unique
 * index is enforced the INSERT raises Postgres SQLSTATE 23505 (unique
 * violation) and the script prints `PASS` and exits 0. If the index is
 * missing the INSERT succeeds (FAIL → exit 1).
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/verify-same-name-guard.ts
 *
 * Used by Plan E's UAT verification gate. Do NOT run with --apply / similar
 * — the rollback is unconditional, by design.
 */

import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const sample = await client.query<{
      normalised_name: string;
      primary_region_id: string;
    }>(
      `SELECT normalised_name, primary_region_id
       FROM locations
       WHERE archived_at IS NULL
         AND normalised_name IS NOT NULL
       LIMIT 1`,
    );
    if (sample.rows.length === 0) {
      console.log("SKIP — no active locations to probe");
      await client.query("ROLLBACK");
      process.exit(0);
    }
    const { normalised_name, primary_region_id } = sample.rows[0];

    let enforced = false;
    try {
      await client.query(
        `INSERT INTO locations (name, normalised_name, outlet_code, primary_region_id)
         VALUES ($1, $2, $3, $4)`,
        [
          `probe-${Date.now()}`,
          normalised_name,
          `probe-${Date.now()}`,
          primary_region_id,
        ],
      );
      // Probe succeeded → index NOT enforcing.
      enforced = false;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === "23505") {
        enforced = true;
      } else {
        // Some other error (FK / NOT NULL / connection) — re-throw so the
        // caller sees the real failure rather than a misleading FAIL.
        await client.query("ROLLBACK");
        throw err;
      }
    }

    // Always ROLLBACK — the probe row must NEVER persist (T-07.04-07).
    await client.query("ROLLBACK");

    if (enforced) {
      console.log("PASS — partial unique index enforced");
      process.exit(0);
    } else {
      console.error("FAIL — duplicate active normalised_name accepted");
      process.exit(1);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
