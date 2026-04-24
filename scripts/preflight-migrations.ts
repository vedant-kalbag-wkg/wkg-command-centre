/**
 * Preflight for migrations 0018–0023 on the configured DATABASE_URL.
 *
 * The critical gate is in migration 0022 (the NetSuite restructure): it
 * refuses to apply if any non-archived location cannot be mapped to a
 * region via either:
 *   (a) location_region_memberships, OR
 *   (b) kiosk_assignments → kiosks.region_group mapped to regions.code
 *       (UK→UK, Ireland→IE, Prague→CZ, Spain→ES, Germany→DE).
 *
 * This script runs the same resolution as the migration's temp table,
 * but read-only, and reports unresolved locations so we can fix them
 * before running migrate.
 *
 * Also reports: migration journal state, region codes, and kiosk
 * region_group distribution.
 */
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));

  const pool = new Pool({ connectionString: url });
  try {
    console.log("\n=== Migration journal ===");
    const journal = await pool.query(
      `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`,
    );
    console.log(`  ${journal.rows.length} migrations recorded`);
    for (const r of journal.rows) {
      const ts = typeof r.created_at === "bigint" || typeof r.created_at === "number"
        ? new Date(Number(r.created_at)).toISOString()
        : String(r.created_at);
      console.log(`  id=${r.id}  hash=${String(r.hash).slice(0, 12)}…  ${ts}`);
    }

    console.log("\n=== Regions + codes ===");
    const regions = await pool.query(
      `SELECT id, name, code FROM regions ORDER BY name`,
    );
    for (const r of regions.rows) {
      console.log(`  ${(r.name as string).padEnd(20)} code=${r.code ?? "(null)"}  id=${r.id}`);
    }

    console.log("\n=== Kiosks by region_group ===");
    const kioskByRg = await pool.query(
      `SELECT coalesce(region_group, '(null)') AS rg, count(*)::int AS c
       FROM kiosks GROUP BY region_group ORDER BY count(*) DESC`,
    );
    for (const r of kioskByRg.rows) {
      console.log(`  ${(r.rg as string).padEnd(20)} ${r.c}`);
    }

    console.log("\n=== Location totals ===");
    const locTotals = await pool.query(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
         count(*) FILTER (WHERE archived_at IS NULL)::int AS active
       FROM locations`,
    );
    console.log("  ", locTotals.rows[0]);

    console.log("\n=== Safety gate simulation (mirror of 0022 temp table) ===");
    const gate = await pool.query(`
      WITH resolved AS (
        SELECT
          l.id,
          l.name,
          l.outlet_code,
          l.archived_at IS NOT NULL AS is_archived,
          COALESCE(
            (SELECT r.id FROM location_region_memberships lrm
               JOIN regions r ON r.id = lrm.region_id
              WHERE lrm.location_id = l.id LIMIT 1),
            (SELECT r.id FROM kiosk_assignments ka
               JOIN kiosks k ON k.id = ka.kiosk_id
               JOIN regions r ON r.code = CASE k.region_group
                   WHEN 'UK'      THEN 'UK'
                   WHEN 'Ireland' THEN 'IE'
                   WHEN 'Prague'  THEN 'CZ'
                   WHEN 'Spain'   THEN 'ES'
                   WHEN 'Germany' THEN 'DE'
                   ELSE NULL END
              WHERE ka.location_id = l.id LIMIT 1),
            CASE WHEN l.archived_at IS NOT NULL
                 THEN (SELECT id FROM regions WHERE code = 'UK')
                 ELSE NULL END
          ) AS region_id
        FROM locations l
      )
      SELECT
        count(*) FILTER (WHERE region_id IS NOT NULL)::int AS resolved,
        count(*) FILTER (WHERE region_id IS NULL AND is_archived)::int AS unresolved_archived,
        count(*) FILTER (WHERE region_id IS NULL AND NOT is_archived)::int AS unresolved_active
      FROM resolved`);
    console.log("  ", gate.rows[0]);

    if ((gate.rows[0].unresolved_active as number) > 0) {
      console.log("\n=== UNRESOLVED ACTIVE LOCATIONS (block migration 0022) ===");
      const un = await pool.query(`
        WITH resolved AS (
          SELECT
            l.id, l.name, l.outlet_code, l.archived_at IS NOT NULL AS is_archived,
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
                   THEN (SELECT id FROM regions WHERE code = 'UK') ELSE NULL END
            ) AS region_id
          FROM locations l
        )
        SELECT id, name, outlet_code
        FROM resolved
        WHERE region_id IS NULL AND NOT is_archived
        ORDER BY name`);
      for (const r of un.rows.slice(0, 30)) {
        console.log(`  ${(r.outlet_code ?? "(no code)").padEnd(10)} ${r.name}  (${r.id})`);
      }
      if (un.rows.length > 30) {
        console.log(`  ... and ${un.rows.length - 30} more`);
      }
    }

    console.log("\n=== Old sales_records schema check ===");
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='sales_records' ORDER BY ordinal_position`,
    );
    console.log(
      "  sales_records columns:",
      cols.rows.map((c) => c.column_name).join(", "),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
