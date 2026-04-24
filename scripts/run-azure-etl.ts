/**
 * CLI entry point for the Azure ETL.
 *
 * Builds a standalone node-postgres pool (instead of reusing the app's
 * shared `postgres-js` client from `@/db`) so the script can open and
 * explicitly close its own connection — keeping the process lifecycle
 * self-contained and predictable.
 *
 * Exit codes:
 *   0 — ok, no failed blobs
 *   1 — ok, but at least one blob failed to ingest (or fatal error)
 *   2 — skipped because the advisory lock was already held
 *
 * Run: npm run etl:azure
 * Prereqs: .env.local has DATABASE_URL, AZURE_STORAGE_CONNECTION_STRING
 *   (or AZURE_STORAGE_ACCOUNT_URL), and any configured region rows have
 *   `regions.azureCode` set.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runAzureEtl } from "@/lib/sales/etl/azure-etl";
import * as schema from "@/db/schema";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });
  try {
    const result = await runAzureEtl(db);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "ok" && result.failed.length > 0) process.exit(1);
    if (result.status === "skipped-lock") process.exit(2);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
