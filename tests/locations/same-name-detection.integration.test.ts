/**
 * Phase 7 Plan 07-04 Task 2 — `detectSameNameGroups` helper.
 *
 * Sentinel is excluded by name-equality on the canonical normalised value
 * (`normaliseName("LOCATION_NEEDED") === "locationneeded"`). The helper does
 * NOT rely on the partial unique index for correctness — it queries the
 * table directly so it surfaces dupes that might have slipped past the index
 * via direct SQL, archived→active flips, or the sentinel-row exclusion.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { detectSameNameGroups } from "@/lib/locations/same-name-detection";
import { regions } from "@/db/schema";

import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../helpers/test-db";

describe("detectSameNameGroups (Plan 07-04 Task 2)", () => {
  let ctx: TestDbContext;
  let ukRegionId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
    const [uk] = await ctx.db
      .select()
      .from(regions)
      .where(eq(regions.code, "UK"));
    ukRegionId = uk.id;
    // Clean slate before any test seeds — migrations don't insert into
    // `locations` so this is a defensive sweep.
    await ctx.pool.query(`DELETE FROM locations`);
  }, 120_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  it("returns one group with count=3 + 3 locationIds when 3 active rows share a normalised name; sentinel + singleton + archived twin are excluded", async () => {
    await ctx.pool.query(`DELETE FROM locations`);
    // Seeding 3 active rows with the same normalised_name would normally
    // be blocked by the partial unique index `locations_normalised_name_unique_active`
    // — that's the whole point of the index. The detection helper runs at the
    // table layer and works regardless of the index, so we drop the index for
    // the duration of the seed and restore it afterwards. This keeps the test
    // assertion focused on the helper's behaviour rather than on the index's
    // enforcement (which has its own dedicated test in
    // tests/db/locations-same-name.integration.test.ts).
    await ctx.pool.query(
      `DROP INDEX IF EXISTS locations_normalised_name_unique_active`,
    );
    try {
      await ctx.pool.query(
        `INSERT INTO locations (name, normalised_name, outlet_code, primary_region_id, archived_at)
         VALUES
           ('Hilton Newcastle', 'hilton newcastle', 'HN-A', $1, NULL),
           ('Hilton — Newcastle', 'hilton newcastle', 'HN-B', $1, NULL),
           ('HILTON NEWCASTLE', 'hilton newcastle', 'HN-C', $1, NULL),
           ('LOCATION_NEEDED', 'locationneeded', '__LOCATION_NEEDED__', $1, NULL),
           ('Singleton Hotel', 'singleton hotel', 'SH-A', $1, NULL),
           ('Archived Twin', 'hilton newcastle', 'HN-OLD', $1, NOW())`,
        [ukRegionId],
      );

      const groups = await detectSameNameGroups(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx.db as unknown as any,
      );

      expect(groups).toHaveLength(1);
      expect(groups[0].normalisedName).toBe("hilton newcastle");
      expect(groups[0].count).toBe(3);
      expect(groups[0].locationIds).toHaveLength(3);
    } finally {
      // Wipe locations BEFORE restoring the index — the seed left the table
      // in a state the unique index would reject. Then restore the index so
      // downstream tests still see the migration-shape schema.
      await ctx.pool.query(`DELETE FROM locations`);
      await ctx.pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS locations_normalised_name_unique_active
         ON locations (normalised_name) WHERE archived_at IS NULL`,
      );
    }
  });

  it("returns [] on a table with only the sentinel + singletons (no real dupes)", async () => {
    await ctx.pool.query(`DELETE FROM locations`);
    await ctx.pool.query(
      `INSERT INTO locations (name, normalised_name, outlet_code, primary_region_id)
       VALUES
         ('LOCATION_NEEDED', 'locationneeded', '__LOCATION_NEEDED__', $1),
         ('Some Hotel', 'some hotel', 'SH-1', $1),
         ('Other Hotel', 'other hotel', 'OH-1', $1)`,
      [ukRegionId],
    );

    const groups = await detectSameNameGroups(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.db as unknown as any,
    );
    expect(groups).toEqual([]);
  });
});
