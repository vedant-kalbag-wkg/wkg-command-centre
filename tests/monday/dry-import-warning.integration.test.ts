/**
 * Phase 7 Plan 07-04 Task 1 — `runMondayImport({ dryRun: true })` surfaces
 * same-name warnings (DATA-03 D-09).
 *
 * Stubs Monday's `fetch` with a fixed payload that includes a hotel whose
 * normalised name collides with an existing active locations row. Asserts:
 *   1. `result.sameNameWarnings` is non-empty when collisions exist.
 *   2. A `dry_import_warning` audit_logs row is written when warnings emit.
 *   3. `result.sameNameWarnings === []` when no collisions exist.
 *   4. `dryRun: true` produces no rows in `location_products` (read-only).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { runMondayImport } from "@/lib/monday/import-location-products";
import { auditLogs, locationProducts, locations, regions } from "@/db/schema";

import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../helpers/test-db";

type MondayHotelFixture = {
  id: string;
  name: string;
  outletCodes: string[]; // mirror9 display value, comma-joined
};

function buildBoardsResponse(hotels: MondayHotelFixture[]) {
  const items = hotels.map((h) => ({
    id: h.id,
    name: h.name,
    column_values: [
      {
        id: "mirror9",
        type: "mirror",
        display_value: h.outletCodes.join(", "),
      },
    ],
    subitems: [
      {
        id: `${h.id}-sub-1`,
        name: "Test Product",
        column_values: [
          { id: "label2__1", text: "TestProvider", type: "color" },
          { id: "color5__1", text: "Yes", type: "color" },
          {
            id: "dup__of_commission9__1",
            text: "10",
            type: "numeric",
          },
        ],
      },
    ],
  }));
  return {
    data: {
      boards: [{ items_page: { cursor: null, items } }],
    },
  };
}

function emptyBoardResponse() {
  return {
    data: {
      boards: [{ items_page: { cursor: null, items: [] } }],
    },
  };
}

describe("runMondayImport dry-run same-name warning (Plan 07-04 Task 1)", () => {
  let ctx: TestDbContext;
  let ukRegionId: string;
  let originalFetch: typeof globalThis.fetch | undefined;
  let originalToken: string | undefined;

  beforeAll(async () => {
    ctx = await setupTestDb();
    const [uk] = await ctx.db
      .select()
      .from(regions)
      .where(eq(regions.code, "UK"));
    ukRegionId = uk.id;
    originalFetch = globalThis.fetch;
    originalToken = process.env.MONDAY_API_TOKEN;
    process.env.MONDAY_API_TOKEN = "test-token";
  }, 120_000);

  afterAll(async () => {
    if (originalFetch) globalThis.fetch = originalFetch;
    if (originalToken === undefined) {
      delete process.env.MONDAY_API_TOKEN;
    } else {
      process.env.MONDAY_API_TOKEN = originalToken;
    }
    if (ctx) await teardownTestDb(ctx);
  });

  it("returns sameNameWarnings populated + writes dry_import_warning audit row when a collision exists", async () => {
    // Seed an active location so the importer's same-name detector has
    // something to collide against. `normalised_name` lowercase + spaces only.
    await ctx.pool.query(
      `INSERT INTO locations (name, normalised_name, outlet_code, primary_region_id)
       VALUES ($1, $2, $3, $4)`,
      [
        "Existing Same-Name Hotel",
        "existing samename hotel",
        "DRY-RUN-EXIST",
        ukRegionId,
      ],
    );

    // Stub fetch — first board returns one hotel whose name normalises to
    // "existing samename hotel"; subsequent boards return nothing.
    const collidingHotel: MondayHotelFixture = {
      id: "monday-item-101",
      name: "EXISTING SAME-NAME HOTEL",
      outletCodes: ["DRY-RUN-EXIST"],
    };
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount += 1;
        const body =
          callCount === 1
            ? buildBoardsResponse([collidingHotel])
            : emptyBoardResponse();
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }) as unknown as Response;
      }),
    );

    const result = await runMondayImport({
      mondayApiToken: "test-token",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: ctx.db as unknown as any,
      dryRun: true,
    });

    expect(result.sameNameWarnings.length).toBeGreaterThanOrEqual(1);
    const warning = result.sameNameWarnings.find(
      (w) => w.mondayItemId === "monday-item-101",
    );
    expect(warning).toBeDefined();
    expect(warning?.normalisedName).toBe("existing samename hotel");
    expect(warning?.collidingLocationIds.length).toBeGreaterThanOrEqual(1);

    // Dry-run did not insert any location_products / locations.
    const locProducts = await ctx.pool.query(
      `SELECT COUNT(*)::int AS c FROM location_products`,
    );
    expect(locProducts.rows[0]?.c).toBe(0);

    // Audit log entry was written.
    const audits = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "dry_import_warning"));
    expect(audits.length).toBe(1);
    expect(audits[0].entityType).toBe("system");
    const meta = audits[0].metadata as {
      warnings: number;
      sample: Array<{ mondayItemId: string }>;
    };
    expect(meta.warnings).toBeGreaterThanOrEqual(1);
    expect(meta.sample[0]?.mondayItemId).toBe("monday-item-101");

    vi.unstubAllGlobals();
  });

  it("returns sameNameWarnings: [] and writes no audit entry when no collisions exist", async () => {
    // Wipe audit_logs from the prior test so the assertion below is clean.
    await ctx.pool.query(
      `DELETE FROM audit_logs WHERE action = 'dry_import_warning'`,
    );

    // Hotel with a normalised name that doesn't match any seeded location.
    const cleanHotel: MondayHotelFixture = {
      id: "monday-item-202",
      name: "Brand New Hotel With No Twin",
      outletCodes: ["BNH-202"],
    };
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount += 1;
        const body =
          callCount === 1
            ? buildBoardsResponse([cleanHotel])
            : emptyBoardResponse();
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }) as unknown as Response;
      }),
    );

    const result = await runMondayImport({
      mondayApiToken: "test-token",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: ctx.db as unknown as any,
      dryRun: true,
    });

    expect(result.sameNameWarnings).toEqual([]);

    const audits = await ctx.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "dry_import_warning"));
    expect(audits.length).toBe(0);

    // location_products still empty (dry-run).
    const locProducts = await ctx.pool.query(
      `SELECT COUNT(*)::int AS c FROM location_products`,
    );
    expect(locProducts.rows[0]?.c).toBe(0);

    vi.unstubAllGlobals();
  });
});

// Suppress the unused-import lint — the schema imports are used in the seed
// and assertion paths above (drizzle 'select' style + raw pool queries).
void locations;
void locationProducts;
