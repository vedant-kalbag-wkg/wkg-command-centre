/**
 * Monday.com → wkg-kiosk-tool kiosk import.
 *
 * Reads all items from the Monday.com "Assets" board and upserts them into
 * the kiosks table. Links kiosks to locations via outletCode and creates
 * kiosk assignments where a match exists.
 *
 * Idempotent: uses upsert-on-conflict(kiosk_id) throughout.
 *
 * Run: npm run db:import:monday
 * Prereqs: .env.local has MONDAY_API_TOKEN, MONDAY_BOARD_ID, DATABASE_URL
 */

import { db } from "@/db";
import {
  kiosks,
  kioskAssignments,
  locations,
  pipelineStages,
} from "@/db/schema";
import { eq, and, sql, isNull } from "drizzle-orm";

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;
const MONDAY_BOARD_ID = process.env.MONDAY_BOARD_ID;

if (!MONDAY_API_TOKEN || !MONDAY_BOARD_ID) {
  console.error("Missing MONDAY_API_TOKEN or MONDAY_BOARD_ID in .env.local");
  process.exit(1);
}

function log(phase: string, msg: string) {
  console.log(`[${phase}] ${msg}`);
}

// ──────────────────────────────────────────────────────────────
// Monday.com GraphQL client with rate-limit retry
// ──────────────────────────────────────────────────────────────

async function mondayQuery(query: string, variables?: Record<string, unknown>): Promise<unknown> {
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        Authorization: MONDAY_API_TOKEN!,
        "Content-Type": "application/json",
        "API-Version": "2024-10",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 429) {
      const wait = Math.pow(2, attempt) * 1000;
      log("RATE_LIMIT", `Hit rate limit, retrying in ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    const json = await res.json() as { data?: unknown; errors?: Array<{ message: string }> };
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

interface MondayColumnValue {
  id: string;
  text: string | null;
  value: string | null;
  type: string;
}

interface MondayItem {
  id: string;
  name: string;
  group: { id: string; title: string };
  column_values: MondayColumnValue[];
}

// ──────────────────────────────────────────────────────────────
// Fetch all items (cursor pagination per group)
// ──────────────────────────────────────────────────────────────

async function fetchAllItems(): Promise<MondayItem[]> {
  log("FETCH", "Loading board groups...");

  const groupsData = await mondayQuery(`{
    boards(ids: [${MONDAY_BOARD_ID}]) {
      groups { id title }
    }
  }`) as { boards: Array<{ groups: Array<{ id: string; title: string }> }> };

  const groups = groupsData.boards[0].groups;
  log("FETCH", `Found ${groups.length} groups`);

  const allItems: MondayItem[] = [];

  for (const group of groups) {
    let cursor: string | null = null;
    let firstPage = true;

    while (true) {
      let query: string;
      if (firstPage) {
        query = `{
          boards(ids: [${MONDAY_BOARD_ID}]) {
            groups(ids: ["${group.id}"]) {
              items_page(limit: 500) {
                cursor
                items {
                  id
                  name
                  group { id title }
                  column_values { id text value type }
                }
              }
            }
          }
        }`;
      } else {
        query = `{
          next_items_page(limit: 500, cursor: "${cursor}") {
            cursor
            items {
              id
              name
              group { id title }
              column_values { id text value type }
            }
          }
        }`;
      }

      const data = await mondayQuery(query) as Record<string, unknown>;

      let page: { cursor: string | null; items: MondayItem[] };
      if (firstPage) {
        const boards = (data as { boards: Array<{ groups: Array<{ items_page: typeof page }> }> }).boards;
        page = boards[0].groups[0].items_page;
        // items_page groups don't include group info — inject it
        for (const item of page.items) {
          if (!item.group) item.group = { id: group.id, title: group.title };
        }
      } else {
        page = (data as { next_items_page: typeof page }).next_items_page;
        for (const item of page.items) {
          if (!item.group) item.group = { id: group.id, title: group.title };
        }
      }

      allItems.push(...page.items);
      firstPage = false;

      if (!page.cursor || page.items.length === 0) break;
      cursor = page.cursor;
    }

    log("FETCH", `  ${group.title}: ${allItems.length} total items so far`);
  }

  log("FETCH", `Fetched ${allItems.length} total items`);
  return allItems;
}

// ──────────────────────────────────────────────────────────────
// Column value helpers
// ──────────────────────────────────────────────────────────────

function getColumnText(item: MondayItem, columnId: string): string | null {
  const col = item.column_values.find((c) => c.id === columnId);
  return col?.text?.trim() || null;
}

function getCheckboxValue(item: MondayItem, columnId: string): boolean {
  const col = item.column_values.find((c) => c.id === columnId);
  if (!col?.value) return false;
  try {
    const parsed = JSON.parse(col.value) as { checked?: boolean };
    return parsed.checked === true;
  } catch {
    return false;
  }
}

// ──────────────────────────────────────────────────────────────
// Group → pipeline stage + region mapping
// ──────────────────────────────────────────────────────────────

const GROUP_MAPPING: Record<string, { pipelineStage: string; regionGroup: string | null }> = {
  "Available Assets": { pipelineStage: "Prospect", regionGroup: null },
  "Live SSMs": { pipelineStage: "Live", regionGroup: "UK" },
  "Live Prague": { pipelineStage: "Live", regionGroup: "Prague" },
  "Live Spain": { pipelineStage: "Live", regionGroup: "Spain" },
  "Live Germany": { pipelineStage: "Live", regionGroup: "Germany" },
};

// ──────────────────────────────────────────────────────────────
// Import kiosks
// ──────────────────────────────────────────────────────────────

async function importKiosks(items: MondayItem[]) {
  log("IMPORT", "Starting kiosk import...");

  // Load pipeline stages
  const stages = await db
    .select({ id: pipelineStages.id, name: pipelineStages.name })
    .from(pipelineStages);
  const stageMap = new Map(stages.map((s) => [s.name, s.id]));

  // Load locations by outlet code
  const locs = await db
    .select({ id: locations.id, outletCode: locations.outletCode })
    .from(locations);
  const locMap = new Map(
    locs.filter((l) => l.outletCode).map((l) => [l.outletCode!, l.id]),
  );
  log("IMPORT", `Loaded ${stageMap.size} pipeline stages, ${locMap.size} locations`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let assignmentsCreated = 0;
  let missingAssetId = 0;
  let missingVenue = 0;

  for (const item of items) {
    const kioskId = item.name?.trim();
    if (!kioskId || kioskId === "New asset id") {
      skipped++;
      continue;
    }

    const groupTitle = item.group?.title ?? "Unknown";
    const mapping = GROUP_MAPPING[groupTitle] ?? { pipelineStage: "Prospect", regionGroup: null };
    const pipelineStageId = stageMap.get(mapping.pipelineStage);

    if (!pipelineStageId) {
      log("IMPORT", `WARN: Pipeline stage "${mapping.pipelineStage}" not found — skipping ${kioskId}`);
      skipped++;
      continue;
    }

    const outletCode = getColumnText(item, "outlet_code1");
    const hardwareModel = getColumnText(item, "label3");
    // On the Assets board (1426737864) the item's Name IS the asset ID
    // (e.g. "WKG-POS-341"). There is no separate "asset id" column — the
    // earlier attempt to read column "1466686598" was wrong (that is a
    // different board's id, not a column id on this board).
    const hardwareSerialNumber = item.name?.trim() || null;
    const cmsConfigStatus = getColumnText(item, "status_1");
    const currentLocation = getColumnText(item, "color");

    // Region: use group mapping, but for Available Assets derive from storage location
    let regionGroup = mapping.regionGroup;
    if (!regionGroup && currentLocation) {
      const locationRegionMap: Record<string, string> = {
        "Office": "UK",
        "UK Warehouse": "UK",
        "ES Warehouse": "Spain",
        "DE Warehouse": "Germany",
        "AU Warehouse": "Australia",
        "TNF Warehouse": "UK",
        "4TC Warehouse": "UK",
        "Adam Fornton": "UK",
      };
      regionGroup = locationRegionMap[currentLocation] ?? null;
    }

    const customFields: Record<string, string> = {};
    const customerCode = getColumnText(item, "text9");
    if (customerCode) customFields.customerCode = customerCode;
    const adn = getColumnText(item, "text3");
    if (adn) customFields.adn = adn;
    const network = getColumnText(item, "label");
    if (network) customFields.network = network;
    const condition = getColumnText(item, "label9");
    if (condition) customFields.condition = condition;
    const age = getColumnText(item, "label93");
    if (age) customFields.age = age;
    if (getCheckboxValue(item, "checkbox2")) customFields.ssmConfig = "true";
    if (getCheckboxValue(item, "checkbox8")) customFields.pdqConfig = "true";
    if (getCheckboxValue(item, "checkbox0")) customFields.dbConfig = "true";
    if (getCheckboxValue(item, "checkbox")) customFields.pickUpGeoCode = "true";
    if (getCheckboxValue(item, "checkbox1__1")) customFields.ssm24Ready = "true";
    if (currentLocation) customFields.currentLocation = currentLocation;
    customFields.mondayGroup = groupTitle;
    customFields.mondayItemId = item.id;

    const values = {
      kioskId,
      outletCode: outletCode ?? null,
      hardwareModel,
      hardwareSerialNumber: hardwareSerialNumber ?? null,
      cmsConfigStatus,
      regionGroup,
      pipelineStageId,
      customFields: Object.keys(customFields).length > 0 ? customFields : null,
    };

    // Upsert on kioskId
    const existing = await db
      .select({ id: kiosks.id })
      .from(kiosks)
      .where(eq(kiosks.kioskId, kioskId))
      .limit(1);

    let kioskUuid: string;
    if (existing.length > 0) {
      kioskUuid = existing[0].id;
      await db.update(kiosks).set({
        ...values,
        updatedAt: new Date(),
      }).where(eq(kiosks.id, kioskUuid));
      updated++;
    } else {
      const [row] = await db.insert(kiosks).values(values).returning({ id: kiosks.id });
      kioskUuid = row.id;
      inserted++;
    }

    // Create assignment if outletCode links to a known location
    let venueLinked = false;
    if (outletCode && locMap.has(outletCode)) {
      const locationId = locMap.get(outletCode)!;
      venueLinked = true;

      // Check if an active assignment already exists
      const existingAssignment = await db
        .select({ id: kioskAssignments.id })
        .from(kioskAssignments)
        .where(eq(kioskAssignments.kioskId, kioskUuid))
        .limit(1);

      // Only filter for active assignments (no unassignedAt)
      const activeAssignment = existingAssignment.length > 0
        ? await db
            .select({ id: kioskAssignments.id })
            .from(kioskAssignments)
            .where(and(eq(kioskAssignments.kioskId, kioskUuid), isNull(kioskAssignments.unassignedAt)))
            .limit(1)
        : [];

      if (activeAssignment.length === 0) {
        await db.insert(kioskAssignments).values({
          kioskId: kioskUuid,
          locationId,
          assignedBy: "system",
          assignedByName: "Monday.com Import",
          reason: `Imported from Monday.com group "${groupTitle}"`,
        });
        assignmentsCreated++;
      }

    }

    // Structured audit log for outlets where asset-ID or venue linkage failed.
    // Production reads these to tell "Monday source data is empty" apart from
    // "our extractor missed a row" (e.g. outlet 2W symptom on Vercel).
    const assetMissing = !hardwareSerialNumber;
    const venueMissing = !venueLinked; // either no outletCode, or no matching location
    if (assetMissing || venueMissing) {
      if (assetMissing) missingAssetId++;
      if (venueMissing) missingVenue++;
      const parts: string[] = [];
      if (assetMissing) parts.push("assetId=null");
      if (venueMissing) {
        parts.push(
          outletCode
            ? `venue=null (no location for outletCode=${outletCode})`
            : `venue=null (no outletCode on Monday row)`,
        );
      }
      log(
        "MONDAY-IMPORT",
        `outlet=${outletCode ?? "<none>"} kiosk=${kioskId} group="${groupTitle}" missing: ${parts.join(" ")}`,
      );
    }

    if ((inserted + updated) % 50 === 0) {
      log("IMPORT", `Progress: ${inserted + updated}/${items.length} (${inserted} new, ${updated} updated, ${skipped} skipped)`);
    }
  }

  log("IMPORT", `Done: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);
  log("IMPORT", `Assignments created: ${assignmentsCreated}`);
  log("IMPORT", `Missing after extraction: assetId=${missingAssetId}, venue=${missingVenue}`);
}

// ──────────────────────────────────────────────────────────────
// Verification
// ──────────────────────────────────────────────────────────────

async function verify() {
  log("VERIFY", "Running verification checks...");

  const kioskCount = await db.select({ c: sql<number>`count(*)::int` }).from(kiosks);
  log("VERIFY", `Total kiosks: ${kioskCount[0].c}`);

  const assignmentCount = await db.select({ c: sql<number>`count(*)::int` }).from(kioskAssignments);
  log("VERIFY", `Total assignments: ${assignmentCount[0].c}`);

  // Count by pipeline stage
  const byStage = await db.execute(sql`
    SELECT ps.name, count(k.id)::int AS c
    FROM kiosks k
    JOIN pipeline_stages ps ON ps.id = k.pipeline_stage_id
    WHERE k.custom_fields->>'mondayItemId' IS NOT NULL
    GROUP BY ps.name
    ORDER BY count(k.id) DESC
  `) as unknown as Array<{ name: string; c: number }>;
  log("VERIFY", "Monday.com kiosks by pipeline stage:");
  for (const row of byStage) {
    log("VERIFY", `  ${row.name}: ${row.c}`);
  }

  // Count by region
  const byRegion = await db.execute(sql`
    SELECT coalesce(region_group, '(none)') AS region, count(*)::int AS c
    FROM kiosks
    WHERE custom_fields->>'mondayItemId' IS NOT NULL
    GROUP BY region_group
    ORDER BY count(*) DESC
  `) as unknown as Array<{ region: string; c: number }>;
  log("VERIFY", "Monday.com kiosks by region:");
  for (const row of byRegion) {
    log("VERIFY", `  ${row.region}: ${row.c}`);
  }

  // Kiosks with outlet codes that matched locations
  const linked = await db.execute(sql`
    SELECT count(*)::int AS c FROM kiosks k
    WHERE k.custom_fields->>'mondayItemId' IS NOT NULL
    AND k.outlet_code IS NOT NULL
    AND EXISTS (SELECT 1 FROM locations l WHERE l.outlet_code = k.outlet_code)
  `) as unknown as Array<{ c: number }>;
  log("VERIFY", `Kiosks linked to locations via outletCode: ${linked[0]?.c ?? 0}`);

  log("VERIFY", "DONE");
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Monday.com → wkg-kiosk-tool Kiosk Import ===\n");

  const items = await fetchAllItems();
  await importKiosks(items);
  await verify();

  console.log("\n=== Import complete ===");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
