import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const r = await pool.query(`SELECT id, email, name, role, user_type, email_verified FROM "user" ORDER BY email`);
  for (const row of r.rows) {
    console.log(`  ${String(row.email).padEnd(40)} role=${row.role}  type=${row.user_type}  verified=${row.email_verified}  id=${row.id}`);
  }
  await pool.end();
}
main();
