import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { emailLog } from "@/db/schema";

import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";

// Phase 8 Plan 08-01 — Integration tests for the (kind, payload_hash)
// partial unique index on email_log (D-06 + EMAIL-04 idempotency contract).
//
// Runs against a fresh Testcontainers Postgres 16 with all migrations
// applied (including 0041_phase_08_email_log.sql added in this plan).
describe("email_log idempotency (EMAIL-04)", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    await ctx.db.delete(emailLog);
  });

  it("two rows with same (kind, payloadHash) -> second insert is no-op via partial unique idx", async () => {
    const hash = "sha256-test-1";
    await ctx.db.insert(emailLog).values({
      kind: "digest_daily",
      recipient: "ops@weknow.co",
      status: "sent",
      payloadHash: hash,
    });
    await ctx.db
      .insert(emailLog)
      .values({
        kind: "digest_daily",
        recipient: "ops@weknow.co",
        status: "sent",
        payloadHash: hash,
      })
      .onConflictDoNothing({
        target: [emailLog.kind, emailLog.payloadHash],
        where: sql`payload_hash IS NOT NULL`,
      });
    const all = await ctx.db.select().from(emailLog);
    expect(all).toHaveLength(1);
  });

  it("two rows with payloadHash=null + same kind -> both succeed (partial idx exempts NULL)", async () => {
    await ctx.db.insert(emailLog).values({
      kind: "password_reset",
      recipient: "user1@example.com",
      status: "sent",
      payloadHash: null,
    });
    await ctx.db.insert(emailLog).values({
      kind: "password_reset",
      recipient: "user2@example.com",
      status: "sent",
      payloadHash: null,
    });
    const all = await ctx.db.select().from(emailLog);
    expect(all).toHaveLength(2);
  });

  it("different kinds with same payloadHash -> both succeed", async () => {
    const hash = "sha256-test-2";
    await ctx.db.insert(emailLog).values({
      kind: "digest_daily",
      recipient: "a@example.com",
      status: "sent",
      payloadHash: hash,
    });
    await ctx.db.insert(emailLog).values({
      kind: "kiosk_offline",
      recipient: "a@example.com",
      status: "sent",
      payloadHash: hash,
    });
    const all = await ctx.db.select().from(emailLog);
    expect(all).toHaveLength(2);
  });
});
