/**
 * After a failed stage+commit, this script analyzes `import_stagings` rows
 * for the latest sales_imports entry to show the distribution of validation
 * errors (which outlet codes, which products, etc.).
 */
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString: url });
  try {
    const latest = await pool.query(
      `SELECT id, filename, status, row_count, region_id
       FROM sales_imports ORDER BY uploaded_at DESC LIMIT 1`,
    );
    if (latest.rows.length === 0) {
      console.log("No sales_imports rows.");
      return;
    }
    const imp = latest.rows[0];
    console.log("Latest import:", imp);

    const counts = await pool.query(
      `SELECT status, count(*)::int FROM import_stagings
       WHERE import_id = $1 GROUP BY status`,
      [imp.id],
    );
    console.log("\nStaging status counts:");
    for (const r of counts.rows) console.log(`  ${r.status}: ${r.count}`);

    // Flatten validation errors by field+message
    const errs = await pool.query(
      `SELECT jsonb_array_elements(validation_errors) AS err
       FROM import_stagings
       WHERE import_id = $1 AND status = 'invalid'`,
      [imp.id],
    );
    const byClass = new Map<string, number>();
    for (const r of errs.rows) {
      const e = r.err as { field?: string; message?: string };
      const key = `${e.field ?? "?"} :: ${(e.message ?? "").replace(/'[^']+'/g, "'<X>'")}`;
      byClass.set(key, (byClass.get(key) ?? 0) + 1);
    }
    console.log("\nError classes (grouped by field + message template):");
    const sorted = Array.from(byClass.entries()).sort((a, b) => b[1] - a[1]);
    for (const [k, n] of sorted.slice(0, 30)) {
      console.log(`  ${String(n).padStart(5)}  ${k}`);
    }

    // Specific failing outlet codes from parsed rows
    const outlets = await pool.query(
      `SELECT (raw_row->>'outletCode') AS outlet, count(*)::int
       FROM import_stagings
       WHERE import_id = $1 AND status = 'invalid'
       GROUP BY 1 ORDER BY count(*) DESC LIMIT 30`,
      [imp.id],
    );
    console.log("\nTop failing outlet codes (from raw_row):");
    for (const r of outlets.rows) {
      console.log(`  ${String(r.outlet ?? "(null)").padEnd(12)} ${r.count}`);
    }

    // Unique outlet codes in THIS import overall
    const allCodes = await pool.query(
      `SELECT (raw_row->>'outletCode') AS outlet, count(*)::int
       FROM import_stagings
       WHERE import_id = $1
       GROUP BY 1 ORDER BY count(*) DESC`,
      [imp.id],
    );
    console.log(
      `\nUnique outlet codes in CSV: ${allCodes.rows.length} (covering ${allCodes.rows.reduce((a, r) => a + r.count, 0)} rows)`,
    );

    // Missing outlet codes — in CSV but not in locations for this region
    const missing = await pool.query(
      `SELECT DISTINCT (raw_row->>'outletCode') AS code
       FROM import_stagings
       WHERE import_id = $1
         AND (raw_row->>'outletCode') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM locations l
           WHERE l.outlet_code = (raw_row->>'outletCode')
             AND l.primary_region_id = $2
             AND l.archived_at IS NULL
         )
       ORDER BY 1`,
      [imp.id, imp.region_id],
    );
    console.log(
      `\nOutlet codes in CSV but NOT in UK region locations (active): ${missing.rows.length}`,
    );
    for (const r of missing.rows.slice(0, 50)) {
      console.log(`  ${r.code}`);
    }
    if (missing.rows.length > 50) console.log(`  ... and ${missing.rows.length - 50} more`);
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
