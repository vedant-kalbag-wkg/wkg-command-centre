/**
 * One-shot cleanup for Tier 1 DB bloat (see Phase 8 ops note 2026-05-04).
 *
 * Reclaims storage by:
 *   1. Deleting `import_stagings` rows whose parent `sales_imports` is in a
 *      terminal status (committed / failed / rolled_back) AND was uploaded
 *      more than 1 day ago. These rows hold raw_row + parsed_row JSONB
 *      payloads that are never read after commit; pipeline.ts only flips
 *      their status to 'committed' instead of deleting (see _commitImportForActor).
 *   2. Truncating `weather_cache`. Cache layer in src/lib/weather/open-meteo.ts
 *      transparently re-fetches on miss, so all rows are regenerable.
 *
 * Then runs VACUUM ANALYZE on both tables so the freed pages are reported back
 * to Postgres / Neon (without VACUUM, the `pg_total_relation_size` figure
 * doesn't drop and Neon billing won't reflect the cleanup).
 *
 * Default mode is DRY-RUN — prints the deletion counts and current table
 * sizes, makes no changes. Pass `--apply` to actually delete.
 *
 * Usage:
 *   # dry-run against whichever DATABASE_URL is set
 *   DATABASE_URL='<url>' npx tsx scripts/prune-tier1-bloat.ts
 *
 *   # apply (destructive)
 *   DATABASE_URL='<prod-url-from-vercel-env>' \
 *     npx tsx scripts/prune-tier1-bloat.ts --apply
 */
import { Pool } from "pg";

const RETENTION_DAYS = 1;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const apply = process.argv.includes("--apply");

  console.log("Target:", url.replace(/:[^:@/]+@/, ":***@"));
  console.log("Mode:  ", apply ? "APPLY (destructive)" : "DRY-RUN");
  console.log("Retention: import_stagings rows pruned when parent import is terminal AND > %d day(s) old", RETENTION_DAYS);
  console.log();

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const sizes = async (label: string) => {
      const r = await client.query<{
        total_db: string;
        import_stagings: string;
        weather_cache: string;
        sales_imports: string;
        sales_records: string;
      }>(`
        SELECT
          pg_size_pretty(pg_database_size(current_database())) AS total_db,
          pg_size_pretty(pg_total_relation_size('import_stagings')) AS import_stagings,
          pg_size_pretty(pg_total_relation_size('weather_cache')) AS weather_cache,
          pg_size_pretty(pg_total_relation_size('sales_imports')) AS sales_imports,
          pg_size_pretty(pg_total_relation_size('sales_records')) AS sales_records
      `);
      console.log("--- sizes (%s) ---", label);
      console.table(r.rows[0]);
    };

    const counts = async (label: string) => {
      const r = await client.query<{
        staging_total: number;
        staging_terminal_old: number;
        weather_total: number;
      }>(
        `
        SELECT
          (SELECT count(*)::int FROM import_stagings) AS staging_total,
          (SELECT count(*)::int
             FROM import_stagings s
             JOIN sales_imports i ON i.id = s.import_id
            WHERE i.status IN ('committed', 'failed', 'rolled_back')
              AND i.uploaded_at < now() - ($1::int || ' days')::interval) AS staging_terminal_old,
          (SELECT count(*)::int FROM weather_cache) AS weather_total
        `,
        [RETENTION_DAYS],
      );
      console.log("--- counts (%s) ---", label);
      console.table(r.rows[0]);
    };

    await sizes("before");
    await counts("before");

    if (!apply) {
      console.log("\nDRY-RUN — no changes made. Re-run with --apply to delete.");
      return;
    }

    console.log("\nApplying...");

    await client.query("BEGIN");
    const delStagings = await client.query(
      `
      DELETE FROM import_stagings
       WHERE import_id IN (
         SELECT id FROM sales_imports
          WHERE status IN ('committed', 'failed', 'rolled_back')
            AND uploaded_at < now() - ($1::int || ' days')::interval
       )
      `,
      [RETENTION_DAYS],
    );
    const delWeather = await client.query(`DELETE FROM weather_cache`);
    await client.query("COMMIT");

    console.log("Deleted import_stagings rows:", delStagings.rowCount);
    console.log("Deleted weather_cache  rows:", delWeather.rowCount);

    // VACUUM cannot run inside a transaction; release the implicit one.
    console.log("\nRunning VACUUM ANALYZE (this may take a minute)...");
    await client.query(`VACUUM (ANALYZE) import_stagings`);
    await client.query(`VACUUM (ANALYZE) weather_cache`);

    await sizes("after");
    await counts("after");
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
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
