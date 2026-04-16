import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";

let container: StartedPostgreSqlContainer | null = null;

/**
 * Spin up a fresh Postgres 16 container via Testcontainers, connect a
 * node-postgres pool, wrap it in a Drizzle instance, and apply the project's
 * migrations (from `./migrations`). Returns the db, pool, and container so
 * tests can teardown cleanly.
 *
 * NOTE: module-level `container` is intentional for now — tests within a
 * single file share one container, but running multiple integration suites
 * in parallel would collide. Good enough for M1 Task 1.1.
 */
export async function setupTestDb() {
  container = await new PostgreSqlContainer("postgres:16").start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const db = drizzle(pool);
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "migrations"),
  });
  return { db, pool, container };
}

export async function teardownTestDb(pool: Pool) {
  await pool.end();
  if (container) {
    await container.stop();
    container = null;
  }
}
