import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";

/**
 * Integration test template:
 *   let ctx: Awaited<ReturnType<typeof setupTestDb>>;
 *   beforeAll(async () => { ctx = await setupTestDb(); }, 120_000);
 *   afterAll(async () => { if (ctx) await teardownTestDb(ctx); });
 */

export type TestDbContext = {
  db: ReturnType<typeof drizzle>;
  pool: Pool;
  container: StartedPostgreSqlContainer;
};

/**
 * Spin up a fresh Postgres 16 container via Testcontainers, connect a
 * node-postgres pool, wrap it in a Drizzle instance, and apply the project's
 * migrations (from `./migrations`). Returns the db, pool, and container so
 * tests can teardown cleanly.
 *
 * If migration (or pool construction) fails, the container is stopped and the
 * pool is ended before the error propagates — no orphaned resources.
 */
export async function setupTestDb(): Promise<TestDbContext> {
  const container = await new PostgreSqlContainer("postgres:16").start();
  try {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    try {
      const db = drizzle(pool);
      await migrate(db, {
        migrationsFolder: path.join(process.cwd(), "migrations"),
      });
      return { db, pool, container };
    } catch (err) {
      await pool.end();
      throw err;
    }
  } catch (err) {
    await container.stop();
    throw err;
  }
}

export async function teardownTestDb(ctx: TestDbContext) {
  await ctx.pool.end();
  await ctx.container.stop();
}
