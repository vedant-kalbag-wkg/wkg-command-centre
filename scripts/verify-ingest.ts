/**
 * Verify the latest sales_imports ingest matches expected shape.
 * Mirrors the assertions in tests/etl/azure-etl-full.integration.test.ts.
 */
import { Pool } from "pg";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
  try {
    console.log("=== Row counts ===");
    const tables = [
      "sales_records",
      "sales_imports",
      "import_stagings",
      "commission_ledger",
      "sales_blob_ingestions",
    ];
    for (const t of tables) {
      const r = await pool.query(`SELECT count(*)::int AS c FROM ${t}`);
      console.log(`  ${t.padEnd(28)} ${r.rows[0].c}`);
    }

    console.log("\n=== sales_records by netsuite_code (top 15) ===");
    const byCode = await pool.query(
      `SELECT netsuite_code, count(*)::int AS c,
              sum(net_amount)::numeric(12,2) AS net_sum
       FROM sales_records GROUP BY 1 ORDER BY c DESC LIMIT 15`,
    );
    for (const r of byCode.rows) {
      console.log(`  ${String(r.netsuite_code).padEnd(10)} ${String(r.c).padStart(6)}  netAmt=${r.net_sum}`);
    }

    console.log("\n=== Booking-fee & fee-class checks ===");
    const bf = await pool.query(
      `SELECT count(*)::int AS c FROM sales_records
       WHERE is_booking_fee = true AND netsuite_code = '9991'`,
    );
    console.log(`  is_booking_fee=true AND netsuite_code=9991: ${bf.rows[0].c}  (expect 1273)`);
    const ch = await pool.query(
      `SELECT count(*)::int AS c FROM sales_records
       WHERE netsuite_code = '9992'`,
    );
    console.log(`  netsuite_code=9992 (Cash Handling): ${ch.rows[0].c}  (expect 38)`);

    console.log("\n=== Reversal pair sanity (ref_no='2XA4558609' expected to net to 0) ===");
    const rev = await pool.query(
      `SELECT count(*)::int AS rows, sum(net_amount)::numeric(12,2) AS total
       FROM sales_records WHERE ref_no = '2XA4558609'`,
    );
    console.log(`  rows=${rev.rows[0].rows}  total=${rev.rows[0].total}  (expect 2 rows, total=0.00)`);

    console.log("\n=== Commission ledger ===");
    const com = await pool.query(
      `SELECT count(*)::int AS c, sum(commission_amount)::numeric(12,2) AS total
       FROM commission_ledger`,
    );
    console.log(`  rows=${com.rows[0].c}  sum=${com.rows[0].total}`);

    console.log("\n=== Top 5 outlets by net revenue ===");
    const topOutlets = await pool.query(
      `SELECT l.outlet_code, l.name, count(sr.id)::int AS txns,
              sum(sr.net_amount)::numeric(12,2) AS net_revenue
       FROM sales_records sr
       JOIN locations l ON l.id = sr.location_id
       GROUP BY l.id, l.outlet_code, l.name
       ORDER BY net_revenue DESC LIMIT 5`,
    );
    for (const r of topOutlets.rows) {
      console.log(`  ${r.outlet_code.padEnd(6)} ${String(r.name).padEnd(45).slice(0, 45)} txns=${String(r.txns).padStart(4)}  net=£${r.net_revenue}`);
    }

    console.log("\n=== Sales by transaction_date ===");
    const byDate = await pool.query(
      `SELECT transaction_date::text, count(*)::int AS c,
              sum(net_amount)::numeric(12,2) AS total
       FROM sales_records GROUP BY 1 ORDER BY 1`,
    );
    for (const r of byDate.rows) {
      console.log(`  ${r.transaction_date}  rows=${r.c}  net=£${r.total}`);
    }

    console.log("\n=== sales_imports ===");
    const imp = await pool.query(
      `SELECT id, filename, status, row_count, region_id
       FROM sales_imports ORDER BY uploaded_at DESC LIMIT 3`,
    );
    for (const r of imp.rows) {
      console.log(`  ${r.id}  ${r.filename}  status=${r.status}  rows=${r.row_count}`);
    }
  } finally {
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
