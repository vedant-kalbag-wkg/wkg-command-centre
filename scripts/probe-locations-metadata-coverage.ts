/**
 * READ-ONLY probe: report NULL-coverage on every `locations` column that
 * Monday could populate. Used to quantify the metadata gap before the
 * Phase-7-06-follow-up importer fix lands.
 *
 *   DATABASE_URL=... npx tsx --tsconfig tsconfig.json scripts/probe-locations-metadata-coverage.ts
 */
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: url });

  const fields = [
    "address",
    "latitude",
    "longitude",
    "star_rating",
    "room_count",
    "key_contacts",
    "hotel_group",
    "operating_group_id",
    "sourced_by",
    "maintenance_fee",
    "free_trial_end_date",
    "hardware_assets",
    "notes",
    "location_group",
    "internal_poc_id",
    "status",
    "location_type",
    "kiosk_config_group_id",
    "custom_fields",
    "num_rooms",
    "hotel_address",
    "live_date",
    "launch_phase",
    "key_contact_name",
    "key_contact_email",
    "finance_contact",
    "iana_timezone",
    "customer_code",
    "monday_item_id",
  ];

  const selects = fields
    .map((f) => `count(*) FILTER (WHERE ${f} IS NOT NULL) AS "${f}_set"`)
    .join(",\n  ");

  const sql = `SELECT
  count(*) AS active_total,
  count(*) FILTER (WHERE monday_item_id IS NOT NULL) AS monday_sourced,
  ${selects}
FROM locations
WHERE archived_at IS NULL`;

  const r = await pool.query(sql);
  const row = r.rows[0];
  const total = Number(row.active_total);
  const mondaySourced = Number(row.monday_sourced);
  console.log(`active locations:       ${total}`);
  console.log(`with monday_item_id:    ${mondaySourced}`);
  console.log("");
  console.log("field".padEnd(28) + "rows_set".padStart(10) + "pct".padStart(8));
  console.log("-".repeat(46));
  for (const f of fields) {
    const n = Number(row[`${f}_set`]);
    const pct = total === 0 ? "0.0" : ((n / total) * 100).toFixed(1);
    console.log(f.padEnd(28) + String(n).padStart(10) + (pct + "%").padStart(8));
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
