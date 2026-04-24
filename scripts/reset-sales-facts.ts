/**
 * Truncate sales-fact tables while leaving dimensions (locations, kiosks,
 * products, etc.) and auth data intact. Used when re-importing a fresh
 * NetSuite CSV over an existing dataset.
 *
 * Run: npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *        scripts/reset-sales-facts.ts
 */
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const before = await client.query(`
      SELECT
        (SELECT count(*)::int FROM sales_records) AS sales,
        (SELECT count(*)::int FROM sales_imports) AS imports,
        (SELECT count(*)::int FROM import_stagings) AS staging,
        (SELECT count(*)::int FROM commission_ledger) AS commission,
        (SELECT count(*)::int FROM sales_blob_ingestions) AS blobs`);
    console.log("Before:", before.rows[0]);

    await client.query("BEGIN");
    await client.query(
      `TRUNCATE TABLE
         sales_records,
         import_stagings,
         sales_imports,
         commission_ledger,
         sales_blob_ingestions
       RESTART IDENTITY CASCADE`,
    );
    await client.query("COMMIT");

    const after = await client.query(`
      SELECT
        (SELECT count(*)::int FROM sales_records) AS sales,
        (SELECT count(*)::int FROM sales_imports) AS imports,
        (SELECT count(*)::int FROM import_stagings) AS staging,
        (SELECT count(*)::int FROM commission_ledger) AS commission,
        (SELECT count(*)::int FROM sales_blob_ingestions) AS blobs`);
    console.log("After: ", after.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
