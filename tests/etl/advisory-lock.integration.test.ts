import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";
import {
  ETL_AZURE_LOCK_KEY,
  withAdvisoryLock,
} from "@/lib/sales/etl/advisory-lock";

/**
 * Integration tests for the Postgres advisory-lock helper.
 *
 * Advisory locks are SESSION-scoped — two simultaneous holders must come from
 * different sessions. The test container exposes a single URI; we spin up a
 * *second* Pool pointed at the same URI so we can simulate concurrent runs.
 */
describe("withAdvisoryLock (integration)", () => {
  let ctx: TestDbContext;
  let secondPool: Pool;
  let secondDb: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    ctx = await setupTestDb();
    secondPool = new Pool({ connectionString: ctx.container.getConnectionUri() });
    secondDb = drizzle(secondPool);
  }, 180_000);

  afterAll(async () => {
    if (secondPool) await secondPool.end();
    if (ctx) await teardownTestDb(ctx);
  });

  it("acquires and releases the lock around the happy path", async () => {
    const result = await withAdvisoryLock(ctx.db, ETL_AZURE_LOCK_KEY, async () => {
      return { status: "ok" as const };
    });
    expect(result).toEqual({ status: "ok" });

    // The lock should have been released — we can acquire it again immediately.
    const again = await withAdvisoryLock(ctx.db, ETL_AZURE_LOCK_KEY, async () => {
      return "second";
    });
    expect(again).toBe("second");
  });

  it("returns { skipped: 'lock-not-acquired' } when a second session holds the lock", async () => {
    // Use a one-shot client from the primary pool so we OWN the session while
    // the inner call tries to acquire it. pg_try_advisory_lock is session-level.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const holdingClient: any = await (ctx.pool as Pool).connect();
    try {
      const acq = await holdingClient.query(
        `SELECT pg_try_advisory_lock($1) AS acquired`,
        [ETL_AZURE_LOCK_KEY],
      );
      expect(acq.rows[0].acquired).toBe(true);

      // From a DIFFERENT session (secondDb) try to run under the lock.
      const result = await withAdvisoryLock(
        secondDb,
        ETL_AZURE_LOCK_KEY,
        async () => "should-not-run",
      );
      expect(result).toEqual({ skipped: "lock-not-acquired" });
    } finally {
      await holdingClient.query(`SELECT pg_advisory_unlock($1)`, [
        ETL_AZURE_LOCK_KEY,
      ]);
      holdingClient.release();
    }
  });

  it("releases the lock even if fn throws", async () => {
    await expect(
      withAdvisoryLock(ctx.db, ETL_AZURE_LOCK_KEY, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The lock must have been released — otherwise this call would skip.
    const result = await withAdvisoryLock(ctx.db, ETL_AZURE_LOCK_KEY, async () => "ok");
    expect(result).toBe("ok");
  });
});
