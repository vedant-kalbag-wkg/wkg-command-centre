import { Pool } from "pg";
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const r = await pool.query(
    `SELECT count(*)::int AS rows, sum(net_amount)::numeric(12,2) AS total
     FROM sales_records
     WHERE transaction_date >= '2026-01-01' AND transaction_date <= '2026-01-31'
       AND is_weknow_fee = true`,
  );
  console.log("is_weknow_fee predicate:", r.rows[0]);
  const r2 = await pool.query(
    `SELECT count(*)::int AS rows, sum(net_amount)::numeric(12,2) AS total
     FROM sales_records
     WHERE transaction_date >= '2026-01-01' AND transaction_date <= '2026-01-31'
       AND netsuite_code IN ('9991', '9992')`,
  );
  console.log("netsuite_code IN (9991,9992) predicate:", r2.rows[0]);
  await pool.end();
}
main();
