"use server";

/**
 * Zero-configuration full re-import from Monday.com.
 *
 * Uses hard-coded column IDs from the known kiosks/hotels board schemas
 * (no manual field-mapping required). Wipes existing data and rebuilds
 * the full kiosk + location + assignment graph in one pass.
 *
 * Methodology:
 *   1. Wipe kiosks / locations / assignments / products / providers / location_products
 *   2. Fetch hotels from BOTH hotels boards (deduped by name)
 *   3. Fetch kiosks (assets) — split multi-outlet rows into one-kiosk-per-outlet
 *   4. Link kiosks to locations via the Hotel board_relation (primary)
 *      with fallback to the Assets board_relation on the hotel side
 *   5. Backfill kiosk.region_group from the assigned location.region
 */

import { db } from "@/db";
import {
  kiosks,
  locations,
  kioskAssignments,
  pipelineStages,
} from "@/db/schema";
import { requireRole } from "@/lib/rbac";
import { fetchAllItems, type MondayItem } from "@/lib/monday-client";
import type { ImportProgress } from "@/lib/field-mapper";
import { sql } from "drizzle-orm";

// Module-level session state, shared with the mapper-based import flow
const globalForImport = globalThis as unknown as {
  importSessions?: Map<string, ImportProgress>;
};
const importSessions = (globalForImport.importSessions ??= new Map<
  string,
  ImportProgress
>());

// ---------------------------------------------------------------------------
// Column ID constants (from Monday.com board schemas)
// ---------------------------------------------------------------------------

const KIOSK_COLS = {
  outletCode: "outlet_code1",
  custCd: "text9",
  adn: "text3",
  credential: "text1",
  makeModel: "label3",
  configStatus: "status_1",
  network: "label",
  condition: "label9",
  age: "label93",
  ssmConfig: "checkbox2",
  pdqConfig: "checkbox8",
  ssm24Ready: "checkbox1__1",
  dbConfig: "checkbox0",
  hotelRelation: "link_to_hotel_ssms",
  launchStatusMirror: "mirror", // pipeline stage
} as const;

const HOTEL_COLS = {
  hotelGroup: "group0",
  status: "status",
  region: "color_mkttv13g",
  locationGroup: "status_11", // Live Estate only
  rooms: "number_of_rooms",
  stars: "rating__1",
  address: "location",
  sourcedBy: "label8__1",
  maintFee: "numbers__1",
  freeTrialEnd: "date9",
  liveDate: "live_date",
  assetsRelation: "connect_boards5",
  outletCodeMirror: "mirror9",
  custCdMirror: "mirror3__1",
  keyContactName: "key_contact_name",
  keyContactEmail: "key_contact_email",
  additionalEmail: "email__1",
  financeContact: "finance_contact1",
  notes: "long_text__1",
  cmsConfig: "checkbox4__1",
} as const;

// ---------------------------------------------------------------------------
// Column value helpers
// ---------------------------------------------------------------------------

type CV = MondayItem["column_values"][number] & {
  display_value?: string | null;
  linked_item_ids?: string[];
};

function cvText(item: MondayItem, colId: string): string | null {
  const cv = item.column_values.find((c) => c.id === colId) as CV | undefined;
  if (!cv) return null;
  if (cv.type === "mirror" && cv.display_value) return cv.display_value;
  if (cv.text) return cv.text;
  return null;
}

function cvLinkedIds(item: MondayItem, colId: string): string[] {
  const cv = item.column_values.find((c) => c.id === colId) as CV | undefined;
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
// Action
// ---------------------------------------------------------------------------

export async function runAutoFullImport(params: {
  kiosksBoardId: string;
  hotelsBoardIds: string[]; // supports multiple hotels boards
}): Promise<{ success: true; sessionId: string } | { error: string }> {
  try {
    await requireRole("admin");

    const sessionId = crypto.randomUUID();
    const progress: ImportProgress = {
      sessionId,
      status: "running",
      current: 0,
      total: 0,
      log: [],
      result: {
        kiosksCreated: 0,
        locationsCreated: 0,
        assignmentsCreated: 0,
        productsCreated: 0,
        providersCreated: 0,
        locationProductsCreated: 0,
        skipped: 0,
        errors: 0,
      },
    };
    importSessions.set(sessionId, progress);

    const log = (
      level: "info" | "warn" | "error",
      message: string
    ) => {
      progress.log.push({
        timestamp: new Date().toISOString(),
        level,
        message,
      });
    };

    // Detached async — caller polls progress via getImportProgress(sessionId)
    void (async () => {
      try {
        // --- Step 0: Wipe existing data ---
        log("info", "Step 0: Wiping existing kiosks, locations, assignments…");
        await db.execute(
          sql`TRUNCATE TABLE location_products, installation_kiosks, kiosk_assignments, kiosks, locations, products, providers CASCADE`
        );

        // --- Step 1: Fetch hotels from all boards ---
        log("info", `Step 1: Fetching hotels from ${params.hotelsBoardIds.length} board(s)…`);
        const allHotels: MondayItem[] = [];
        for (const boardId of params.hotelsBoardIds) {
          const items: MondayItem[] = [];
          for await (const page of fetchAllItems(boardId)) items.push(...page);
          log("info", `  Board ${boardId}: ${items.length} hotels`);
          allHotels.push(...items);
        }
        log("info", `  Total ${allHotels.length} hotels across all boards`);

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
          keyContacts:
            | Array<{ name: string; role: string; email: string; phone: string }>
            | null;
          freeTrialEndDate: Date | null;
          notes: string | null;
          mondayHotelIds: string[];
          linkedAssetIds: string[];
        };

        // Dedup hotels by name across both boards
        const locByName = new Map<string, LocData>();
        for (const hotel of allHotels) {
          const name = hotel.name.trim();
          if (!name) continue;

          const linkedAssets = cvLinkedIds(hotel, HOTEL_COLS.assetsRelation);
          const contactName = cvText(hotel, HOTEL_COLS.keyContactName);
          const contactEmail = cvText(hotel, HOTEL_COLS.keyContactEmail);
          const additionalEmail = cvText(hotel, HOTEL_COLS.additionalEmail);
          const financeContact = cvText(hotel, HOTEL_COLS.financeContact);
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
            contacts.push({
              name: "",
              role: "Additional Contact",
              email: additionalEmail,
              phone: "",
            });
          }
          if (financeContact) {
            contacts.push({
              name: financeContact,
              role: "Finance Contact",
              email: "",
              phone: "",
            });
          }
          const custCdRaw = cvText(hotel, HOTEL_COLS.custCdMirror);
          const customerCode = custCdRaw
            ? custCdRaw.split(",").map((c) => c.trim()).filter(Boolean)[0] ?? null
            : null;
          const maintN = cvNumber(hotel, HOTEL_COLS.maintFee);

          const data: LocData = {
            name,
            address: cvText(hotel, HOTEL_COLS.address),
            starRating: cvInt(hotel, HOTEL_COLS.stars),
            roomCount: cvInt(hotel, HOTEL_COLS.rooms),
            hotelGroup: cvText(hotel, HOTEL_COLS.hotelGroup),
            region: cvText(hotel, HOTEL_COLS.region),
            locationGroup: cvText(hotel, HOTEL_COLS.locationGroup),
            sourcedBy: cvText(hotel, HOTEL_COLS.sourcedBy),
            status: cvText(hotel, HOTEL_COLS.status),
            maintenanceFee: maintN === null ? null : String(maintN),
            customerCode,
            keyContacts: contacts.length > 0 ? contacts : null,
            freeTrialEndDate: cvDate(hotel, HOTEL_COLS.freeTrialEnd),
            notes: cvText(hotel, HOTEL_COLS.notes),
            mondayHotelIds: [hotel.id],
            linkedAssetIds: linkedAssets,
          };

          const existing = locByName.get(name);
          if (!existing) {
            locByName.set(name, data);
          } else {
            existing.mondayHotelIds.push(hotel.id);
            existing.linkedAssetIds.push(...linkedAssets);
            for (const k of Object.keys(data) as Array<keyof LocData>) {
              if (k === "mondayHotelIds" || k === "linkedAssetIds") continue;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              if ((existing as any)[k] == null && (data as any)[k] != null) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (existing as any)[k] = (data as any)[k];
              }
            }
          }
        }
        log("info", `  Deduped to ${locByName.size} unique locations`);

        // --- Step 2: Insert locations ---
        log("info", "Step 2: Inserting locations…");
        const locationIdByMondayHotelId = new Map<string, string>();
        const locationIdByName = new Map<string, string>();
        const locValues = [...locByName.values()].map((l) => ({
          name: l.name,
          address: l.address,
          starRating: l.starRating,
          roomCount: l.roomCount,
          hotelGroup: l.hotelGroup,
          region: l.region,
          locationGroup: l.locationGroup,
          sourcedBy: l.sourcedBy,
          status: l.status,
          maintenanceFee: l.maintenanceFee,
          customerCode: l.customerCode,
          keyContacts: l.keyContacts,
          freeTrialEndDate: l.freeTrialEndDate,
          notes: l.notes,
        }));
        const inserted = await db
          .insert(locations)
          .values(locValues)
          .returning({ id: locations.id, name: locations.name });
        for (const row of inserted) locationIdByName.set(row.name, row.id);
        for (const loc of locByName.values()) {
          const dbId = locationIdByName.get(loc.name);
          if (!dbId) continue;
          for (const mid of loc.mondayHotelIds) {
            locationIdByMondayHotelId.set(mid, dbId);
          }
        }
        progress.result!.locationsCreated = inserted.length;
        log("info", `  Inserted ${inserted.length} locations`);

        // Build asset monday id → location DB id (fallback link)
        const locationByAssetMondayId = new Map<string, string>();
        for (const loc of locByName.values()) {
          const dbId = locationIdByName.get(loc.name);
          if (!dbId) continue;
          for (const mid of loc.linkedAssetIds) {
            if (!locationByAssetMondayId.has(mid)) {
              locationByAssetMondayId.set(mid, dbId);
            }
          }
        }

        // --- Step 3: Fetch kiosks ---
        log("info", "Step 3: Fetching kiosks from Assets board…");
        const kioskItems: MondayItem[] = [];
        for await (const page of fetchAllItems(params.kiosksBoardId))
          kioskItems.push(...page);
        log("info", `  Fetched ${kioskItems.length} kiosks`);
        progress.total = kioskItems.length;

        // Ensure pipeline stages for every Launch Status we see
        const stageRows = await db
          .select({ id: pipelineStages.id, name: pipelineStages.name })
          .from(pipelineStages);
        const stageMap = new Map(stageRows.map((s) => [s.name, s.id]));
        const newStageNames = new Set<string>();
        for (const item of kioskItems) {
          const ls = cvText(item, KIOSK_COLS.launchStatusMirror);
          if (ls && !stageMap.has(ls)) newStageNames.add(ls);
        }
        if (newStageNames.size > 0) {
          const [{ pos }] = await db.execute(
            sql`SELECT COALESCE(MAX(position), 0) + 1 AS pos FROM pipeline_stages`
          );
          let nextPos = Number(pos);
          for (const n of newStageNames) {
            const [row] = await db
              .insert(pipelineStages)
              .values({
                name: n,
                color: "#6b7280",
                position: nextPos++,
                isDefault: false,
              })
              .returning({ id: pipelineStages.id });
            stageMap.set(n, row.id);
          }
          log("info", `  Auto-created ${newStageNames.size} pipeline stages`);
        }

        // --- Step 4: Prepare and insert kiosks (split by outlet code) ---
        type KRec = {
          kioskId: string;
          hardwareSerialNumber: string;
          outletCode: string | null;
          hardwareModel: string | null;
          cmsConfigStatus: string | null;
          pipelineStageId: string | null;
          notes: string | null;
          linkedHotelMondayIds: string[];
          sourceAssetMondayId: string;
        };
        const kRecords: KRec[] = [];
        for (const item of kioskItems) {
          const outletRaw = cvText(item, KIOSK_COLS.outletCode) ?? "";
          const outletCodes = [
            ...new Set(
              outletRaw.split(",").map((s) => s.trim()).filter(Boolean)
            ),
          ];
          const make = cvText(item, KIOSK_COLS.makeModel);
          const config = cvText(item, KIOSK_COLS.configStatus);
          const launch = cvText(item, KIOSK_COLS.launchStatusMirror);
          const stageId = launch ? stageMap.get(launch) ?? null : null;
          const linkedHotels = cvLinkedIds(item, KIOSK_COLS.hotelRelation);

          const extras: string[] = [];
          for (const [k, label] of [
            [KIOSK_COLS.custCd, "Cust_cd"],
            [KIOSK_COLS.adn, "ADN"],
            [KIOSK_COLS.credential, "Credential"],
            [KIOSK_COLS.network, "Network"],
            [KIOSK_COLS.condition, "Condition"],
            [KIOSK_COLS.age, "Age"],
          ] as const) {
            const v = cvText(item, k);
            if (v) extras.push(`${label}: ${v}`);
          }
          extras.push(`SSM Config: ${cvBool(item, KIOSK_COLS.ssmConfig)}`);
          extras.push(`PDQ Config: ${cvBool(item, KIOSK_COLS.pdqConfig)}`);
          extras.push(`SSM24 Ready: ${cvBool(item, KIOSK_COLS.ssm24Ready)}`);
          extras.push(`DB Config: ${cvBool(item, KIOSK_COLS.dbConfig)}`);
          const notes = extras.join("\n");

          const baseRec = {
            hardwareSerialNumber: item.name,
            hardwareModel: make,
            cmsConfigStatus: config,
            pipelineStageId: stageId,
            notes,
            linkedHotelMondayIds: linkedHotels,
            sourceAssetMondayId: item.id,
          };

          if (outletCodes.length === 0) {
            kRecords.push({
              ...baseRec,
              kioskId: item.name,
              outletCode: null,
            });
          } else {
            for (const code of outletCodes) {
              kRecords.push({
                ...baseRec,
                kioskId: outletCodes.length > 1 ? `${code}-${item.name}` : code,
                outletCode: code,
              });
            }
          }
        }

        // Dedup kiosk_id conflicts
        const seen = new Set<string>();
        for (const k of kRecords) {
          let id = k.kioskId;
          let i = 2;
          while (seen.has(id)) {
            id = `${k.kioskId}-${i}`;
            i++;
          }
          k.kioskId = id;
          seen.add(id);
        }

        // Insert kiosks in batches for speed
        log("info", `Step 4: Inserting ${kRecords.length} kiosks…`);
        const kioskDbIds = new Map<number, string>(); // index in kRecords → db id
        const BATCH = 500;
        for (let i = 0; i < kRecords.length; i += BATCH) {
          const slice = kRecords.slice(i, i + BATCH);
          const rows = await db
            .insert(kiosks)
            .values(
              slice.map((k) => ({
                kioskId: k.kioskId,
                hardwareSerialNumber: k.hardwareSerialNumber,
                outletCode: k.outletCode,
                hardwareModel: k.hardwareModel,
                cmsConfigStatus: k.cmsConfigStatus,
                pipelineStageId: k.pipelineStageId,
                notes: k.notes,
              }))
            )
            .returning({ id: kiosks.id });
          for (let j = 0; j < rows.length; j++) {
            kioskDbIds.set(i + j, rows[j].id);
          }
          progress.current = Math.min(i + BATCH, kRecords.length);
        }
        progress.result!.kiosksCreated = kRecords.length;
        log("info", `  Inserted ${kRecords.length} kiosks`);

        // --- Step 5: Create assignments ---
        log("info", "Step 5: Creating kiosk assignments…");
        const assignmentsToInsert: Array<{
          kioskId: string;
          locationId: string;
          assignedBy: string;
          assignedByName: string;
        }> = [];
        const seenKioskDbIds = new Set<string>();
        let viaKiosk = 0;
        let viaHotel = 0;
        for (let i = 0; i < kRecords.length; i++) {
          const rec = kRecords[i];
          const dbId = kioskDbIds.get(i);
          if (!dbId || seenKioskDbIds.has(dbId)) continue;

          let locId: string | undefined;
          for (const hid of rec.linkedHotelMondayIds) {
            locId = locationIdByMondayHotelId.get(hid);
            if (locId) {
              viaKiosk++;
              break;
            }
          }
          if (!locId) {
            locId = locationByAssetMondayId.get(rec.sourceAssetMondayId);
            if (locId) viaHotel++;
          }
          if (locId) {
            assignmentsToInsert.push({
              kioskId: dbId,
              locationId: locId,
              assignedBy: "system",
              assignedByName: "Full reimport (auto)",
            });
            seenKioskDbIds.add(dbId);
          }
        }
        if (assignmentsToInsert.length > 0) {
          for (let i = 0; i < assignmentsToInsert.length; i += BATCH) {
            await db
              .insert(kioskAssignments)
              .values(assignmentsToInsert.slice(i, i + BATCH));
          }
        }
        progress.result!.assignmentsCreated = assignmentsToInsert.length;
        log(
          "info",
          `  Linked ${assignmentsToInsert.length} assignments (${viaKiosk} via kiosk→hotel, ${viaHotel} via hotel→asset)`
        );

        // --- Step 6: Backfill kiosk.region_group from location.region ---
        log("info", "Step 6: Backfilling kiosk region from assigned location…");
        const regionUpdated = await db.execute(sql`
          UPDATE kiosks k
          SET region_group = sub.region, updated_at = NOW()
          FROM (
            SELECT ka.kiosk_id AS kid, l.region
            FROM kiosk_assignments ka
            JOIN locations l ON l.id = ka.location_id
            WHERE ka.unassigned_at IS NULL AND l.region IS NOT NULL AND l.region != ''
          ) sub
          WHERE k.id = sub.kid
            AND k.archived_at IS NULL
            AND (k.region_group IS NULL OR k.region_group = '')
        `);
        log(
          "info",
          `  Set region on ${(regionUpdated as unknown as { rowCount?: number }).rowCount ?? "?"} kiosks`
        );

        progress.status = "complete";
        log("info", "Import complete ✓");
      } catch (err) {
        progress.status = "error";
        const msg = err instanceof Error ? err.message : String(err);
        log("error", `Import failed: ${msg}`);
      }
    })();

    return { success: true, sessionId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start import";
    return { error: msg };
  }
}
