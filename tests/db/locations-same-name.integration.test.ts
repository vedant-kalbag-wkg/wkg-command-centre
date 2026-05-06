/**
 * Phase 7 Plan 07-04 Task 1 — partial unique index on
 * `locations.normalised_name WHERE archived_at IS NULL`.
 *
 * Tests prove the DB enforces uniqueness of the normalised name across
 * active rows (Test 2) but allows archived rows to share normalised names
 * with active ones (Test 3). The partial-index predicate (`WHERE archived_at
 * IS NULL`) is what makes this possible — a full unique index would block
 * legitimate archive-and-rename flows.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { regions } from "@/db/schema";

import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../helpers/test-db";

describe("locations same-name partial unique index (Plan 07-04 Task 1)", () => {
  let ctx: TestDbContext;
  let ukRegionId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
    const [uk] = await ctx.db
      .select()
      .from(regions)
      .where(eq(regions.code, "UK"));
    ukRegionId = uk.id;
  }, 120_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  it("rejects a second active row with the same normalised_name (unique violation 23505)", async () => {
    // Seed one active row.
    await ctx.pool.query(
      `INSERT INTO locations (name, normalised_name, primary_region_id)
       VALUES ($1, $2, $3)`,
      ["Residence Inn Kensington", "residence inn kensington", ukRegionId],
    );

    // The second insert MUST raise unique_violation (Postgres SQLSTATE 23505).
    let caught: { code?: string; message?: string } | undefined;
    try {
      await ctx.pool.query(
        `INSERT INTO locations (name, normalised_name, primary_region_id)
         VALUES ($1, $2, $3)`,
        [
          "Residence Inn — Kensington",
          "residence inn kensington",
          ukRegionId,
        ],
      );
    } catch (e: unknown) {
      caught = e as { code?: string; message?: string };
    }

    expect(caught).toBeDefined();
    expect(caught?.code).toBe("23505");
    expect(caught?.message ?? "").toMatch(
      /locations_normalised_name_unique_active/,
    );
  });

  it("allows an archived row to share normalised_name with an active one (partial predicate)", async () => {
    // Active row.
    await ctx.pool.query(
      `INSERT INTO locations (name, normalised_name, primary_region_id)
       VALUES ($1, $2, $3)`,
      ["Hilton Newcastle", "hilton newcastle", ukRegionId],
    );
    // Same normalised name but archived — should succeed.
    const archived = await ctx.pool.query<{ id: string }>(
      `INSERT INTO locations (name, normalised_name, primary_region_id, archived_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id`,
      ["Hilton Newcastle (legacy)", "hilton newcastle", ukRegionId],
    );
    expect(archived.rows[0]?.id).toBeDefined();

    // And: a brand new active row with a fresh normalised name — also succeeds.
    const fresh = await ctx.pool.query<{ id: string }>(
      `INSERT INTO locations (name, normalised_name, primary_region_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        "Hilton Newcastle Quayside",
        "hilton newcastle quayside",
        ukRegionId,
      ],
    );
    expect(fresh.rows[0]?.id).toBeDefined();
  });
});
