/**
 * Pre-migration data patch for Neon dev.
 *
 * Migration 0022 (NetSuite restructure) has three hard gates:
 *   (i)   every region must have a non-NULL code
 *   (ii)  outlet_code is being set NOT NULL — no NULL values allowed
 *   (iii) every non-archived location must be resolvable to a region
 *         via location_region_memberships or kiosk_assignments→kiosks.region_group
 *
 * This script runs in a single transaction:
 *   1. Rename/code existing regions to canonical names ('United Kingdom',
 *      'Spain', 'Germany') + set codes (UK/ES/DE).
 *   2. DELETE all locations with outlet_code IS NULL (test artifacts —
 *      names like EDIT-FIELD-*, INLINE-*, CONTRACT-VIEW-*, etc.). CASCADE
 *      removes any dependent membership rows.
 *   3. Archive remaining unresolved active locations (Australia + orphan
 *      real-with-code rows that have no workable region mapping). The
 *      migration's archived-sentinel defaults them to UK region.
 *
 * Transactional — all-or-nothing. Prints what was changed and commits
 * only if no error. Safe to re-run (no-op after first successful run).
 */
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("\n--- Step 1: fix regions.code ---");
    const r1 = await client.query(
      `UPDATE regions SET name = 'United Kingdom', code = 'UK'
       WHERE name = 'UK' AND code IS NULL RETURNING id, name, code`,
    );
    for (const r of r1.rows) console.log(`  patched: ${r.name} (${r.code})  id=${r.id}`);
    const r2 = await client.query(
      `UPDATE regions SET code = 'ES' WHERE name = 'Spain' AND code IS NULL RETURNING id, name, code`,
    );
    for (const r of r2.rows) console.log(`  patched: ${r.name} (${r.code})  id=${r.id}`);
    const r3 = await client.query(
      `UPDATE regions SET code = 'DE' WHERE name = 'Germany' AND code IS NULL RETURNING id, name, code`,
    );
    for (const r of r3.rows) console.log(`  patched: ${r.name} (${r.code})  id=${r.id}`);

    console.log("\n--- Step 2: DELETE locations with NULL outlet_code (test artifacts) ---");
    const toDelete = await client.query(
      `SELECT count(*)::int AS c FROM locations WHERE outlet_code IS NULL`,
    );
    console.log(`  will delete ${toDelete.rows[0].c} rows`);
    // Clear dependent rows first (some tables may not have ON DELETE CASCADE):
    await client.query(
      `DELETE FROM location_hotel_group_memberships
       WHERE location_id IN (SELECT id FROM locations WHERE outlet_code IS NULL)`,
    );
    await client.query(
      `DELETE FROM location_region_memberships
       WHERE location_id IN (SELECT id FROM locations WHERE outlet_code IS NULL)`,
    );
    await client.query(
      `DELETE FROM location_group_memberships
       WHERE location_id IN (SELECT id FROM locations WHERE outlet_code IS NULL)`,
    );
    await client.query(
      `DELETE FROM location_products
       WHERE location_id IN (SELECT id FROM locations WHERE outlet_code IS NULL)`,
    );
    // kiosk_assignments referencing these locations — clear them so kiosks aren't orphaned
    await client.query(
      `DELETE FROM kiosk_assignments
       WHERE location_id IN (SELECT id FROM locations WHERE outlet_code IS NULL)`,
    );
    // sales_records also references location_id — but old schema, will be truncated by 0022 anyway
    await client.query(
      `DELETE FROM sales_records
       WHERE location_id IN (SELECT id FROM locations WHERE outlet_code IS NULL)`,
    );
    const del = await client.query(`DELETE FROM locations WHERE outlet_code IS NULL`);
    console.log(`  deleted ${del.rowCount} locations`);

    console.log("\n--- Step 3: archive unresolved active locations (AU + orphan) ---");
    // Using the same CASE mapping as migration 0022, archive any non-archived
    // location that still can't resolve to a region. After patching region
    // codes (step 1), UK/DE/ES kiosk-assigned locations auto-resolve. What
    // remains is Australia + orphans.
    const archive = await client.query(`
      UPDATE locations
      SET archived_at = NOW(), updated_at = NOW()
      WHERE id IN (
        SELECT l.id FROM locations l
        WHERE l.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM location_region_memberships lrm
          WHERE lrm.location_id = l.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM kiosk_assignments ka
          JOIN kiosks k ON k.id = ka.kiosk_id
          JOIN regions r ON r.code = CASE k.region_group
            WHEN 'UK' THEN 'UK' WHEN 'Ireland' THEN 'IE' WHEN 'Prague' THEN 'CZ'
            WHEN 'Spain' THEN 'ES' WHEN 'Germany' THEN 'DE' ELSE NULL END
          WHERE ka.location_id = l.id
        )
      )
      RETURNING id, name, outlet_code`);
    console.log(`  archived ${archive.rowCount} locations`);
    for (const r of archive.rows.slice(0, 20)) {
      console.log(`    ${(r.outlet_code ?? "(no code)").padEnd(10)} ${r.name}`);
    }
    if (archive.rowCount! > 20) console.log(`    ... and ${archive.rowCount! - 20} more`);

    console.log("\n--- Verification: safety-gate simulation post-patch ---");
    const verify = await client.query(`
      WITH resolved AS (
        SELECT l.id, l.archived_at IS NOT NULL AS is_archived,
          COALESCE(
            (SELECT r.id FROM location_region_memberships lrm
               JOIN regions r ON r.id = lrm.region_id
              WHERE lrm.location_id = l.id LIMIT 1),
            (SELECT r.id FROM kiosk_assignments ka
               JOIN kiosks k ON k.id = ka.kiosk_id
               JOIN regions r ON r.code = CASE k.region_group
                   WHEN 'UK' THEN 'UK' WHEN 'Ireland' THEN 'IE' WHEN 'Prague' THEN 'CZ'
                   WHEN 'Spain' THEN 'ES' WHEN 'Germany' THEN 'DE' ELSE NULL END
                WHERE ka.location_id = l.id LIMIT 1),
            CASE WHEN l.archived_at IS NOT NULL
                 THEN (SELECT id FROM regions WHERE code = 'UK')
                 ELSE NULL END
          ) AS region_id
        FROM locations l
      )
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE region_id IS NOT NULL)::int AS resolved,
        count(*) FILTER (WHERE region_id IS NULL AND NOT is_archived)::int AS blocking
      FROM resolved`);
    console.log("  ", verify.rows[0]);
    const nullCodes = await client.query(
      `SELECT count(*)::int AS c FROM regions WHERE code IS NULL`,
    );
    console.log(`  regions with NULL code: ${nullCodes.rows[0].c}`);
    const nullOutlets = await client.query(
      `SELECT count(*)::int AS c FROM locations WHERE outlet_code IS NULL`,
    );
    console.log(`  locations with NULL outlet_code: ${nullOutlets.rows[0].c}`);

    if ((verify.rows[0].blocking as number) > 0) {
      throw new Error("Still have blocking unresolved locations — refusing to commit");
    }
    if ((nullCodes.rows[0].c as number) > 0) {
      throw new Error("Still have regions with NULL code — refusing to commit");
    }
    if ((nullOutlets.rows[0].c as number) > 0) {
      throw new Error("Still have locations with NULL outlet_code — refusing to commit");
    }

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
