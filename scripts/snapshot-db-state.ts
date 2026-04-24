/**
 * Snapshot current state of the configured DATABASE_URL.
 *
 * Read-only. Reports row counts for every table we care about so we can
 * (a) confirm which DB we're pointing at and (b) verify retain/clear scope
 * before running destructive operations.
 *
 * Run: npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json scripts/snapshot-db-state.ts
 */
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const masked = url.replace(/:[^:@]+@/, ":***@");
  console.log("Target:", masked);

  const pool = new Pool({ connectionString: url });
  try {
    const tables = [
      // Monday-owned (retain)
      "kiosks",
      "kiosk_assignments",
      "locations",
      "hotel_groups",
      "regions",
      "location_groups",
      "kiosk_config_groups",
      "location_hotel_group_memberships",
      "location_region_memberships",
      "location_group_memberships",
      "products",
      "providers",
      "location_products",
      // Sales facts (clear)
      "sales_records",
      "sales_imports",
      "import_stagings",
      "commission_ledger",
      "sales_blob_ingestions",
      // Auth + misc (keep)
      '"user"',
      "session",
      "user_scopes",
      "audit_logs",
      "markets",
      "pipeline_stages",
      "event_categories",
      "installations",
      "product_code_fallbacks",
    ];

    console.log("\n=== Row counts ===");
    for (const t of tables) {
      try {
        const r = await pool.query(`SELECT count(*)::int AS c FROM ${t}`);
        console.log(`  ${t.padEnd(38)} ${r.rows[0].c}`);
      } catch (e) {
        console.log(`  ${t.padEnd(38)} ERROR: ${(e as Error).message}`);
      }
    }

    console.log("\n=== Regions (for ETL region resolution) ===");
    const regionsRes = await pool.query(
      `SELECT id, code, name, azure_code FROM regions ORDER BY code`,
    );
    for (const r of regionsRes.rows) {
      console.log(
        `  ${(r.code as string).padEnd(6)} ${(r.name as string).padEnd(30)} azureCode=${r.azure_code ?? "(null)"}  id=${r.id}`,
      );
    }

    console.log("\n=== Product code fallbacks ===");
    const fbRes = await pool.query(
      `SELECT product_name, netsuite_code FROM product_code_fallbacks ORDER BY product_name`,
    );
    for (const r of fbRes.rows) {
      console.log(`  ${(r.product_name as string).padEnd(30)} -> ${r.netsuite_code}`);
    }

    console.log("\n=== ETL actor user present? ===");
    const actorRes = await pool.query(
      `SELECT id, email, name FROM "user" WHERE id = '00000000-0000-0000-0000-000000000001'`,
    );
    if (actorRes.rows.length > 0) {
      console.log(`  yes: ${JSON.stringify(actorRes.rows[0])}`);
    } else {
      console.log(`  MISSING — migration 0018 should have seeded this`);
    }

    console.log("\n=== Locations with primaryRegionId set vs not ===");
    const locRes = await pool.query(
      `SELECT
         count(*) FILTER (WHERE primary_region_id IS NOT NULL)::int AS with_region,
         count(*) FILTER (WHERE primary_region_id IS NULL)::int AS without_region,
         count(*) FILTER (WHERE outlet_code IS NOT NULL)::int AS with_outlet_code
       FROM locations`,
    );
    console.log("  ", locRes.rows[0]);

    console.log("\n=== Locations by region (for ingest coverage) ===");
    const locByRegion = await pool.query(
      `SELECT r.code, r.name, count(l.id)::int AS locations
       FROM regions r
       LEFT JOIN locations l ON l.primary_region_id = r.id
       GROUP BY r.id, r.code, r.name
       ORDER BY locations DESC`,
    );
    for (const r of locByRegion.rows) {
      console.log(`  ${(r.code as string).padEnd(6)} ${(r.name as string).padEnd(30)} ${r.locations} locations`);
    }

    console.log("\n=== Latest sales_imports (up to 5) ===");
    const impRes = await pool.query(
      `SELECT id, filename, status, row_count, created_at
       FROM sales_imports
       ORDER BY created_at DESC
       LIMIT 5`,
    );
    for (const r of impRes.rows) {
      console.log(`  ${r.created_at.toISOString()}  ${r.status.padEnd(10)}  rows=${r.row_count}  ${r.filename}`);
    }

    console.log("\n=== Latest sales_blob_ingestions (up to 5) ===");
    const blobRes = await pool.query(
      `SELECT region_id, blob_path, status, processed_at
       FROM sales_blob_ingestions
       ORDER BY processed_at DESC NULLS LAST
       LIMIT 5`,
    );
    for (const r of blobRes.rows) {
      console.log(`  ${r.processed_at?.toISOString() ?? "(null)"}  ${r.status.padEnd(10)}  ${r.blob_path}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
