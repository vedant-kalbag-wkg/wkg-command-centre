/**
 * Enrich locations with hotel data from Monday.com hotel boards.
 *
 * The Monday.com "Live Estate", "Ready to Launch", "Removed", and
 * "Australia DCM" boards contain hotel details (name, address, contacts,
 * star rating, rooms, etc.). Each hotel's outlet code is mirrored from the
 * linked Assets board. This script:
 *
 *   1. Fetches all hotels from the 4 boards using typed GraphQL fragments
 *      to resolve mirror column values.
 *   2. Parses outlet codes from mirror9.display_value.
 *   3. Matches to existing locations by outletCode.
 *   4. Updates location fields (name, contacts, rooms, star rating, etc.)
 *
 * Idempotent: updates in-place, safe to re-run.
 *
 * Run: npm run db:enrich:locations
 */

import { db } from "@/db";
import {
  locations,
  hotelGroups,
  regions,
  locationGroups,
  locationHotelGroupMemberships,
  locationRegionMemberships,
  locationGroupMemberships,
  kioskConfigGroups,
} from "@/db/schema";
import { eq, sql } from "drizzle-orm";

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;

if (!MONDAY_API_TOKEN) {
  console.error("Missing MONDAY_API_TOKEN in .env.local");
  process.exit(1);
}

const HOTEL_BOARD_IDS = [1356570756, 1743012104, 5026387784, 5092887865];
const BOARD_NAMES: Record<number, string> = {
  1356570756: "Live Estate",
  1743012104: "Ready to Launch",
  5026387784: "Removed",
  5092887865: "Australia DCM",
};

function log(phase: string, msg: string) {
  console.log(`[${phase}] ${msg}`);
}

// ──────────────────────────────────────────────────────────────
// Monday.com GraphQL client
// ──────────────────────────────────────────────────────────────

async function mondayQuery(query: string): Promise<unknown> {
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        Authorization: MONDAY_API_TOKEN!,
        "Content-Type": "application/json",
        "API-Version": "2024-10",
      },
      body: JSON.stringify({ query }),
    });

    if (res.status === 429) {
      const wait = Math.pow(2, attempt) * 1000;
      log("RATE_LIMIT", `Retrying in ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    const json = (await res.json()) as {
      data?: unknown;
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join("; ");
      if (msg.includes("Rate limit") || msg.includes("complexity")) {
        const wait = Math.pow(2, attempt) * 1000;
        log("RATE_LIMIT", `Complexity limit, retrying in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`Monday.com GraphQL error: ${msg}`);
    }

    return json.data;
  }
  throw new Error("Monday.com API: max retries exceeded");
}

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface HotelItem {
  id: string;
  name: string;
  boardId: number;
  outletCodes: string[];
  hotelGroup: string | null;
  launchPhase: string | null;
  status: string | null;
  liveDate: string | null;
  keyContactName: string | null;
  keyContactEmail: string | null;
  financeContact: string | null;
  maintenanceFee: string | null;
  freeTrialEndDate: string | null;
  numRooms: number | null;
  starRating: number | null;
  hotelAddress: string | null;
  region: string | null;
  locationGroup: string | null;
  sourcedBy: string | null;
  notes: string | null;
  // SSM config group name resolved via the Live Estate board's
  // link_to_ssm_groups__1 board_relation column (points to SSM Groups
  // board 1466686598, where each item is a named config group such as
  // "LDNC1 (All products)" or "Leonardo Royal Hotels").
  configGroupName: string | null;
}

// ──────────────────────────────────────────────────────────────
// Fetch all hotels from all boards
// ──────────────────────────────────────────────────────────────

async function fetchAllHotels(): Promise<HotelItem[]> {
  const allHotels: HotelItem[] = [];

  for (const boardId of HOTEL_BOARD_IDS) {
    log("FETCH", `Fetching board ${BOARD_NAMES[boardId]} (${boardId})...`);

    let cursor: string | null = null;
    let firstPage = true;
    let boardCount = 0;

    while (true) {
      let query: string;
      const columnFragment = `
        column_values {
          id text type
          ... on MirrorValue { display_value }
          ... on StatusValue { text }
          ... on DropdownValue { text }
          ... on NumbersValue { text }
          ... on RatingValue { text }
          ... on DateValue { text }
          ... on LocationValue { text }
          ... on EmailValue { text }
          ... on LongTextValue { text }
          ... on CheckboxValue { text }
          ... on BoardRelationValue { display_value }
        }
      `;

      if (firstPage) {
        query = `{ boards(ids: [${boardId}]) { items_page(limit: 500) { cursor items { id name group { title } ${columnFragment} } } } }`;
      } else {
        query = `{ next_items_page(limit: 500, cursor: "${cursor}") { cursor items { id name group { title } ${columnFragment} } } }`;
      }

      const data = (await mondayQuery(query)) as Record<string, unknown>;

      interface PageShape {
        cursor: string | null;
        items: Array<{
          id: string;
          name: string;
          group?: { title: string };
          column_values: Array<{
            id: string;
            text: string | null;
            type: string;
            display_value?: string;
          }>;
        }>;
      }

      let page: PageShape;
      if (firstPage) {
        const boards = (
          data as { boards: Array<{ items_page: PageShape }> }
        ).boards;
        page = boards[0].items_page;
      } else {
        page = (data as { next_items_page: PageShape }).next_items_page;
      }

      for (const item of page.items) {
        const cols = new Map(
          item.column_values.map((cv) => [cv.id, cv])
        );

        // Parse outlet codes from mirror9 display_value
        const mirrorCol = cols.get("mirror9");
        const outletCodes: string[] = [];
        const displayVal =
          mirrorCol?.display_value ?? mirrorCol?.text ?? null;
        if (displayVal) {
          for (const code of displayVal.split(",")) {
            const trimmed = code.trim();
            if (trimmed) outletCodes.push(trimmed);
          }
        }

        const getText = (id: string) => {
          const c = cols.get(id);
          return c?.text?.trim() || c?.display_value?.trim() || null;
        };

        const numRoomsText = getText("number_of_rooms");
        const ratingText = getText("rating__1");

        // Resolve the SSM config group. For board_relation columns Monday
        // returns the linked item's name via text/display_value. Take the
        // first if multiple are linked (groups are single-assignment in
        // practice; multiple would imply config ambiguity we can't resolve).
        const groupText = getText("link_to_ssm_groups__1");
        const configGroupName = groupText
          ? groupText.split(",")[0].trim() || null
          : null;

        allHotels.push({
          id: item.id,
          name: item.name,
          boardId,
          outletCodes,
          hotelGroup: getText("group0"),
          launchPhase: getText("status_17"),
          status: getText("status"),
          liveDate: getText("live_date"),
          keyContactName: getText("key_contact_name"),
          keyContactEmail: getText("key_contact_email"),
          financeContact: getText("finance_contact1"),
          maintenanceFee: getText("numbers__1"),
          freeTrialEndDate: getText("date9"),
          numRooms: numRoomsText ? parseInt(numRoomsText, 10) || null : null,
          starRating: ratingText ? parseInt(ratingText, 10) || null : null,
          hotelAddress: getText("location"),
          region: getText("color_mkttv13g"),
          locationGroup: getText("status_11"),
          sourcedBy: getText("label8__1"),
          notes: getText("long_text__1"),
          configGroupName,
        });
      }

      boardCount += page.items.length;
      firstPage = false;
      if (!page.cursor || page.items.length === 0) break;
      cursor = page.cursor;
    }

    log("FETCH", `  ${BOARD_NAMES[boardId]}: ${boardCount} hotels`);
  }

  log("FETCH", `Total hotels fetched: ${allHotels.length}`);
  return allHotels;
}

// ──────────────────────────────────────────────────────────────
// Enrich locations
// ──────────────────────────────────────────────────────────────

async function enrichLocations(hotels: HotelItem[]) {
  log("ENRICH", "Starting location enrichment...");

  // Build outlet code → hotel mapping
  const outletToHotel = new Map<string, HotelItem>();
  let multipleOutlets = 0;
  for (const hotel of hotels) {
    for (const code of hotel.outletCodes) {
      if (!outletToHotel.has(code)) {
        outletToHotel.set(code, hotel);
      }
    }
    if (hotel.outletCodes.length > 1) multipleOutlets++;
  }
  log(
    "ENRICH",
    `Mapped ${outletToHotel.size} outlet codes from ${hotels.length} hotels (${multipleOutlets} hotels have multiple kiosks)`
  );

  // Load existing hotel group/region/location group lookups
  const hgRows = await db
    .select({ id: hotelGroups.id, name: hotelGroups.name })
    .from(hotelGroups);
  const hgMap = new Map(hgRows.map((r) => [r.name, r.id]));

  const regRows = await db
    .select({ id: regions.id, name: regions.name })
    .from(regions);
  const regMap = new Map(regRows.map((r) => [r.name, r.id]));

  const lgRows = await db
    .select({ id: locationGroups.id, name: locationGroups.name })
    .from(locationGroups);
  const lgMap = new Map(lgRows.map((r) => [r.name, r.id]));

  const kcgRows = await db
    .select({ id: kioskConfigGroups.id, name: kioskConfigGroups.name })
    .from(kioskConfigGroups);
  const kcgMap = new Map(kcgRows.map((r) => [r.name, r.id]));

  // Load all locations
  const allLocs = await db
    .select({
      id: locations.id,
      name: locations.name,
      outletCode: locations.outletCode,
      address: locations.address,
    })
    .from(locations);

  let updated = 0;
  let skippedNoMatch = 0;
  let enrichedStubs = 0;
  let enrichedExisting = 0;
  let addressMissing = 0;
  let addressBackfilled = 0;
  let configGroupLinked = 0;
  let configGroupMissing = 0;

  for (const loc of allLocs) {
    if (!loc.outletCode) continue;

    const hotel = outletToHotel.get(loc.outletCode);
    if (!hotel) {
      skippedNoMatch++;
      continue;
    }

    const isStub = loc.name === loc.outletCode;

    // Build update values
    const updateValues: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    // Always update name if it's a stub
    if (isStub) {
      updateValues.name = hotel.name;
      enrichedStubs++;
    } else {
      enrichedExisting++;
    }

    // Update fields that are currently empty
    if (hotel.hotelGroup) updateValues.hotelGroup = hotel.hotelGroup;
    if (hotel.region) updateValues.region = hotel.region;
    if (hotel.locationGroup) updateValues.locationGroup = hotel.locationGroup;
    if (hotel.numRooms) updateValues.numRooms = hotel.numRooms;
    if (hotel.starRating) updateValues.starRating = hotel.starRating;
    if (hotel.hotelAddress) updateValues.hotelAddress = hotel.hotelAddress;
    // /locations reads from locations.address (not hotelAddress). Mirror
    // Monday's address value into `address` when it is still NULL so the
    // locations list UI surfaces it. Don't overwrite an existing address.
    if (hotel.hotelAddress && !loc.address) {
      updateValues.address = hotel.hotelAddress;
      addressBackfilled++;
    }
    if (hotel.liveDate) updateValues.liveDate = new Date(hotel.liveDate);
    if (hotel.launchPhase) updateValues.launchPhase = hotel.launchPhase;
    if (hotel.keyContactName)
      updateValues.keyContactName = hotel.keyContactName;
    if (hotel.keyContactEmail)
      updateValues.keyContactEmail = hotel.keyContactEmail;
    if (hotel.financeContact)
      updateValues.financeContact = hotel.financeContact;
    if (hotel.maintenanceFee && hotel.maintenanceFee !== "0")
      updateValues.maintenanceFee = hotel.maintenanceFee;
    if (hotel.freeTrialEndDate)
      updateValues.freeTrialEndDate = new Date(hotel.freeTrialEndDate);
    if (hotel.sourcedBy) updateValues.sourcedBy = hotel.sourcedBy;
    if (hotel.notes) updateValues.notes = hotel.notes;
    if (hotel.status) updateValues.status = hotel.status;

    await db
      .update(locations)
      .set(updateValues)
      .where(eq(locations.id, loc.id));
    updated++;

    // Structured audit log: surface outlets that still have no address after
    // we've matched them to a Monday hotel row. Helps identify whether the
    // Monday "Location" column is genuinely empty or sitting in a different
    // column we aren't yet reading.
    const finalAddress = (updateValues.address as string | undefined) ?? loc.address ?? null;
    if (!finalAddress) {
      addressMissing++;
      log(
        "MONDAY-ENRICH",
        `outlet=${loc.outletCode} name="${loc.name}" mondayItemId=${hotel.id} missing: address=null (Monday 'location' column empty)`,
      );
    }

    // Attach kiosk config group via the Live Estate's SSM Group relation.
    // Each hotel has one group; we upsert kiosk_config_groups by name and
    // set locations.kiosk_config_group_id. A hotel with no group link just
    // leaves the FK null (rendered as "Unassigned" in the UI).
    if (hotel.configGroupName) {
      let kcgId = kcgMap.get(hotel.configGroupName);
      if (!kcgId) {
        const [row] = await db
          .insert(kioskConfigGroups)
          .values({ name: hotel.configGroupName })
          .onConflictDoNothing({ target: kioskConfigGroups.name })
          .returning({ id: kioskConfigGroups.id });
        if (row) {
          kcgId = row.id;
        } else {
          const [existing] = await db
            .select({ id: kioskConfigGroups.id })
            .from(kioskConfigGroups)
            .where(eq(kioskConfigGroups.name, hotel.configGroupName))
            .limit(1);
          kcgId = existing?.id;
        }
        if (kcgId) kcgMap.set(hotel.configGroupName, kcgId);
      }
      if (kcgId) {
        await db
          .update(locations)
          .set({ kioskConfigGroupId: kcgId, updatedAt: new Date() })
          .where(eq(locations.id, loc.id));
        configGroupLinked++;
      }
    } else {
      configGroupMissing++;
    }

    // Create dimension memberships if hotel group/region/location group exist
    if (hotel.hotelGroup) {
      let hgId = hgMap.get(hotel.hotelGroup);
      if (!hgId) {
        const [row] = await db
          .insert(hotelGroups)
          .values({ name: hotel.hotelGroup })
          .onConflictDoNothing({ target: hotelGroups.name })
          .returning({ id: hotelGroups.id });
        if (row) {
          hgId = row.id;
          hgMap.set(hotel.hotelGroup, hgId);
        } else {
          const [existing] = await db
            .select({ id: hotelGroups.id })
            .from(hotelGroups)
            .where(eq(hotelGroups.name, hotel.hotelGroup));
          hgId = existing?.id;
          if (hgId) hgMap.set(hotel.hotelGroup, hgId);
        }
      }
      if (hgId) {
        await db
          .insert(locationHotelGroupMemberships)
          .values({ locationId: loc.id, hotelGroupId: hgId })
          .onConflictDoNothing();
      }
    }

    if (hotel.region) {
      let regId = regMap.get(hotel.region);
      if (!regId) {
        const [row] = await db
          .insert(regions)
          .values({ name: hotel.region })
          .onConflictDoNothing({ target: regions.name })
          .returning({ id: regions.id });
        if (row) {
          regId = row.id;
          regMap.set(hotel.region, regId);
        } else {
          const [existing] = await db
            .select({ id: regions.id })
            .from(regions)
            .where(eq(regions.name, hotel.region));
          regId = existing?.id;
          if (regId) regMap.set(hotel.region, regId);
        }
      }
      if (regId) {
        await db
          .insert(locationRegionMemberships)
          .values({ locationId: loc.id, regionId: regId })
          .onConflictDoNothing();
      }
    }

    if (hotel.locationGroup) {
      let lgId = lgMap.get(hotel.locationGroup);
      if (!lgId) {
        const [row] = await db
          .insert(locationGroups)
          .values({ name: hotel.locationGroup })
          .onConflictDoNothing({ target: locationGroups.name })
          .returning({ id: locationGroups.id });
        if (row) {
          lgId = row.id;
          lgMap.set(hotel.locationGroup, lgId);
        } else {
          const [existing] = await db
            .select({ id: locationGroups.id })
            .from(locationGroups)
            .where(eq(locationGroups.name, hotel.locationGroup));
          lgId = existing?.id;
          if (lgId) lgMap.set(hotel.locationGroup, lgId);
        }
      }
      if (lgId) {
        await db
          .insert(locationGroupMemberships)
          .values({ locationId: loc.id, locationGroupId: lgId })
          .onConflictDoNothing();
      }
    }

    if (updated % 50 === 0) {
      log("ENRICH", `Progress: ${updated} locations updated...`);
    }
  }

  log(
    "ENRICH",
    `Done: ${updated} updated (${enrichedStubs} stubs renamed, ${enrichedExisting} existing enriched), ${skippedNoMatch} no Monday.com match`
  );
  log(
    "ENRICH",
    `Address backfills: ${addressBackfilled} (mirrored hotelAddress → address); still missing address: ${addressMissing}`,
  );
  log(
    "ENRICH",
    `Config groups linked: ${configGroupLinked}; hotels with no SSM Group on Live Estate: ${configGroupMissing}`,
  );
}

// ──────────────────────────────────────────────────────────────
// Verification
// ──────────────────────────────────────────────────────────────

async function verify() {
  log("VERIFY", "Running verification...");

  const totalLocs = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(locations);
  log("VERIFY", `Total locations: ${totalLocs[0].c}`);

  const stubs = await db.execute(sql`
    SELECT count(*)::int AS c FROM locations WHERE name = outlet_code
  `) as unknown as Array<{ c: number }>;
  log("VERIFY", `Remaining stub locations (name=outletCode): ${stubs[0]?.c ?? 0}`);

  const withNames = await db.execute(sql`
    SELECT count(*)::int AS c FROM locations WHERE name != outlet_code AND outlet_code IS NOT NULL
  `) as unknown as Array<{ c: number }>;
  log("VERIFY", `Locations with proper names: ${withNames[0]?.c ?? 0}`);

  const withContacts = await db.execute(sql`
    SELECT count(*)::int AS c FROM locations WHERE key_contact_name IS NOT NULL
  `) as unknown as Array<{ c: number }>;
  log("VERIFY", `Locations with key contacts: ${withContacts[0]?.c ?? 0}`);

  const withRooms = await db.execute(sql`
    SELECT count(*)::int AS c FROM locations WHERE num_rooms IS NOT NULL AND num_rooms > 0
  `) as unknown as Array<{ c: number }>;
  log("VERIFY", `Locations with room counts: ${withRooms[0]?.c ?? 0}`);

  // Show sample of enriched stubs
  const samples = await db.execute(sql`
    SELECT name, outlet_code, hotel_group, region, num_rooms, star_rating
    FROM locations
    WHERE outlet_code IS NOT NULL AND name != outlet_code
    AND (hotel_group IS NOT NULL OR region IS NOT NULL)
    ORDER BY name
    LIMIT 10
  `) as unknown as Array<Record<string, unknown>>;
  log("VERIFY", "Sample enriched locations:");
  for (const s of samples) {
    log(
      "VERIFY",
      `  ${s.outlet_code} → ${s.name} | ${s.hotel_group ?? ""} | ${s.region ?? ""} | ${s.num_rooms ?? ""} rooms | ${s.star_rating ?? ""}★`
    );
  }

  log("VERIFY", "DONE");
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Monday.com Hotel → Location Enrichment ===\n");
  const hotels = await fetchAllHotels();
  await enrichLocations(hotels);
  await verify();
  console.log("\n=== Enrichment complete ===");
}

main().catch((err) => {
  console.error("Enrichment failed:", err);
  process.exit(1);
});
