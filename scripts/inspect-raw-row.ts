import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const r = await pool.query(
    `SELECT row_number, raw_row, validation_errors
     FROM import_stagings WHERE status='invalid' ORDER BY row_number LIMIT 3`,
  );
  for (const row of r.rows) {
    console.log(`row_number=${row.row_number}`);
    console.log("  raw_row keys:", Object.keys(row.raw_row));
    console.log("  raw_row:", JSON.stringify(row.raw_row).slice(0, 400));
    console.log("  validation_errors:", JSON.stringify(row.validation_errors));
    console.log("---");
  }
  await pool.end();
}
main();
