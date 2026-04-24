/**
 * Apply pending drizzle migrations against the DATABASE_URL loaded from
 * .env.neon-dev (not .env.local — drizzle-kit ignores shell overrides
 * because drizzle.config.ts hard-codes the env path).
 *
 * Run: npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json scripts/migrate-neon-dev.ts
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: "./migrations" });
    console.log("✓ Migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("✗ Migration failed:");
  console.error(err);
  process.exit(1);
});
