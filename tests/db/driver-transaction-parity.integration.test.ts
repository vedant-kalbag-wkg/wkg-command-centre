/**
 * Driver-transaction parity test (Phase 0 Gate 2)
 *
 * Exercises `db.transaction(async (tx) => ...)` against the REAL `db` export
 * from `@/db`, so the test runs on whichever driver the env fork selects:
 *   - `postgres-js` under local Postgres (DATABASE_URL=postgres://... localhost)
 *   - `neon-serverless` under a Neon dev branch (DATABASE_URL=...neon.tech)
 *
 * Asserts commit + rollback semantics symmetrically. Does NOT use the
 * testcontainer helper — the whole point is to validate the driver actually
 * wired into the request path.
 *
 * Uses `audit_logs` because:
 *   - It has no FK constraints on required columns (entityType / entityId /
 *     action are plain `text` with no `.references()`). Safe to insert and
 *     delete throwaway rows without touching other tables.
 *
 * A sentinel prefix (`DRIVER-PARITY-TEST-`) on `entity_type` isolates this
 * test's rows so cleanup can target them precisely without touching real
 * audit history.
 *
 * Env loading: ESM hoists static `import` statements above top-level
 * statements, so `loadEnv()` cannot run before `@/db` evaluates if `db` is
 * imported statically. We therefore load `.env.local` at module top and
 * import `@/db` dynamically inside `beforeAll`.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { and, eq, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auditLogs } from "@/db/schema";
import type { db as DbType } from "@/db";

// Populated in `beforeAll` via dynamic import (see note above).
let db: typeof DbType;

const SENTINEL_PREFIX = "DRIVER-PARITY-TEST-";
const PER_TEST_TIMEOUT_MS = 30_000;

/**
 * Unique `entity_type` value for a single test case. All rows written in a
 * single test share the same entityType so cleanup is a single DELETE.
 */
function freshEntityType(): string {
  return `${SENTINEL_PREFIX}${randomUUID()}`;
}

async function cleanupAllSentinelRows(): Promise<void> {
  await db.delete(auditLogs).where(like(auditLogs.entityType, `${SENTINEL_PREFIX}%`));
}

describe("db.transaction — commit/rollback parity across drivers", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL must be set for this integration test — it exercises the real db export.",
      );
    }
    // Dynamic import — ensures `.env.local` has been applied to `process.env`
    // before `@/db` evaluates and captures `DATABASE_URL`.
    ({ db } = await import("@/db"));
    // Trivial connectivity probe: confirms the driver can round-trip a query
    // before we start asserting transaction semantics.
    await db.select().from(auditLogs).limit(0);
  }, PER_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await cleanupAllSentinelRows();
  }, PER_TEST_TIMEOUT_MS);

  afterAll(async () => {
    // Belt-and-suspenders — afterEach already ran, but in case an earlier
    // failure left rows behind, one final sweep.
    await cleanupAllSentinelRows();
  }, PER_TEST_TIMEOUT_MS);

  it(
    "commits a single insert",
    async () => {
      const entityType = freshEntityType();
      const marker = randomUUID();

      await db.transaction(async (tx) => {
        await tx.insert(auditLogs).values({
          entityType,
          entityId: marker,
          action: "commit-single",
        });
      });

      const rows = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, marker)));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.action).toBe("commit-single");
    },
    PER_TEST_TIMEOUT_MS,
  );

  it(
    "rolls back when an error is thrown early in the transaction",
    async () => {
      const entityType = freshEntityType();
      const marker = randomUUID();

      await expect(
        db.transaction(async (tx) => {
          await tx.insert(auditLogs).values({
            entityType,
            entityId: marker,
            action: "rollback-early",
          });
          throw new Error("deliberate rollback");
        }),
      ).rejects.toThrow(/deliberate rollback/);

      const rows = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, marker)));
      expect(rows).toHaveLength(0);
    },
    PER_TEST_TIMEOUT_MS,
  );

  it(
    "commits two sequential inserts in the same transaction",
    async () => {
      const entityType = freshEntityType();
      const markerA = randomUUID();
      const markerB = randomUUID();

      await db.transaction(async (tx) => {
        await tx.insert(auditLogs).values({
          entityType,
          entityId: markerA,
          action: "sequential-a",
        });
        await tx.insert(auditLogs).values({
          entityType,
          entityId: markerB,
          action: "sequential-b",
        });
      });

      const rows = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.entityType, entityType));
      expect(rows).toHaveLength(2);
      const actions = rows.map((r) => r.action).sort();
      expect(actions).toEqual(["sequential-a", "sequential-b"]);
    },
    PER_TEST_TIMEOUT_MS,
  );

  it(
    "rolls back a prior insert when a later statement throws in the same transaction",
    async () => {
      const entityType = freshEntityType();
      const marker = randomUUID();

      await expect(
        db.transaction(async (tx) => {
          await tx.insert(auditLogs).values({
            entityType,
            entityId: marker,
            action: "rollback-late",
          });
          // Second statement throws AFTER the insert has landed on the
          // connection — the driver must still roll back the earlier insert.
          throw new Error("deliberate late rollback");
        }),
      ).rejects.toThrow(/deliberate late rollback/);

      const rows = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, marker)));
      expect(rows).toHaveLength(0);
    },
    PER_TEST_TIMEOUT_MS,
  );
});
