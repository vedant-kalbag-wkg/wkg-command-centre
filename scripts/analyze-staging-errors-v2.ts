import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const latest = await pool.query(
    `SELECT id, region_id FROM sales_imports ORDER BY uploaded_at DESC LIMIT 1`,
  );
  const { id: importId, region_id: regionId } = latest.rows[0];

  console.log("=== Failing outlet codes (from raw_row['Outlet Code']) ===");
  const failing = await pool.query(
    `SELECT (raw_row->>'Outlet Code') AS outlet, count(*)::int
     FROM import_stagings WHERE import_id = $1 AND status = 'invalid'
     GROUP BY 1 ORDER BY count(*) DESC LIMIT 40`,
    [importId],
  );
  for (const r of failing.rows) {
    console.log(`  ${String(r.outlet ?? "(null)").padEnd(12)} ${r.count}`);
  }
  const total = failing.rows.reduce((a, r) => a + r.count, 0);
  console.log(`  (showing top ${failing.rows.length}, total shown = ${total})`);

  console.log("\n=== Which failing outlet codes ARE in UK-region locations ===");
  const inUK = await pool.query(
    `SELECT DISTINCT (raw_row->>'Outlet Code') AS code FROM import_stagings
     WHERE import_id = $1 AND status = 'invalid'
     AND EXISTS (
       SELECT 1 FROM locations l
       WHERE l.outlet_code = (raw_row->>'Outlet Code')
         AND l.primary_region_id = $2
     )
     ORDER BY 1`,
    [importId, regionId],
  );
  console.log(`  ${inUK.rows.length} failing codes actually have a UK location:`, inUK.rows.map((r) => r.code));

  console.log("\n=== Which failing outlet codes are MISSING from UK active locations ===");
  const missing = await pool.query(
    `SELECT (raw_row->>'Outlet Code') AS code, count(*)::int AS n
     FROM import_stagings
     WHERE import_id = $1 AND status = 'invalid'
       AND NOT EXISTS (
         SELECT 1 FROM locations l
         WHERE l.outlet_code = (raw_row->>'Outlet Code')
           AND l.primary_region_id = $2
           AND l.archived_at IS NULL
       )
     GROUP BY 1 ORDER BY n DESC`,
    [importId, regionId],
  );
  console.log(`  ${missing.rows.length} distinct missing codes:`);
  for (const r of missing.rows.slice(0, 50)) {
    console.log(`    ${String(r.code ?? "(null)").padEnd(12)} ${r.n} rows`);
  }

  console.log("\n=== Same codes — are they in locations for OTHER region / archived? ===");
  for (const r of missing.rows.slice(0, 10)) {
    const code = r.code;
    const hits = await pool.query(
      `SELECT outlet_code, name, primary_region_id, archived_at FROM locations WHERE outlet_code = $1`,
      [code],
    );
    console.log(`  ${code}:`);
    for (const h of hits.rows) {
      console.log(`    name="${h.name}" region=${h.primary_region_id}  archived=${h.archived_at ?? "no"}`);
    }
    if (hits.rows.length === 0) console.log("    (no location with this outlet_code in any region)");
  }

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
