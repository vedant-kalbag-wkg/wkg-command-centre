/**
 * Manually apply migrations 0022 and 0023 to Neon dev.
 *
 * Drizzle's migrator has a bug when _journal.json's `when` timestamps are
 * non-monotonic (as happened after the merge that renumbered 0018->0022,
 * 0019->0023). It compares each migration's `folderMillis` against the
 * max `created_at` in the journal and skips if older — so 0022 (folderMillis
 * 1777005374407) gets skipped because 0021 is already at 1777336800002.
 *
 * We mimic drizzle's own apply loop (pg-core/dialect.cjs#migrate):
 *   1. Read each file, split by `--> statement-breakpoint`.
 *   2. Execute statements inside a single transaction (migration 0022 uses
 *      a TEMP TABLE ON COMMIT DROP; must be one txn).
 *   3. Insert into drizzle.__drizzle_migrations with hash=sha256(file),
 *      created_at=when (so subsequent drizzle-kit migrate calls skip it).
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { Pool } from "pg";

const MANIFEST_PATH = "migrations/meta/_journal.json";
const MIGRATIONS = [
  "0022_restructure_salesrecords_region_scoped",
  "0023_sales_imports_region_id",
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  const whenByTag = new Map<string, number>(
    manifest.entries.map((e: { tag: string; when: number }) => [e.tag, e.when]),
  );

  const pool = new Pool({ connectionString: url });
  try {
    for (const tag of MIGRATIONS) {
      const sqlPath = `migrations/${tag}.sql`;
      const content = readFileSync(sqlPath, "utf8");
      const hash = createHash("sha256").update(content).digest("hex");
      const when = whenByTag.get(tag);
      if (when === undefined) throw new Error(`No manifest entry for ${tag}`);

      // Skip if already recorded (idempotent re-runs)
      const client0 = await pool.connect();
      const existing = await client0.query(
        `SELECT id FROM drizzle.__drizzle_migrations WHERE hash = $1`,
        [hash],
      );
      client0.release();
      if (existing.rows.length > 0) {
        console.log(`  [skip] ${tag} — already in journal (id=${existing.rows[0].id})`);
        continue;
      }

      const statements = content
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      console.log(`\n=== Applying ${tag} (${statements.length} statements) ===`);

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let i = 0; i < statements.length; i++) {
          const stmt = statements[i];
          const preview = stmt.replace(/\s+/g, " ").slice(0, 80);
          console.log(`  [${i + 1}/${statements.length}] ${preview}…`);
          await client.query(stmt);
        }
        await client.query(
          `INSERT INTO drizzle.__drizzle_migrations ("hash", "created_at") VALUES ($1, $2)`,
          [hash, when],
        );
        await client.query("COMMIT");
        console.log(`  ✓ ${tag} committed (hash=${hash.slice(0, 12)}…, when=${when})`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  ✗ ${tag} rolled back:`, err);
        throw err;
      } finally {
        client.release();
      }
    }
    console.log("\nAll done.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
