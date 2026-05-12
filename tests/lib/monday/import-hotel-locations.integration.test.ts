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

import { and, eq, isNull } from "drizzle-orm";

import {
  hotelGroups,
  kioskConfigGroups,
  locationHotelGroupMemberships,
  locations,
  regions,
} from "@/db/schema";
import { runHotelLocationImport } from "@/lib/monday/import-hotel-locations";

import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../../helpers/test-db";

/**
 * Integration test for `runHotelLocationImport` after the metadata-enrichment
 * fix lands (replacing the identity-only behaviour that Phase 07-06 left
 * behind). Asserts:
 *
 *   1. All 15 Monday metadata fields land on a freshly inserted row.
 *   2. A multi-label `hotel_group` ("Arora, Radisson Hotels") writes a row
 *      per label into `location_hotel_group_memberships`, upserts each into
 *      `hotel_groups`, and leaves `operating_group_id` NULL (operator picks
 *      a primary via the UI).
 *   3. A single-label `hotel_group` writes one membership row AND sets
 *      `operating_group_id` to the upserted group.
 *   4. ON CONFLICT honours fill-NULLs-only semantics: a row that was
 *      already imported AND has had an operator UI edit (key_contact_name)
 *      keeps the operator's value when the importer re-runs against the
 *      same Monday item.
 *   5. `kiosk_config_group_id` is resolved when the SSM-Group linked-item
 *      id is present in the supplied lookup map AND a `kiosk_config_groups`
 *      row exists for that name. Unresolved links leave the column NULL and
 *      increment a counter.
 *   6. LocationValue with no lat/lng populates `address` but keeps the
 *      coordinate columns NULL (the LocationValue fragment doesn't always
 *      include lat/lng).
 */

const TEST_TOKEN = "test-token";

const HOTEL_FIXTURE_FULL = {
  id: "ITEM-FULL",
  name: "Marriott London Heathrow Hotel",
  group: { id: "uk_live", title: "Live: UK Hotels" },
  column_values: [
    {
      id: "mirror3__1",
      type: "mirror",
      display_value: "2357",
    },
    {
      id: "location",
      type: "location",
      text: "London Heathrow Marriott Hotel, Airport, Harlington, Hayes, UK",
      lat: 51.477,
      lng: -0.451,
    },
    { id: "group0", type: "dropdown", text: "Marriott Group" },
    { id: "status_17", type: "status", text: "Phase 0" },
    { id: "status", type: "status", text: "Live" },
    { id: "live_date", type: "date", text: "2023-08-31 15:06" },
    { id: "key_contact_name", type: "text", text: "Ron Vos" },
    {
      id: "key_contact_email",
      type: "email",
      text: "ron.vos@marriotthotels.com",
    },
    {
      id: "finance_contact1",
      type: "text",
      text: "mhrs.lhrhr.accounts@mhrheathrow.co.uk",
    },
    { id: "numbers__1", type: "numbers", text: "150" },
    { id: "date9", type: "date", text: "2026-12-31" },
    { id: "number_of_rooms", type: "numbers", text: "393" },
    { id: "rating__1", type: "rating", text: "4" },
    { id: "label8__1", type: "status", text: "WKG" },
    { id: "status_11", type: "status", text: "Heathrow" },
    {
      id: "link_to_ssm_groups__1",
      type: "board_relation",
      text: "Heathrow Hilton",
      linked_item_ids: ["SSM-1"],
    },
    {
      id: "long_text__1",
      type: "long_text",
      text: "Monday-sourced notes for the row.",
    },
  ],
};

const HOTEL_FIXTURE_MULTI_GROUP = {
  id: "ITEM-MULTI",
  name: "Edwardian Radisson Blu SSM",
  group: { id: "uk_live", title: "Live: UK Hotels" },
  column_values: [
    { id: "mirror3__1", type: "mirror", display_value: "9001" },
    {
      id: "location",
      type: "location",
      text: "Heathrow, Bath Road, UK",
    },
    { id: "group0", type: "dropdown", text: "Arora, Radisson Hotels" },
    { id: "number_of_rooms", type: "numbers", text: "464" },
    { id: "rating__1", type: "rating", text: "4" },
    {
      id: "link_to_ssm_groups__1",
      type: "board_relation",
      text: "Unmapped SSM Group",
      linked_item_ids: ["SSM-UNKNOWN"],
    },
  ],
};

const HOTEL_FIXTURE_NO_LATLNG = {
  id: "ITEM-NO-COORDS",
  name: "Novotel Reading Centre",
  group: { id: "uk_live", title: "Live: UK Hotels" },
  column_values: [
    { id: "mirror3__1", type: "mirror", display_value: "1234" },
    // text only, no lat/lng on the LocationValue payload.
    {
      id: "location",
      type: "location",
      text: "Friar Street, Reading, UK",
    },
    { id: "group0", type: "dropdown", text: "Accor" },
  ],
};

function singleBoardPageResponse(firstPage: boolean, items: unknown[]) {
  const payload = { cursor: null, items };
  return firstPage
    ? { data: { boards: [{ items_page: payload }] } }
    : { data: { next_items_page: payload } };
}

function emptyPageResponse(firstPage: boolean) {
  return singleBoardPageResponse(firstPage, []);
}

describe("runHotelLocationImport — metadata enrichment", () => {
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
    // FK-ordered cleanup of the entities we touch.
    await ctx.db.delete(locationHotelGroupMemberships);
    await ctx.db.delete(locations);
    await ctx.db.delete(hotelGroups);
    await ctx.db.delete(kioskConfigGroups);
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

    // Pre-seeded kiosk_config_groups row whose name matches the SSM-Group
    // resolution map fixture. The importer does NOT auto-create — it only
    // resolves by name lookup.
    await ctx.db
      .insert(kioskConfigGroups)
      .values([{ name: "Heathrow Hilton" }]);

    originalFetch = global.fetch;
    process.env.MONDAY_API_TOKEN = TEST_TOKEN;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // The importer is designed to run inside an outer BEGIN (the v2 runbook
  // wraps it) and uses SAVEPOINT around each insert to recover from per-item
  // 23505 conflicts without aborting the surrounding transaction. Mirror
  // that here so the test exercises the production code path.
  type Deps = Parameters<typeof runHotelLocationImport>[0];
  async function runInTx(
    deps: Omit<Deps, "db"> & { db?: never },
  ): Promise<Awaited<ReturnType<typeof runHotelLocationImport>>> {
    return await (
      ctx.db as unknown as {
        transaction: (
          fn: (tx: unknown) => Promise<unknown>,
        ) => Promise<unknown>;
      }
    ).transaction(async (tx) =>
      runHotelLocationImport({ ...deps, db: tx as Deps["db"] }),
    ) as Awaited<ReturnType<typeof runHotelLocationImport>>;
  }

  function stubFetchOnce(itemsForLiveEstate: unknown[]) {
    // Live Estate (1356570756) returns the fixture; the other three boards
    // return empty pages. Pagination on each board terminates immediately
    // (cursor: null on the first page).
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const query: string = body.query ?? "";
        let responseBody: object;
        if (query.includes("boards(ids: [1356570756])")) {
          responseBody = singleBoardPageResponse(true, itemsForLiveEstate);
        } else if (
          query.includes("boards(ids: [1743012104])") ||
          query.includes("boards(ids: [5026387784])") ||
          query.includes("boards(ids: [5092887865])")
        ) {
          responseBody = emptyPageResponse(true);
        } else {
          // Pagination cursor fetches — return empty.
          responseBody = emptyPageResponse(false);
        }
        return {
          ok: true,
          status: 200,
          json: async () => responseBody,
        } as unknown as Response;
      },
    );
    global.fetch = fetchMock as unknown as typeof global.fetch;
    return fetchMock;
  }

  test("writes all 15 Monday metadata fields on a fresh INSERT", async () => {
    stubFetchOnce([HOTEL_FIXTURE_FULL]);

    const result = await runInTx({
      mondayApiToken: TEST_TOKEN,
      resolveRegionIdByGroup: async () => ukRegionId,
      kioskConfigGroupByMondayLinkedId: new Map([
        [
          "SSM-1",
          (
            await ctx.db
              .select({ id: kioskConfigGroups.id })
              .from(kioskConfigGroups)
              .where(eq(kioskConfigGroups.name, "Heathrow Hilton"))
          )[0].id,
        ],
      ]),
    });

    expect(result.locationsInserted).toBe(1);

    const rows = await ctx.db
      .select()
      .from(locations)
      .where(eq(locations.mondayItemId, "ITEM-FULL"));
    expect(rows).toHaveLength(1);
    const row = rows[0];

    expect(row.address).toBe(
      "London Heathrow Marriott Hotel, Airport, Harlington, Hayes, UK",
    );
    expect(row.latitude).toBe(51.477);
    expect(row.longitude).toBe(-0.451);
    expect(row.hotelGroup).toBe("Marriott Group");
    expect(row.launchPhase).toBe("Phase 0");
    expect(row.status).toBe("Live");
    expect(row.liveDate).toBeInstanceOf(Date);
    expect(row.liveDate?.toISOString().slice(0, 10)).toBe("2023-08-31");
    expect(row.keyContactName).toBe("Ron Vos");
    expect(row.keyContactEmail).toBe("ron.vos@marriotthotels.com");
    expect(row.financeContact).toBe(
      "mhrs.lhrhr.accounts@mhrheathrow.co.uk",
    );
    expect(Number(row.maintenanceFee)).toBe(150);
    expect(row.freeTrialEndDate?.toISOString().slice(0, 10)).toBe(
      "2026-12-31",
    );
    expect(row.numRooms).toBe(393);
    expect(row.roomCount).toBe(393);
    expect(row.starRating).toBe(4);
    expect(row.sourcedBy).toBe("WKG");
    expect(row.locationGroup).toBe("Heathrow");
    expect(row.notes).toBe("Monday-sourced notes for the row.");
    expect(row.kioskConfigGroupId).not.toBeNull();
    expect(row.operatingGroupId).not.toBeNull();
    expect(row.customerCode).toBe("2357");
  });

  test("multi-label hotel_group writes N memberships + NULL operating_group_id", async () => {
    stubFetchOnce([HOTEL_FIXTURE_MULTI_GROUP]);

    const result = await runInTx({
      mondayApiToken: TEST_TOKEN,
      resolveRegionIdByGroup: async () => ukRegionId,
      kioskConfigGroupByMondayLinkedId: new Map(),
    });

    expect(result.locationsInserted).toBe(1);
    expect(result.kioskConfigGroupsUnresolved).toBe(1);

    const row = (
      await ctx.db
        .select()
        .from(locations)
        .where(eq(locations.mondayItemId, "ITEM-MULTI"))
    )[0];

    expect(row.hotelGroup).toBe("Arora, Radisson Hotels");
    expect(row.operatingGroupId).toBeNull();
    expect(row.kioskConfigGroupId).toBeNull();

    const groups = await ctx.db
      .select({ name: hotelGroups.name })
      .from(hotelGroups);
    const names = groups.map((g) => g.name).sort();
    expect(names).toEqual(["Arora", "Radisson Hotels"]);

    const memberships = await ctx.db
      .select({ hotelGroupId: locationHotelGroupMemberships.hotelGroupId })
      .from(locationHotelGroupMemberships)
      .where(eq(locationHotelGroupMemberships.locationId, row.id));
    expect(memberships).toHaveLength(2);
  });

  test("single-label hotel_group sets operating_group_id AND one membership", async () => {
    stubFetchOnce([HOTEL_FIXTURE_FULL]);

    await runInTx({
      mondayApiToken: TEST_TOKEN,
      resolveRegionIdByGroup: async () => ukRegionId,
      kioskConfigGroupByMondayLinkedId: new Map(),
    });

    const row = (
      await ctx.db
        .select()
        .from(locations)
        .where(eq(locations.mondayItemId, "ITEM-FULL"))
    )[0];
    expect(row.operatingGroupId).not.toBeNull();

    const groupRow = (
      await ctx.db
        .select()
        .from(hotelGroups)
        .where(eq(hotelGroups.id, row.operatingGroupId!))
    )[0];
    expect(groupRow.name).toBe("Marriott Group");

    const memberships = await ctx.db
      .select()
      .from(locationHotelGroupMemberships)
      .where(eq(locationHotelGroupMemberships.locationId, row.id));
    expect(memberships).toHaveLength(1);
    expect(memberships[0].hotelGroupId).toBe(groupRow.id);
  });

  test("ON CONFLICT path is fill-NULLs-only — operator UI edits survive", async () => {
    // First run lands the row with all metadata.
    stubFetchOnce([HOTEL_FIXTURE_FULL]);
    await runInTx({
      mondayApiToken: TEST_TOKEN,
      resolveRegionIdByGroup: async () => ukRegionId,
      kioskConfigGroupByMondayLinkedId: new Map(),
    });

    // Simulate an operator UI edit overriding Monday's value on a single
    // field. After the edit, Monday still says "Ron Vos"; the DB says
    // "Operator Override". Importer must preserve the override.
    await ctx.db
      .update(locations)
      .set({ keyContactName: "Operator Override" })
      .where(eq(locations.mondayItemId, "ITEM-FULL"));

    // Re-run against the same fixture.
    stubFetchOnce([HOTEL_FIXTURE_FULL]);
    const result = await runInTx({
      mondayApiToken: TEST_TOKEN,
      resolveRegionIdByGroup: async () => ukRegionId,
      kioskConfigGroupByMondayLinkedId: new Map(),
    });

    expect(result.locationsInserted).toBe(0);
    expect(result.locationsSkippedExisting).toBe(1);

    const row = (
      await ctx.db
        .select()
        .from(locations)
        .where(eq(locations.mondayItemId, "ITEM-FULL"))
    )[0];
    expect(row.keyContactName).toBe("Operator Override");
  });

  test("LocationValue without lat/lng populates address only", async () => {
    stubFetchOnce([HOTEL_FIXTURE_NO_LATLNG]);

    await runInTx({
      mondayApiToken: TEST_TOKEN,
      resolveRegionIdByGroup: async () => ukRegionId,
      kioskConfigGroupByMondayLinkedId: new Map(),
    });

    const row = (
      await ctx.db
        .select()
        .from(locations)
        .where(eq(locations.mondayItemId, "ITEM-NO-COORDS"))
    )[0];
    expect(row.address).toBe("Friar Street, Reading, UK");
    expect(row.latitude).toBeNull();
    expect(row.longitude).toBeNull();
  });

  test("unresolved SSM-Group link increments counter without failing", async () => {
    stubFetchOnce([HOTEL_FIXTURE_MULTI_GROUP]);

    const result = await runInTx({
      mondayApiToken: TEST_TOKEN,
      resolveRegionIdByGroup: async () => ukRegionId,
      kioskConfigGroupByMondayLinkedId: new Map(),
    });

    expect(result.kioskConfigGroupsUnresolved).toBe(1);
    expect(result.locationsInserted).toBe(1);

    const nullRows = await ctx.db
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.mondayItemId, "ITEM-MULTI"),
          isNull(locations.kioskConfigGroupId),
        ),
      );
    expect(nullRows).toHaveLength(1);
  });
});
