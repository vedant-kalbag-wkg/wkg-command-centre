/**
 * Backfill locations.location_type from deterministic signals.
 *
 * Rules (applied in order, first match wins):
 *   1. outlet_code = 'IN'     → 'online'   (Internet)
 *   2. outlet_code = 'BK'     → 'retail_desk' (Customer Service)
 *   3. name LIKE 'Hex SSM %'  → 'hex_kiosk' (Heathrow Express kiosks)
 *   4. outlet_code ~ '^[THAMUG]'
 *      AND name LIKE ANY ('Heathrow%','T% Mobile%','T% Ambassador%',
 *                         'Heathrow underground')
 *                           → 'airport'
 *   5. ALL Monday-enriched locations (those with a mondayItemId on their
 *      hotel_group or with num_rooms set) default to 'hotel' — anything
 *      that isn't clearly a transit/online touchpoint is a hotel in our
 *      data. NOTE: this pass DOES NOT re-enrich from Monday; it just reads
 *      existing columns. For the stubbed outlets created by
 *      scripts/stub-missing-outlets.ts that don't match any rule,
 *      location_type stays NULL so the admin page surfaces them.
 *
 * Run: npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *        scripts/backfill-location-type.ts [--dry-run]
 */
import { Pool } from "pg";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));
  console.log("Mode:  ", DRY_RUN ? "DRY RUN (no writes)" : "WRITE");

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("\n--- Rule 1: Online (outlet_code='IN') ---");
    const r1 = await client.query(
      `UPDATE locations SET location_type = 'online'
       WHERE location_type IS NULL AND outlet_code = 'IN'
       RETURNING outlet_code, name`,
    );
    console.log(`  ${r1.rowCount} rows`);
    for (const r of r1.rows) console.log(`    ${r.outlet_code} ${r.name}`);

    console.log("\n--- Rule 2: Retail Desk (outlet_code='BK') ---");
    const r2 = await client.query(
      `UPDATE locations SET location_type = 'retail_desk'
       WHERE location_type IS NULL AND outlet_code = 'BK'
       RETURNING outlet_code, name`,
    );
    console.log(`  ${r2.rowCount} rows`);
    for (const r of r2.rows) console.log(`    ${r.outlet_code} ${r.name}`);

    console.log("\n--- Rule 3: HEX kiosk (name ILIKE 'Hex SSM %') ---");
    const r3 = await client.query(
      `UPDATE locations SET location_type = 'hex_kiosk'
       WHERE location_type IS NULL AND name ILIKE 'Hex SSM %'
       RETURNING outlet_code, name`,
    );
    console.log(`  ${r3.rowCount} rows`);
    for (const r of r3.rows.slice(0, 20)) console.log(`    ${r.outlet_code} ${r.name}`);
    if (r3.rowCount! > 20) console.log(`    ... and ${r3.rowCount! - 20} more`);

    console.log("\n--- Rule 4: Airport (Heathrow terminals, mobile desks, ambassadors, underground) ---");
    const r4 = await client.query(
      `UPDATE locations SET location_type = 'airport'
       WHERE location_type IS NULL
         AND (
           name ILIKE 'Heathrow Terminal%' OR
           name ILIKE 'Heathrow underground%' OR
           name ILIKE 'T_ Mobile%' OR
           name ILIKE 'T_ Ambassador%'
         )
       RETURNING outlet_code, name`,
    );
    console.log(`  ${r4.rowCount} rows`);
    for (const r of r4.rows) console.log(`    ${r.outlet_code} ${r.name}`);

    console.log("\n--- Rule 5: Default hotel for Monday-enriched rows ---");
    const r5 = await client.query(
      `UPDATE locations SET location_type = 'hotel'
       WHERE location_type IS NULL
         AND (hotel_group IS NOT NULL OR num_rooms IS NOT NULL OR star_rating IS NOT NULL)
       RETURNING outlet_code, name`,
    );
    console.log(`  ${r5.rowCount} rows (set to 'hotel')`);
    for (const r of r5.rows.slice(0, 10)) console.log(`    ${r.outlet_code} ${r.name}`);
    if (r5.rowCount! > 10) console.log(`    ... and ${r5.rowCount! - 10} more`);

    console.log("\n--- Summary ---");
    const summary = await client.query(
      `SELECT COALESCE(location_type, '(NULL)') AS t, count(*)::int AS n
       FROM locations GROUP BY 1 ORDER BY n DESC`,
    );
    for (const r of summary.rows) console.log(`  ${String(r.t).padEnd(14)} ${r.n}`);

    const unmapped = await client.query(
      `SELECT outlet_code, name FROM locations
       WHERE location_type IS NULL AND archived_at IS NULL
       ORDER BY name LIMIT 30`,
    );
    console.log(`\n  Unmapped (sample up to 30 of unmapped total):`);
    for (const r of unmapped.rows) console.log(`    ${(r.outlet_code ?? "").padEnd(8)} ${r.name}`);

    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log("\n✓ Dry run — rolled back.");
    } else {
      await client.query("COMMIT");
      console.log("\n✓ Committed.");
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\n✗ Rolled back:", err);
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
