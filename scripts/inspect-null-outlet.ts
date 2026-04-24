import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString: url });
  try {
    const r1 = await pool.query(
      `SELECT count(*)::int AS c,
              count(*) FILTER (WHERE archived_at IS NULL)::int AS active,
              count(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived
       FROM locations WHERE outlet_code IS NULL`,
    );
    console.log("locations with NULL outlet_code:", r1.rows[0]);

    const r2 = await pool.query(
      `SELECT id, name, archived_at
       FROM locations WHERE outlet_code IS NULL ORDER BY name LIMIT 50`,
    );
    console.log("\nSample:");
    for (const r of r2.rows) {
      console.log(`  ${(r.archived_at ? "archived" : "active  ")}  ${r.name}`);
    }

    const r3 = await pool.query(
      `SELECT count(*)::int AS c
       FROM locations WHERE outlet_code IS NOT NULL AND archived_at IS NULL`,
    );
    console.log("\nactive locations WITH outlet_code:", r3.rows[0]);
  } finally {
    await pool.end();
  }
}
main();
