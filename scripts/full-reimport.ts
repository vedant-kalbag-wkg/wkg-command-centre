/**
 * Full data re-import from Monday.com.
 *
 * Methodology:
 *   1. Fetch hotels from BOTH hotels boards (Live Estate + Australia DCM) → create locations
 *   2. Fetch kiosks (assets) from the Assets/Kiosks board → create kiosks
 *   3. Link kiosks to hotels via the board_relation on either side
 *
 * Wipes all existing kiosks, locations, assignments, products, providers,
 * and location_products before importing (TRUNCATE CASCADE).
 *
 * Run with:
 *   npx tsx scripts/full-reimport.ts
 */

import postgres from "postgres";

const DB_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres.bsotczfyqhhoshawcugw:~872740B7FC@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres";
const MONDAY_TOKEN =
  process.env.MONDAY_API_TOKEN ??
  "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjYxNzQyMzQwMywiYWFpIjoxMSwidWlkIjo1MzQzMzc4MywiaWFkIjoiMjAyNi0wMi0wNVQxMToyMDo0Ny4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MjAzNzc3OTksInJnbiI6ImV1YzEifQ.njQkuEWRtFxt9InyNvgkRqbDQGjHHH8GDFm6oMkqe3M";

const KIOSKS_BOARD_ID = "1426737864";
const HOTELS_BOARD_IDS = ["1356570756", "5092887865"]; // Live Estate, Australia DCM
const CONFIG_GROUPS_BOARD_ID = "1466686598";

interface ColumnValue {
  id: string;
  text: string | null;
  value: string | null;
  type: string;
  display_value?: string | null;
  linked_item_ids?: string[];
}

interface MondayItem {
  id: string;
  name: string;
  column_values: ColumnValue[];
}

// ---------------------------------------------------------------------------
// Monday.com client
// ---------------------------------------------------------------------------

async function mondayQuery<T = unknown>(query: string): Promise<T> {
  const res = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: { Authorization: MONDAY_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`Monday API error: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

const ITEM_FIELDS = `
  id name
  column_values {
    id text value type
    ... on MirrorValue { display_value }
    ... on BoardRelationValue { linked_item_ids }
    ... on DependencyValue { linked_item_ids }
  }
`;

async function fetchAllItems(boardId: string): Promise<MondayItem[]> {
  const all: MondayItem[] = [];
  let cursor: string | null = null;

  while (true) {
    const q = cursor
      ? `{ next_items_page(limit: 500, cursor: "${cursor}") { cursor items { ${ITEM_FIELDS} } } }`
      : `{ boards(ids: ${boardId}) { items_page(limit: 500) { cursor items { ${ITEM_FIELDS} } } } }`;

    type PageShape = { cursor: string | null; items: MondayItem[] };
    const data = (await mondayQuery(q)) as {
      boards?: Array<{ items_page: PageShape }>;
      next_items_page?: PageShape;
    };

    const page: PageShape = cursor ? data.next_items_page! : data.boards![0].items_page;
    all.push(...page.items);
    cursor = page.cursor;
    if (!cursor) break;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Column value helpers
// ---------------------------------------------------------------------------

function cvText(item: MondayItem, colId: string): string | null {
  const cv = item.column_values.find((c) => c.id === colId);
  if (!cv) return null;
  // Mirror columns use display_value
  if (cv.type === "mirror" && cv.display_value) return cv.display_value;
  if (cv.text) return cv.text;
  return null;
}

function cvLinkedIds(item: MondayItem, colId: string): string[] {
  const cv = item.column_values.find((c) => c.id === colId);
  return cv?.linked_item_ids ?? [];
}

function cvNumber(item: MondayItem, colId: string): number | null {
  const t = cvText(item, colId);
  if (!t) return null;
  const n = parseFloat(t.replace(/[^\d.-]/g, ""));
  return isNaN(n) ? null : n;
}

function cvInt(item: MondayItem, colId: string): number | null {
  const n = cvNumber(item, colId);
  return n === null ? null : Math.round(n);
}

function cvDate(item: MondayItem, colId: string): Date | null {
  const cv = item.column_values.find((c) => c.id === colId);
  if (!cv) return null;
  try {
    const v = cv.value ? JSON.parse(cv.value) : null;
    const dateStr = v?.date ?? cv.text;
    if (!dateStr) return null;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function cvBool(item: MondayItem, colId: string): boolean {
  const cv = item.column_values.find((c) => c.id === colId);
  if (!cv?.value) return false;
  try {
    const v = JSON.parse(cv.value);
    return v?.checked === true || v?.checked === "true";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const sql = postgres(DB_URL, { max: 3, idle_timeout: 10, connect_timeout: 15 });

  try {
    // --- Step 0: Wipe existing data ---
    console.log("\n[0/4] Wiping existing data…");
    await sql.unsafe(
      `TRUNCATE TABLE location_products, installation_kiosks, kiosk_assignments, kiosks, locations, products, providers CASCADE`
    );
    console.log("      Cleared kiosks, locations, assignments, products, providers, location_products");

    // Ensure default pipeline stages exist
    const existingStages = await sql`SELECT id, name FROM pipeline_stages`;
    const stageMap = new Map<string, string>();
    for (const s of existingStages) stageMap.set(s.name as string, s.id as string);
    console.log("      Found", stageMap.size, "existing pipeline stages");

    // --- Step 1: Fetch hotels from both boards ---
    console.log("\n[1/4] Fetching hotels from both boards…");
    const hotelsByBoard: Record<string, MondayItem[]> = {};
    for (const boardId of HOTELS_BOARD_IDS) {
      const items = await fetchAllItems(boardId);
      hotelsByBoard[boardId] = items;
      console.log(`      Board ${boardId}: ${items.length} hotels`);
    }
    const allHotels = Object.values(hotelsByBoard).flat();
    console.log(`      Total: ${allHotels.length} hotels across both boards`);

    // Build a map: hotel Monday ID → our location data
    // Hotels board column IDs (identical on both boards):
    //   group0           Hotel Group (dropdown)
    //   status           Status (status)
    //   color_mkttv13g   Region (status)
    //   status_11        Location Group (status) — only on Live Estate
    //   number_of_rooms  Hotel's Number of Rooms
    //   rating__1        Hotel Star Rating
    //   location         Hotel Address
    //   label8__1        Sourced by
    //   key_contact_name Key Contact Name
    //   key_contact_email Key Contact Email
    //   email__1         Additional Contact Email
    //   finance_contact1 Finance Contact
    //   numbers__1       Maintenance Fee (ex VAT)
    //   date9            Free Trial End Date
    //   live_date        Live Date
    //   connect_boards5  Assets (board_relation → kiosks board)
    //   mirror9          Outlet Code (mirror from assets)
    //   mirror3__1       Cust_cd (mirror from assets)
    //   long_text__1     Notes
    //   checkbox4__1     CMS Config

    type LocData = {
      name: string;
      address: string | null;
      starRating: number | null;
      roomCount: number | null;
      hotelGroup: string | null;
      region: string | null;
      locationGroup: string | null;
      sourcedBy: string | null;
      status: string | null;
      maintenanceFee: string | null;
      customerCode: string | null;
      keyContacts: Array<{ name: string; role: string; email: string; phone: string }> | null;
      freeTrialEndDate: Date | null;
      notes: string | null;
      mondayHotelIds: string[]; // Monday.com IDs this location was built from
      linkedAssetIds: string[]; // Monday.com kiosk IDs linked via Assets column
    };

    // Group hotels by name (dedup across boards)
    const locByName = new Map<string, LocData>();

    for (const hotel of allHotels) {
      const name = hotel.name.trim();
      if (!name) continue;

      const existing = locByName.get(name);

      // Collect linked assets
      const linkedAssets = cvLinkedIds(hotel, "connect_boards5");

      // Collect contacts
      const contactName = cvText(hotel, "key_contact_name");
      const contactEmail = cvText(hotel, "key_contact_email");
      const additionalEmail = cvText(hotel, "email__1");
      const financeContact = cvText(hotel, "finance_contact1");
      const contacts: LocData["keyContacts"] = [];
      if (contactName || contactEmail) {
        contacts.push({
          name: contactName || "",
          role: "Key Contact",
          email: contactEmail || "",
          phone: "",
        });
      }
      if (additionalEmail) {
        contacts.push({ name: "", role: "Additional Contact", email: additionalEmail, phone: "" });
      }
      if (financeContact) {
        contacts.push({ name: financeContact, role: "Finance Contact", email: "", phone: "" });
      }

      // Customer code: pick first non-comma value from mirrored
      const custCdRaw = cvText(hotel, "mirror3__1");
      const customerCode = custCdRaw
        ? custCdRaw.split(",").map((c) => c.trim()).filter(Boolean)[0] ?? null
        : null;

      const data: LocData = {
        name,
        address: cvText(hotel, "location"),
        starRating: cvInt(hotel, "rating__1"),
        roomCount: cvInt(hotel, "number_of_rooms"),
        hotelGroup: cvText(hotel, "group0"),
        region: cvText(hotel, "color_mkttv13g"),
        locationGroup: cvText(hotel, "status_11"),
        sourcedBy: cvText(hotel, "label8__1"),
        status: cvText(hotel, "status"),
        maintenanceFee: (() => {
          const n = cvNumber(hotel, "numbers__1");
          return n === null ? null : String(n);
        })(),
        customerCode,
        keyContacts: contacts.length > 0 ? contacts : null,
        freeTrialEndDate: cvDate(hotel, "date9"),
        notes: cvText(hotel, "long_text__1"),
        mondayHotelIds: [hotel.id],
        linkedAssetIds: linkedAssets,
      };

      if (!existing) {
        locByName.set(name, data);
      } else {
        // Merge — existing wins for non-null fields; append asset IDs and Monday IDs
        existing.mondayHotelIds.push(hotel.id);
        existing.linkedAssetIds.push(...linkedAssets);
        for (const k of Object.keys(data) as Array<keyof LocData>) {
          if (k === "mondayHotelIds" || k === "linkedAssetIds") continue;
          // @ts-expect-error dynamic assign
          if (existing[k] == null && data[k] != null) existing[k] = data[k];
        }
      }
    }
    console.log(`      Deduped to ${locByName.size} unique locations`);

    // --- Step 2: Insert locations ---
    console.log("\n[2/4] Inserting locations…");
    const locationIdByMondayHotelId = new Map<string, string>();
    const locationIdByName = new Map<string, string>();
    let locInserted = 0;
    for (const loc of locByName.values()) {
      const [row] = await sql`
        INSERT INTO locations (
          name, address, star_rating, room_count, hotel_group,
          region, location_group, sourced_by, status, maintenance_fee,
          customer_code, key_contacts, free_trial_end_date, notes
        ) VALUES (
          ${loc.name}, ${loc.address}, ${loc.starRating}, ${loc.roomCount}, ${loc.hotelGroup},
          ${loc.region}, ${loc.locationGroup}, ${loc.sourcedBy}, ${loc.status}, ${loc.maintenanceFee},
          ${loc.customerCode}, ${loc.keyContacts as unknown as string}, ${loc.freeTrialEndDate}, ${loc.notes}
        )
        RETURNING id
      `;
      locationIdByName.set(loc.name, row.id as string);
      for (const mid of loc.mondayHotelIds) {
        locationIdByMondayHotelId.set(mid, row.id as string);
      }
      locInserted++;
    }
    console.log(`      Inserted ${locInserted} locations`);

    // Build asset monday ID → location DB UUID map (via hotels' linked assets)
    const locationByAssetMondayId = new Map<string, string>();
    for (const loc of locByName.values()) {
      const dbId = locationIdByName.get(loc.name)!;
      for (const assetMid of loc.linkedAssetIds) {
        if (!locationByAssetMondayId.has(assetMid)) {
          locationByAssetMondayId.set(assetMid, dbId);
        }
      }
    }
    console.log(`      Built asset→location map with ${locationByAssetMondayId.size} entries`);

    // --- Step 3: Fetch kiosks and insert ---
    console.log("\n[3/4] Fetching kiosks from assets board…");
    const kioskItems = await fetchAllItems(KIOSKS_BOARD_ID);
    console.log(`      Fetched ${kioskItems.length} kiosks`);

    // Kiosks board columns:
    //   outlet_code1     Outlet Code (text)
    //   text9            Cust_cd
    //   text3            ADN
    //   text1            Credential
    //   label3           Make/Model (status)
    //   color            Current Location (status)
    //   status_1         Config Status (status)
    //   label            Network (status)
    //   label9           Condition (status)
    //   label93          Age (status)
    //   checkbox2        SSM Config (checkbox)
    //   checkbox8        PDQ Config (checkbox)
    //   checkbox1__1     SSM24 Ready (checkbox)
    //   checkbox0        DB Config (checkbox)
    //   link_to_hotel_ssms   Hotel (board_relation → hotels)
    //   mirror_1         Installation Schedule (mirror)
    //   mirror           Launch Status (mirror — pipeline stage!)

    // Helper — ensure a pipeline stage exists, return its id
    async function ensureStage(name: string): Promise<string | null> {
      if (!name) return null;
      if (stageMap.has(name)) return stageMap.get(name)!;
      const [maxRow] = await sql`SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM pipeline_stages`;
      const [row] = await sql`
        INSERT INTO pipeline_stages (name, color, position, is_default)
        VALUES (${name}, ${"#6b7280"}, ${maxRow.pos}, false)
        RETURNING id
      `;
      stageMap.set(name, row.id as string);
      return row.id as string;
    }

    const kioskRecords: Array<{
      kioskId: string;
      hardwareSerialNumber: string;
      outletCode: string | null;
      hardwareModel: string | null;
      cmsConfigStatus: string | null;
      pipelineStageId: string | null;
      notes: string | null;
      linkedHotelIds: string[];
    }> = [];

    for (const item of kioskItems) {
      const outletCodeRaw = cvText(item, "outlet_code1") ?? "";
      const outletCodes = outletCodeRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const uniqueOutletCodes = [...new Set(outletCodes)];

      const make = cvText(item, "label3");
      const config = cvText(item, "status_1");
      const launchStatus = cvText(item, "mirror") ?? "";
      const stageId = launchStatus ? await ensureStage(launchStatus) : null;

      const linkedHotels = cvLinkedIds(item, "link_to_hotel_ssms");

      // Collect extra data as notes
      const extras: string[] = [];
      for (const [k, label] of [
        ["text9", "Cust_cd"],
        ["text3", "ADN"],
        ["text1", "Credential"],
        ["label", "Network"],
        ["label9", "Condition"],
        ["label93", "Age"],
      ] as const) {
        const v = cvText(item, k);
        if (v) extras.push(`${label}: ${v}`);
      }
      const ssmConfig = cvBool(item, "checkbox2");
      const pdqConfig = cvBool(item, "checkbox8");
      const ssm24Ready = cvBool(item, "checkbox1__1");
      const dbConfig = cvBool(item, "checkbox0");
      extras.push(`SSM Config: ${ssmConfig}`);
      extras.push(`PDQ Config: ${pdqConfig}`);
      extras.push(`SSM24 Ready: ${ssm24Ready}`);
      extras.push(`DB Config: ${dbConfig}`);
      const notes = extras.join("\n");

      // One record per unique outlet code — OR one record if no outlet code
      if (uniqueOutletCodes.length === 0) {
        kioskRecords.push({
          kioskId: item.name,
          hardwareSerialNumber: item.name,
          outletCode: null,
          hardwareModel: make,
          cmsConfigStatus: config,
          pipelineStageId: stageId,
          notes,
          linkedHotelIds: linkedHotels,
        });
      } else {
        for (const code of uniqueOutletCodes) {
          kioskRecords.push({
            kioskId: uniqueOutletCodes.length > 1 ? `${code}-${item.name}` : code,
            hardwareSerialNumber: item.name,
            outletCode: code,
            hardwareModel: make,
            cmsConfigStatus: config,
            pipelineStageId: stageId,
            notes,
            linkedHotelIds: linkedHotels,
          });
        }
      }
    }
    console.log(`      Prepared ${kioskRecords.length} kiosk records (split by outlet code)`);

    // Dedup kiosk_id conflicts — append suffix
    const seenIds = new Set<string>();
    for (const k of kioskRecords) {
      let id = k.kioskId;
      let i = 2;
      while (seenIds.has(id)) {
        id = `${k.kioskId}-${i}`;
        i++;
      }
      k.kioskId = id;
      seenIds.add(id);
    }

    // Insert kiosks
    const kioskDbIds: Array<{ dbId: string; linkedHotelIds: string[]; assetMondayId?: string }> = [];
    let kioskInserted = 0;
    for (const k of kioskRecords) {
      const [row] = await sql`
        INSERT INTO kiosks (
          kiosk_id, hardware_serial_number, outlet_code, hardware_model,
          cms_config_status, pipeline_stage_id, notes
        ) VALUES (
          ${k.kioskId}, ${k.hardwareSerialNumber}, ${k.outletCode}, ${k.hardwareModel},
          ${k.cmsConfigStatus}, ${k.pipelineStageId}, ${k.notes}
        )
        RETURNING id
      `;
      kioskDbIds.push({ dbId: row.id as string, linkedHotelIds: k.linkedHotelIds });
      kioskInserted++;
    }
    console.log(`      Inserted ${kioskInserted} kiosks`);

    // --- Step 4: Link kiosks to locations ---
    console.log("\n[4/4] Creating kiosk assignments…");

    // First, build a map from kiosk monday id → all outlet-code kiosk db ids
    // (one kiosk item may produce multiple DB rows after outlet split)
    const kioskMondayIdByItemPos = new Map<number, string>();
    kioskItems.forEach((item, idx) => kioskMondayIdByItemPos.set(idx, item.id));

    const assignments: Array<{ kioskDbId: string; locationId: string }> = [];
    let linkViaKiosk = 0;
    let linkViaHotel = 0;

    // Link via kiosk→hotel relation (preferred)
    let recordIdx = 0;
    for (const item of kioskItems) {
      const outletCodeRaw = cvText(item, "outlet_code1") ?? "";
      const uniqueCodes = [
        ...new Set(outletCodeRaw.split(",").map((s) => s.trim()).filter(Boolean)),
      ];
      const recordCount = uniqueCodes.length === 0 ? 1 : uniqueCodes.length;
      const linkedHotels = cvLinkedIds(item, "link_to_hotel_ssms");

      for (let j = 0; j < recordCount; j++) {
        const rec = kioskDbIds[recordIdx + j];
        if (!rec) continue;
        // Prefer kiosk→hotel relation
        for (const hotelMid of linkedHotels) {
          const locId = locationIdByMondayHotelId.get(hotelMid);
          if (locId) {
            assignments.push({ kioskDbId: rec.dbId, locationId: locId });
            linkViaKiosk++;
            break;
          }
        }
        // Fallback — hotel→asset reverse relation
        if (!assignments.find((a) => a.kioskDbId === rec.dbId)) {
          const locId = locationByAssetMondayId.get(item.id);
          if (locId) {
            assignments.push({ kioskDbId: rec.dbId, locationId: locId });
            linkViaHotel++;
          }
        }
      }
      recordIdx += recordCount;
    }

    // Insert assignments (dedup per kiosk — one current assignment per kiosk)
    const seenKioskDbIds = new Set<string>();
    let assignmentsInserted = 0;
    for (const a of assignments) {
      if (seenKioskDbIds.has(a.kioskDbId)) continue;
      seenKioskDbIds.add(a.kioskDbId);
      await sql`
        INSERT INTO kiosk_assignments (kiosk_id, location_id, assigned_by, assigned_by_name)
        VALUES (${a.kioskDbId}, ${a.locationId}, 'system', 'Full reimport')
      `;
      assignmentsInserted++;
    }
    console.log(
      `      Linked ${assignmentsInserted} assignments (${linkViaKiosk} via kiosk→hotel, ${linkViaHotel} via hotel→asset)`
    );

    // --- Step 4b: Backfill kiosk.region_group from assigned location.region ---
    console.log("\n[4b] Backfilling kiosk region from assigned location…");
    const regionUpdated = await sql`
      UPDATE kiosks k
      SET region_group = sub.region, updated_at = NOW()
      FROM (
        SELECT ka.kiosk_id, l.region
        FROM kiosk_assignments ka
        JOIN locations l ON l.id = ka.location_id
        WHERE ka.unassigned_at IS NULL AND l.region IS NOT NULL AND l.region != ''
      ) sub
      WHERE k.id = sub.kiosk_id
        AND k.archived_at IS NULL
        AND (k.region_group IS NULL OR k.region_group = '')
      RETURNING k.id
    `;
    console.log(`      Set region on ${regionUpdated.length} kiosks`);

    // --- Final stats ---
    console.log("\n=== Final column fill rates ===");
    const kStats = await sql`
      SELECT
        COUNT(*) FILTER (WHERE hardware_serial_number IS NOT NULL) AS asset,
        COUNT(*) FILTER (WHERE outlet_code IS NOT NULL) AS outlet,
        COUNT(*) FILTER (WHERE region_group IS NOT NULL) AS region,
        COUNT(*) FILTER (WHERE pipeline_stage_id IS NOT NULL) AS stage,
        COUNT(*) FILTER (WHERE cms_config_status IS NOT NULL) AS cms,
        COUNT(*) FILTER (WHERE hardware_model IS NOT NULL) AS model,
        COUNT(*) AS total
      FROM kiosks WHERE archived_at IS NULL`;
    console.log("Kiosks:", kStats[0]);

    const lStats = await sql`
      SELECT
        COUNT(*) FILTER (WHERE hotel_group IS NOT NULL) AS hotel_group,
        COUNT(*) FILTER (WHERE region IS NOT NULL) AS region,
        COUNT(*) FILTER (WHERE status IS NOT NULL) AS status,
        COUNT(*) FILTER (WHERE address IS NOT NULL) AS address,
        COUNT(*) FILTER (WHERE star_rating IS NOT NULL) AS stars,
        COUNT(*) FILTER (WHERE room_count IS NOT NULL) AS rooms,
        COUNT(*) FILTER (WHERE sourced_by IS NOT NULL) AS sourced,
        COUNT(*) FILTER (WHERE customer_code IS NOT NULL) AS cust_cd,
        COUNT(*) FILTER (WHERE location_group IS NOT NULL) AS loc_group,
        COUNT(*) FILTER (WHERE maintenance_fee IS NOT NULL) AS fee,
        COUNT(*) AS total
      FROM locations WHERE archived_at IS NULL`;
    console.log("Locations:", lStats[0]);

    const aStats = await sql`SELECT COUNT(*) AS active FROM kiosk_assignments WHERE unassigned_at IS NULL`;
    console.log("Active assignments:", aStats[0].active);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
