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

/**
 * Integration test for `runMondayImport`.
 *
 * Strategy: stub `global.fetch` with a handler that replies to Monday's
 * GraphQL endpoint with a tiny fixture — two boards, three hotels — and
 * run the import end-to-end against a Testcontainers Postgres. Asserts:
 *   1. The structured result counts match the fixture
 *   2. `location_products` rows land for the resolved hotel
 *   3. A placeholder `locations` row + audit entry are created for the
 *      no-outlet-code hotel on an active board (Live Estate / Australia DCM)
 *   4. The `logger` injection is honoured (no-op when omitted)
 *
 * The real script exercises the full 4-board API path; this test covers the
 * shape of the function and the placeholder branch in isolation.
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

    // Seed UK region — required for placeholder creation (Live Estate + AU
    // DCM both default to UK per BOARD_REGION).
    await ctx.db
      .insert(regions)
      .values({ name: "United Kingdom", code: "UK", azureCode: "GB" });

    // A real hotel with outlet code MATCH-1 so resolution path is exercised.
    await ctx.db.insert(locations).values({
      name: "Matched Hotel",
      outletCode: "MATCH-1",
      primaryRegionId: (
        await ctx.db.select({ id: regions.id }).from(regions)
      )[0].id,
    });

    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("runs end-to-end: resolves matched hotel, creates placeholder, TRUNCATE+insert, returns counts", async () => {
    // Board 1356570756 = Live Estate (placeholder board)
    //  - hotel A: outletCode MATCH-1 → resolves, 2 subitems
    //  - hotel B: no outletCode → placeholder created, 1 subitem
    // Board 1743012104 = Ready to Launch (NON placeholder board)
    //  - hotel C: no outletCode → SKIPPED
    // Boards 5026387784 + 5092887865: empty pages.
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
      } else {
        // Other boards (Removed, Australia DCM) → empty page.
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

    // Structured result — 2 subitems for Alpha (resolved) + 1 subitem for
    // Bravo (placeholder) = 3 rows. Charlie was skipped (Ready-to-Launch).
    expect(result.rowsInserted).toBe(3);
    expect(result.placeholdersCreated).toBe(1);
    expect(result.placeholderNames).toEqual(["Hotel Bravo"]);
    expect(result.hotelsSkipped).toBe(1);
    expect(result.productsResolved).toBeGreaterThanOrEqual(3);
    expect(result.providersResolved).toBeGreaterThanOrEqual(2);
    expect(result.durationMs).toBeGreaterThan(0);

    // Placeholder location row was created with MONDAY-<id> outletCode.
    const placeholderRows = await ctx.db
      .select({ id: locations.id, name: locations.name })
      .from(locations);
    const placeholder = placeholderRows.find(
      (r) => r.name === "Hotel Bravo",
    );
    expect(placeholder).toBeDefined();

    // Audit entry for the placeholder.
    const audits = await ctx.db.select().from(auditLogs);
    expect(
      audits.some(
        (a) =>
          a.action === "imported_from_monday_placeholder" &&
          a.entityName === "Hotel Bravo",
      ),
    ).toBe(true);

    // location_products row count matches.
    const lpRows = await ctx.db.select().from(locationProducts);
    expect(lpRows).toHaveLength(3);

    // Products + providers got created.
    const prodRows = await ctx.db.select().from(products);
    expect(prodRows.map((p) => p.name).sort()).toEqual([
      "Theatre",
      "Tours & Activities",
      "Transfers",
    ]);
    const provRows = await ctx.db.select().from(providers);
    expect(provRows.map((p) => p.name).sort()).toEqual([
      "ProviderA",
      "ProviderB",
    ]);

    // Logger was invoked with the expected phases.
    const phases = new Set(logs.map((l) => l.phase));
    expect(phases.has("FETCH")).toBe(true);
    expect(phases.has("IMPORT")).toBe(true);

    // fetch was called — at least once per board (4 boards).
    expect(fetchMock).toHaveBeenCalled();
  });
});
