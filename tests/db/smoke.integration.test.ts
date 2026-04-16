import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { setupTestDb, teardownTestDb } from "../helpers/test-db";

describe("test-db smoke", () => {
  let ctx: Awaited<ReturnType<typeof setupTestDb>>;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 120_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  it("runs a trivial query", async () => {
    const rows = await ctx.db.execute(sql`select 1 as n`);
    expect(rows.rows[0]).toEqual({ n: 1 });
  });
});
