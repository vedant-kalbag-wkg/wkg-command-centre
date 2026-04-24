import { Pool } from "pg";
import { readFileSync } from "fs";

async function main() {
  const url = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString: url });
  try {
    const r = await pool.query(
      `SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`,
    );
    console.log(`=== drizzle.__drizzle_migrations on target (${r.rows.length} rows) ===`);
    for (const row of r.rows) {
      console.log(`  id=${row.id}  when=${row.created_at}  hash=${String(row.hash).slice(0, 20)}…`);
    }

    console.log("\n=== meta/_journal.json entries ===");
    const manifest = JSON.parse(
      readFileSync("migrations/meta/_journal.json", "utf8"),
    );
    for (const e of manifest.entries) {
      console.log(`  idx=${e.idx}  when=${e.when}  tag=${e.tag}`);
    }

    console.log("\n=== Reconciliation (tag → recorded in journal?) ===");
    const recordedHashes = new Set(r.rows.map((x) => String(x.hash)));
    const recordedWhens = new Set(r.rows.map((x) => String(x.created_at)));
    for (const e of manifest.entries) {
      const whenMatch = recordedWhens.has(String(e.when));
      console.log(`  ${e.tag.padEnd(56)} whenMatch=${whenMatch}`);
    }
  } finally {
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
