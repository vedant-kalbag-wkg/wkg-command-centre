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

import { eq } from "drizzle-orm";

import { kioskAssignments, kiosks, locations, regions } from "@/db/schema";
import { runHeathrowImport } from "@/lib/monday/import-heathrow";

import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../../helpers/test-db";

/**
 * Integration test for `runHeathrowImport` after the metadata-enrichment
 * fix lands. Heathrow has a narrower column set than the 4 standard hotel
 * boards: no hotel_group, no rating, no room count, no SSM-Group link.
 *
 * Asserts:
 *   1. INSERT writes all 8 Heathrow metadata fields (address + lat/lng,
 *      status, live_date, maintenance_fee from `numeric`, key_contact_name,
 *      key_contact_email, finance_contact, location_group from `category1`).
 *   2. Fill-NULLs-only on ON CONFLICT: operator UI edits survive re-runs.
 */

const TEST_TOKEN = "test-token";

const HEATHROW_FIXTURE = {
  id: "HX-1",
  name: "Heathrow Terminal 5 SSM",
  group: { id: "live_ssms", title: "Live SSMs" },
  column_values: [
    { id: "outlet_code1", type: "text", text: "T5" },
    { id: "text4", type: "text", text: "9999" },
    {
      id: "location",
      type: "location",
      text: "Terminal 5, London Heathrow Airport, UK",
      lat: 51.471,
      lng: -0.453,
    },
    { id: "status", type: "status", text: "Live" },
    { id: "live_date", type: "date", text: "2024-04-01" },
    { id: "numeric", type: "numbers", text: "350" },
    { id: "key_contact_name", type: "text", text: "Sarah Chen" },
    {
      id: "key_contact_email",
      type: "email",
      text: "sarah.chen@heathrow.com",
    },
    { id: "finance_contact1", type: "text", text: "finance@heathrow.com" },
    { id: "category1", type: "dropdown", text: "Airside Departures" },
  ],
};

function singleBoardPageResponse(firstPage: boolean, items: unknown[]) {
  const payload = { cursor: null, items };
  return firstPage
    ? { data: { boards: [{ items_page: payload }] } }
    : { data: { next_items_page: payload } };
}

describe("runHeathrowImport — metadata enrichment", () => {
  let ctx: TestDbContext;
  let originalFetch: typeof global.fetch;
  let ukRegionId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    await ctx.db.delete(kioskAssignments);
    await ctx.db.delete(kiosks);
    await ctx.db.delete(locations);
    await ctx.db.delete(regions);

    await ctx.db.insert(regions).values([
      { name: "United Kingdom", code: "UK", azureCode: "GB" },
    ]);
    ukRegionId = (
      await ctx.db
        .select({ id: regions.id })
        .from(regions)
        .where(eq(regions.code, "UK"))
    )[0].id;

    originalFetch = global.fetch;
    process.env.MONDAY_API_TOKEN = TEST_TOKEN;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function stubFetch(items: unknown[]) {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const query: string = body.query ?? "";
        const isFirst = query.includes("boards(ids:");
        return {
          ok: true,
          status: 200,
          json: async () => singleBoardPageResponse(isFirst, items),
        } as unknown as Response;
      },
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;
    return fetchMock;
  }

  test("writes 8 Heathrow metadata fields on INSERT", async () => {
    stubFetch([HEATHROW_FIXTURE]);

    const result = await runHeathrowImport({
      mondayApiToken: TEST_TOKEN,
      db: ctx.db as unknown as Parameters<
        typeof runHeathrowImport
      >[0]["db"],
      resolveRegionIdByGroup: async () => ukRegionId,
    });

    expect(result.liveLocationsInserted).toBe(1);

    const row = (
      await ctx.db
        .select()
        .from(locations)
        .where(eq(locations.mondayItemId, "HX-1"))
    )[0];

    expect(row).toBeDefined();
    expect(row.address).toBe(
      "Terminal 5, London Heathrow Airport, UK",
    );
    expect(row.latitude).toBe(51.471);
    expect(row.longitude).toBe(-0.453);
    expect(row.status).toBe("Live");
    expect(row.liveDate?.toISOString().slice(0, 10)).toBe("2024-04-01");
    expect(Number(row.maintenanceFee)).toBe(350);
    expect(row.keyContactName).toBe("Sarah Chen");
    expect(row.keyContactEmail).toBe("sarah.chen@heathrow.com");
    expect(row.financeContact).toBe("finance@heathrow.com");
    expect(row.locationGroup).toBe("Airside Departures");
    expect(row.customerCode).toBe("9999");
    // Heathrow board has no hotel_group / launch_phase / star_rating /
    // num_rooms / sourced_by — those stay NULL.
    expect(row.hotelGroup).toBeNull();
    expect(row.launchPhase).toBeNull();
    expect(row.starRating).toBeNull();
    expect(row.numRooms).toBeNull();
    expect(row.sourcedBy).toBeNull();
  });

  test("ON CONFLICT preserves operator UI edits (fill-NULLs-only)", async () => {
    stubFetch([HEATHROW_FIXTURE]);
    await runHeathrowImport({
      mondayApiToken: TEST_TOKEN,
      db: ctx.db as unknown as Parameters<
        typeof runHeathrowImport
      >[0]["db"],
      resolveRegionIdByGroup: async () => ukRegionId,
    });

    await ctx.db
      .update(locations)
      .set({ keyContactName: "Operator Override" })
      .where(eq(locations.mondayItemId, "HX-1"));

    stubFetch([HEATHROW_FIXTURE]);
    const result = await runHeathrowImport({
      mondayApiToken: TEST_TOKEN,
      db: ctx.db as unknown as Parameters<
        typeof runHeathrowImport
      >[0]["db"],
      resolveRegionIdByGroup: async () => ukRegionId,
    });

    expect(result.liveLocationsInserted).toBe(0);
    expect(result.liveLocationsSkippedExisting).toBe(1);

    const row = (
      await ctx.db
        .select()
        .from(locations)
        .where(eq(locations.mondayItemId, "HX-1"))
    )[0];
    expect(row.keyContactName).toBe("Operator Override");
    // Other Monday-sourced fields stay where the first import put them.
    expect(row.address).toBe("Terminal 5, London Heathrow Airport, UK");
  });
});
