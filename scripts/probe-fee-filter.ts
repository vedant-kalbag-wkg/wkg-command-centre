import { Pool } from "pg";
async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  const r = await pool.query(
    `SELECT count(*)::int AS rows, sum(net_amount)::numeric(12,2) AS total
     FROM sales_records
     WHERE transaction_date >= '2026-01-01' AND transaction_date <= '2026-01-31'
       AND (is_booking_fee = true OR netsuite_code IN ('9991', '9992'))`,
  );
  console.log("direct SQL predicate:", r.rows[0]);
  const r2 = await pool.query(
    `SELECT count(*)::int AS rows, sum(net_amount)::numeric(12,2) AS total
     FROM sales_records
     WHERE transaction_date >= '2026-01-01' AND transaction_date <= '2026-01-31'
       AND is_booking_fee = true`,
  );
  console.log("old predicate (is_booking_fee only):", r2.rows[0]);
  await pool.end();
}
main();
