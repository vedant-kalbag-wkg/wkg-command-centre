/**
 * Verification probes for two things the user called out:
 *   (1) Does is_booking_fee=true capture BOTH Booking Fee (9991) AND Cash
 *       Handling Fee (9992), or just 9991? This is what the Revenue toggle
 *       filters on, so the answer shapes whether we need to widen the predicate.
 *   (2) Is outlet-code → location resolution region-scoped? i.e. if the same
 *       outlet_code exists in two regions, sales ingested under region A must
 *       only associate with the region-A location, never region B.
 */
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString: url });
  try {
    console.log("=== 1. Fee-flag coverage ===");
    const feeRows = await pool.query(
      `SELECT netsuite_code, is_booking_fee, count(*)::int AS rows,
              sum(net_amount)::numeric(12,2) AS total
       FROM sales_records
       WHERE netsuite_code IN ('9991', '9992')
       GROUP BY 1, 2 ORDER BY 1, 2`,
    );
    for (const r of feeRows.rows) {
      console.log(
        `  code=${r.netsuite_code}  is_booking_fee=${r.is_booking_fee}  rows=${r.rows}  total=£${r.total}`,
      );
    }
    const byFlag = await pool.query(
      `SELECT is_booking_fee, count(*)::int AS rows,
              sum(net_amount)::numeric(12,2) AS total
       FROM sales_records GROUP BY 1`,
    );
    console.log("\n  All rows by is_booking_fee:");
    for (const r of byFlag.rows) {
      console.log(`    is_booking_fee=${r.is_booking_fee}  rows=${r.rows}  total=£${r.total}`);
    }

    console.log("\n=== 2. Repeated outlet codes across regions ===");
    const dupes = await pool.query(
      `SELECT outlet_code, count(DISTINCT primary_region_id)::int AS region_count,
              count(*)::int AS rows
       FROM locations
       WHERE outlet_code IS NOT NULL
       GROUP BY outlet_code
       HAVING count(DISTINCT primary_region_id) > 1
       ORDER BY region_count DESC, rows DESC
       LIMIT 20`,
    );
    if (dupes.rows.length === 0) {
      console.log("  No outlet codes are currently in multiple regions in this DB.");
    } else {
      console.log(`  Found ${dupes.rows.length} outlet_codes that exist in multiple regions:`);
      for (const r of dupes.rows) {
        console.log(`    ${r.outlet_code}: ${r.region_count} regions, ${r.rows} rows`);
      }
    }

    console.log("\n=== 3. Sales_records region scoping sanity ===");
    // For every sales_record, its location's region_id must equal the
    // sales_record's own region_id. If any row violates that, scoping is broken.
    const violations = await pool.query(
      `SELECT count(*)::int AS n
       FROM sales_records sr
       JOIN locations l ON l.id = sr.location_id
       WHERE sr.region_id IS NOT NULL
         AND l.primary_region_id IS NOT NULL
         AND sr.region_id <> l.primary_region_id`,
    );
    console.log(`  region_id mismatches sales_records <-> locations: ${violations.rows[0].n}  (expect 0)`);

    const byRegion = await pool.query(
      `SELECT r.code, count(sr.id)::int AS txns,
              sum(sr.net_amount)::numeric(14,2) AS net
       FROM sales_records sr
       JOIN regions r ON r.id = sr.region_id
       GROUP BY r.code ORDER BY txns DESC`,
    );
    console.log("\n  Sales by region:");
    for (const r of byRegion.rows) {
      console.log(`    ${r.code.padEnd(4)} txns=${String(r.txns).padStart(7)}  net=£${r.net}`);
    }

    console.log("\n=== 4. Synthetic cross-region dup-outlet test ===");
    // Pick a UK outlet code that exists today. Create a stub location in
    // Germany with the same outlet_code. Verify the existing UK sales_records
    // still point to the UK location, not the new DE stub.
    const pick = await pool.query(
      `SELECT l.id AS uk_loc_id, l.outlet_code, l.primary_region_id AS uk_region
       FROM locations l
       JOIN regions r ON r.id = l.primary_region_id
       WHERE r.code = 'UK' AND l.outlet_code IS NOT NULL AND l.archived_at IS NULL
       AND EXISTS (SELECT 1 FROM sales_records sr WHERE sr.location_id = l.id)
       LIMIT 1`,
    );
    if (pick.rows.length === 0) {
      console.log("  No UK outlet with sales available — skipping synthetic test.");
      return;
    }
    const { uk_loc_id, outlet_code, uk_region } = pick.rows[0];
    const deRegion = await pool.query(`SELECT id FROM regions WHERE code = 'DE'`);
    const de_region = deRegion.rows[0].id;
    console.log(`  Chose outlet_code=${outlet_code}  uk_loc_id=${uk_loc_id}`);

    await pool.query("BEGIN");
    try {
      const createResult = await pool.query(
        `INSERT INTO locations (name, outlet_code, primary_region_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (primary_region_id, outlet_code) DO NOTHING
         RETURNING id`,
        [`SYNTH-DE-${outlet_code}`, outlet_code, de_region],
      );
      const de_loc_id =
        createResult.rows[0]?.id ??
        (await pool.query(
          `SELECT id FROM locations WHERE outlet_code=$1 AND primary_region_id=$2`,
          [outlet_code, de_region],
        )).rows[0].id;
      console.log(`  Created/found DE stub location id=${de_loc_id}`);

      // Verify the UK sales_records still point to uk_loc_id, not de_loc_id.
      const byLoc = await pool.query(
        `SELECT location_id, count(*)::int AS n FROM sales_records
         WHERE location_id IN ($1, $2) AND region_id = $3
         GROUP BY location_id`,
        [uk_loc_id, de_loc_id, uk_region],
      );
      for (const r of byLoc.rows) {
        const label = r.location_id === uk_loc_id ? "UK" : "DE";
        console.log(`    UK-region sales_records linked to ${label} location ${r.location_id}: ${r.n}`);
      }

      // And simulate "what would happen if DE CSV came in with the same code":
      // the dimension resolver would pick de_loc_id (scoped to DE region), NOT
      // uk_loc_id. We can't run the full resolver here without the CSV, so we
      // just assert locations.query respects the scope.
      const resolvedForDe = await pool.query(
        `SELECT id FROM locations WHERE outlet_code=$1 AND primary_region_id=$2`,
        [outlet_code, de_region],
      );
      const resolvedForUk = await pool.query(
        `SELECT id FROM locations WHERE outlet_code=$1 AND primary_region_id=$2`,
        [outlet_code, uk_region],
      );
      console.log(
        `  Scope lookup: outlet=${outlet_code} in DE -> ${resolvedForDe.rows[0]?.id ?? "MISS"}`,
      );
      console.log(
        `  Scope lookup: outlet=${outlet_code} in UK -> ${resolvedForUk.rows[0]?.id ?? "MISS"}`,
      );

      await pool.query("ROLLBACK");
      console.log("  (synthetic DE stub rolled back)");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
