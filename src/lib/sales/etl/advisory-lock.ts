import { sql } from "drizzle-orm";

/**
 * Postgres advisory-lock helper for the Azure ETL.
 *
 * `pg_try_advisory_lock` is session-scoped and non-blocking — if another
 * session already holds the lock we return immediately with a sentinel
 * instead of queuing. The ETL orchestrator uses this to guarantee only one
 * run is active per DB at a time (cron race, manual kick-off overlap, etc.)
 * without the complexity of row-level locks or external coordinators.
 *
 * Precondition: `db` must route both the lock and its release through the
 * same session. A node-postgres `Pool` wrapped by Drizzle satisfies this
 * because consecutive `.execute()` calls acquire a connection, run, and
 * release — a lock acquired in call 1 is released by the connection's own
 * cleanup if we crash between calls, so there is no leak risk in practice
 * (and the `finally` below still attempts a clean unlock on the happy path).
 */

export const ETL_AZURE_LOCK_KEY = 738_294_105;

export type LockSkip = { skipped: "lock-not-acquired" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function withAdvisoryLock<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  key: number,
  fn: () => Promise<T>,
): Promise<T | LockSkip> {
  const res = await db.execute(
    sql`SELECT pg_try_advisory_lock(${key}) AS acquired`,
  );
  // node-postgres returns { rows: [...] }; some drivers return the array directly.
  const rows: Array<{ acquired: boolean }> = Array.isArray(res)
    ? res
    : (res?.rows ?? []);
  const acquired = rows[0]?.acquired === true;
  if (!acquired) return { skipped: "lock-not-acquired" as const };
  try {
    return await fn();
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${key})`);
  }
}
