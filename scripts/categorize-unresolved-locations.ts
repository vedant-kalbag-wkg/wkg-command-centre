import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: url });
  try {
    const rows = await pool.query(`
      WITH resolved AS (
        SELECT
          l.id, l.name, l.outlet_code,
          l.archived_at IS NOT NULL AS is_archived,
          COALESCE(
            (SELECT r.id FROM location_region_memberships lrm
               JOIN regions r ON r.id = lrm.region_id
              WHERE lrm.location_id = l.id LIMIT 1),
            (SELECT r.id FROM kiosk_assignments ka
               JOIN kiosks k ON k.id = ka.kiosk_id
               JOIN regions r ON r.code = CASE k.region_group
                   WHEN 'UK' THEN 'UK' WHEN 'Ireland' THEN 'IE' WHEN 'Prague' THEN 'CZ'
                   WHEN 'Spain' THEN 'ES' WHEN 'Germany' THEN 'DE' ELSE NULL END
                WHERE ka.location_id = l.id LIMIT 1)
          ) AS region_id,
          -- Any kiosk assigned, regardless of region_group mapping
          (SELECT k.region_group FROM kiosk_assignments ka
             JOIN kiosks k ON k.id = ka.kiosk_id
             WHERE ka.location_id = l.id LIMIT 1) AS any_rg
        FROM locations l
      )
      SELECT
        CASE
          WHEN name LIKE 'EDIT-FIELD-%' THEN 'EDIT-FIELD-*'
          WHEN name LIKE 'CONTRACT-VIEW-%' THEN 'CONTRACT-VIEW-*'
          WHEN name LIKE 'FILE-SIZE-%' THEN 'FILE-SIZE-*'
          WHEN name LIKE 'INLINE-ADDR-%' THEN 'INLINE-ADDR-*'
          WHEN name LIKE 'INLINE-%' THEN 'INLINE-*'
          WHEN name LIKE 'OVERFLOW-%' THEN 'OVERFLOW-*'
          WHEN name LIKE 'NEW-%' OR name LIKE 'new-%' THEN 'NEW-*'
          WHEN name LIKE 'TEST-%' THEN 'TEST-*'
          WHEN outlet_code IS NULL THEN 'real-no-code'
          ELSE 'real-with-code'
        END AS bucket,
        any_rg,
        count(*)::int AS n
      FROM resolved
      WHERE region_id IS NULL AND NOT is_archived
      GROUP BY 1, 2
      ORDER BY 1, 3 DESC`);
    console.log("Unresolved active locations — categorized:");
    for (const r of rows.rows) {
      console.log(`  ${String(r.bucket).padEnd(20)} any_rg=${String(r.any_rg ?? "(none)").padEnd(12)} count=${r.n}`);
    }

    const real = await pool.query(`
      WITH resolved AS (
        SELECT
          l.id, l.name, l.outlet_code, l.hotel_group, l.region AS region_text,
          COALESCE(
            (SELECT r.id FROM location_region_memberships lrm WHERE lrm.location_id = l.id LIMIT 1),
            (SELECT r.id FROM kiosk_assignments ka
               JOIN kiosks k ON k.id = ka.kiosk_id
               JOIN regions r ON r.code = CASE k.region_group
                   WHEN 'UK' THEN 'UK' WHEN 'Ireland' THEN 'IE' WHEN 'Prague' THEN 'CZ'
                   WHEN 'Spain' THEN 'ES' WHEN 'Germany' THEN 'DE' ELSE NULL END
                WHERE ka.location_id = l.id LIMIT 1)
          ) AS region_id,
          (SELECT k.region_group FROM kiosk_assignments ka
             JOIN kiosks k ON k.id = ka.kiosk_id
             WHERE ka.location_id = l.id LIMIT 1) AS any_rg
        FROM locations l
        WHERE l.archived_at IS NULL
      )
      SELECT outlet_code, name, region_text, any_rg
      FROM resolved
      WHERE region_id IS NULL
        AND name NOT LIKE 'EDIT-FIELD-%'
        AND name NOT LIKE 'CONTRACT-VIEW-%'
        AND name NOT LIKE 'FILE-SIZE-%'
        AND name NOT LIKE 'INLINE-%'
        AND name NOT LIKE 'OVERFLOW-%'
        AND name NOT LIKE 'NEW-%'
        AND name NOT LIKE 'new-%'
        AND name NOT LIKE 'TEST-%'
      ORDER BY name`);
    console.log(`\n${real.rows.length} real-looking unresolved locations:`);
    for (const r of real.rows) {
      console.log(`  ${(r.outlet_code ?? "(no code)").padEnd(10)} any_rg=${(r.any_rg ?? "(none)").padEnd(10)} region_text=${(r.region_text ?? "(none)").padEnd(18)} ${r.name}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
