import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../../helpers/test-db";
import {
  auditLogs,
  locations,
  locationProducts,
  products,
  providers,
  regions,
  salesImports,
  salesRecords,
} from "@/db/schema";
import { runMondayImport } from "@/lib/monday/import-location-products";
import { eq } from "drizzle-orm";

/**
 * Integration test for `runMondayImport`.
 *
 * Strategy: stub `global.fetch` with a handler that replies to Monday's
 * GraphQL endpoint with a tiny fixture and run the import end-to-end
 * against a Testcontainers Postgres. Asserts:
 *   1. The structured result counts match the fixture
 *   2. `location_products` rows land for the resolved hotel
 *   3. A placeholder `locations` row + audit entry are created for the
 *      no-outlet-code hotel on the AU board (the only board with an
 *      unambiguous regional default — see audit D5 Part D)
 *   4. No-outlet-code hotels on Live Estate (no regional default) are
 *      SKIPPED + counted in `placeholdersSkippedNoRegion`, never silently
 *      UK-defaulted
 *   5. The `logger` injection is honoured
 */
describe("runMondayImport", () => {
  let ctx: TestDbContext;
  let originalFetch: typeof global.fetch;

  // Minimal Monday GraphQL page shape, one board at a time.
  function pageResponse(
    firstPage: boolean,
    items: Array<{
      id: string;
      name: string;
      displayVal: string | null;
      subitems: Array<{
        id: string;
        name: string;
        providerName?: string | null;
        available?: boolean;
        commissionRate?: number | null;
      }>;
    }>,
  ) {
    const wrappedItems = items.map((it) => ({
      id: it.id,
      name: it.name,
      column_values: [
        {
          id: "mirror9",
          type: "mirror",
          display_value: it.displayVal ?? "",
        },
      ],
      subitems: it.subitems.map((sub) => ({
        id: sub.id,
        name: sub.name,
        column_values: [
          {
            id: "label2__1",
            type: "dropdown",
            text: sub.providerName ?? null,
          },
          {
            id: "color5__1",
            type: "status",
            text: sub.available ? "Yes" : "No",
          },
          {
            id: "dup__of_commission9__1",
            type: "numeric",
            text:
              sub.commissionRate != null ? String(sub.commissionRate) : null,
          },
        ],
      })),
    }));

    const payload = {
      cursor: null,
      items: wrappedItems,
    };

    if (firstPage) {
      return {
        data: { boards: [{ items_page: payload }] },
      };
    }
    return { data: { next_items_page: payload } };
  }

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // FK-ordered cleanup.
    await ctx.db.delete(salesRecords);
    await ctx.db.delete(salesImports);
    await ctx.db.delete(locationProducts);
    await ctx.db.delete(providers);
    await ctx.db.delete(products);
    await ctx.db.delete(locations);
    await ctx.db.delete(regions);
    await ctx.db.delete(auditLogs);

    // Seed both regions referenced by tests:
    //   - UK: needed by the seeded matched-hotel resolution path
    //   - AU: required for placeholder creation on the Australia DCM board
    //         (the only board still in BOARD_REGION post-D5 Part D)
    await ctx.db.insert(regions).values([
      { name: "United Kingdom", code: "UK", azureCode: "GB" },
      { name: "Australia", code: "AU", azureCode: "AU" },
    ]);

    const ukRegionId = (
      await ctx.db.select({ id: regions.id }).from(regions).where(eq(regions.code, "UK"))
    )[0].id;

    // A real hotel with outlet code MATCH-1 so resolution path is exercised.
    await ctx.db.insert(locations).values({
      name: "Matched Hotel",
      outletCode: "MATCH-1",
      primaryRegionId: ukRegionId,
    });

    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("runs end-to-end: resolves matched hotel, creates AU placeholder, skips no-region Live Estate hotel, TRUNCATE+insert, returns counts", async () => {
    // Board 1356570756 = Live Estate (placeholder-eligible, NO regional default post-D5 Part D)
    //  - hotel A: outletCode MATCH-1 → resolves, 2 subitems
    //  - hotel B: no outletCode → SKIPPED + counted in placeholdersSkippedNoRegion
    //             (formerly silently UK-defaulted; see audit D5 Part D)
    // Board 1743012104 = Ready to Launch (NON placeholder board)
    //  - hotel C: no outletCode → SKIPPED (not placeholder-eligible)
    // Board 5092887865 = Australia DCM (placeholder-eligible, AU regional default)
    //  - hotel D: no outletCode → AU placeholder created, 1 subitem
    // Board 5026387784 = Removed: empty page.
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const query: string = body.query ?? "";

      let responseBody: object;
      if (query.includes("boards(ids: [1356570756])")) {
        responseBody = pageResponse(true, [
          {
            id: "A",
            name: "Hotel Alpha",
            displayVal: "MATCH-1",
            subitems: [
              {
                id: "A1",
                name: "Transfers",
                providerName: "ProviderA",
                available: true,
                commissionRate: 10,
              },
              {
                id: "A2",
                name: "Tours & Activities",
                providerName: "ProviderB",
                available: false,
                commissionRate: null,
              },
            ],
          },
          {
            id: "B",
            name: "Hotel Bravo",
            displayVal: null,
            subitems: [
              {
                id: "B1",
                name: "Theatre",
                providerName: "ProviderA",
                available: true,
                commissionRate: 15,
              },
            ],
          },
        ]);
      } else if (query.includes("boards(ids: [1743012104])")) {
        responseBody = pageResponse(true, [
          {
            id: "C",
            name: "Hotel Charlie",
            displayVal: null,
            subitems: [
              {
                id: "C1",
                name: "Transfers",
                providerName: "ProviderA",
                available: true,
                commissionRate: 5,
              },
            ],
          },
        ]);
      } else if (query.includes("boards(ids: [5092887865])")) {
        responseBody = pageResponse(true, [
          {
            id: "D",
            name: "Hotel Delta",
            displayVal: null,
            subitems: [
              {
                id: "D1",
                name: "Spa",
                providerName: "ProviderC",
                available: true,
                commissionRate: 12,
              },
            ],
          },
        ]);
      } else {
        // Removed board → empty page.
        responseBody = pageResponse(true, []);
      }

      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    global.fetch = fetchMock as unknown as typeof global.fetch;

    const logs: Array<{ phase: string; msg: string }> = [];

    const result = await runMondayImport({
      mondayApiToken: "fake-token",
      db: ctx.db as unknown as typeof import("@/db").db,
      logger: (phase, msg) => logs.push({ phase, msg }),
    });

    // Structured result —
    //   Alpha (resolved, 2 subitems) + Delta (AU placeholder, 1 subitem) = 3 rows
    //   Placeholders: 1 (Delta on AU)
    //   Skipped: 2 (Bravo no-region + Charlie not-placeholder-eligible)
    //   placeholdersSkippedNoRegion: 1 (Bravo)
    expect(result.rowsInserted).toBe(3);
    expect(result.placeholdersCreated).toBe(1);
    expect(result.placeholderNames).toEqual(["Hotel Delta"]);
    expect(result.hotelsSkipped).toBe(2);
    expect(result.placeholdersSkippedNoRegion).toBe(1);
    expect(result.productsResolved).toBeGreaterThanOrEqual(3);
    expect(result.providersResolved).toBeGreaterThanOrEqual(3);
    expect(result.durationMs).toBeGreaterThan(0);

    // AU placeholder location row was created.
    const allLocs = await ctx.db
      .select({ id: locations.id, name: locations.name, primaryRegionId: locations.primaryRegionId })
      .from(locations);
    const auPlaceholder = allLocs.find((r) => r.name === "Hotel Delta");
    expect(auPlaceholder).toBeDefined();

    // Hotel Delta's region resolves to AU (not UK).
    const auRegionId = (
      await ctx.db.select({ id: regions.id }).from(regions).where(eq(regions.code, "AU"))
    )[0].id;
    expect(auPlaceholder!.primaryRegionId).toBe(auRegionId);

    // Hotel Bravo (Live Estate, no outlet code) was NOT created — the
    // load-bearing assertion: no UK fallback row exists for it.
    expect(allLocs.find((r) => r.name === "Hotel Bravo")).toBeUndefined();

    // Audit entry for the AU placeholder, none for Bravo.
    const audits = await ctx.db.select().from(auditLogs);
    expect(
      audits.some(
        (a) =>
          a.action === "imported_from_monday_placeholder" &&
          a.entityName === "Hotel Delta",
      ),
    ).toBe(true);
    expect(
      audits.some(
        (a) =>
          a.action === "imported_from_monday_placeholder" &&
          a.entityName === "Hotel Bravo",
      ),
    ).toBe(false);

    // The skip emits a MONDAY-phase log naming the hotel + Monday item id +
    // board so operators can act on it.
    const skipLog = logs.find(
      (l) =>
        l.phase === "MONDAY" &&
        l.msg.includes("Hotel Bravo") &&
        l.msg.includes("mondayItemId=B") &&
        l.msg.includes("Live Estate"),
    );
    expect(skipLog).toBeDefined();

    // location_products row count matches.
    const lpRows = await ctx.db.select().from(locationProducts);
    expect(lpRows).toHaveLength(3);

    // Products + providers got created (Bravo's "Theatre" is still
    // pre-resolved during the product/provider sweep — that pass runs over
    // every fetched hotel before the skip decision; the row simply never
    // makes it into location_products).
    const prodRows = await ctx.db.select().from(products);
    expect(prodRows.map((p) => p.name).sort()).toEqual([
      "Spa",
      "Theatre",
      "Tours & Activities",
      "Transfers",
    ]);
    const provRows = await ctx.db.select().from(providers);
    expect(provRows.map((p) => p.name).sort()).toEqual([
      "ProviderA",
      "ProviderB",
      "ProviderC",
    ]);

    // Logger was invoked with the expected phases.
    const phases = new Set(logs.map((l) => l.phase));
    expect(phases.has("FETCH")).toBe(true);
    expect(phases.has("IMPORT")).toBe(true);
    expect(phases.has("MONDAY")).toBe(true);

    // fetch was called — at least once per board (4 boards).
    expect(fetchMock).toHaveBeenCalled();
  });
});
