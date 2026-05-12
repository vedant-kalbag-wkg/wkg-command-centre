// Heathrow Express SSMs board importer (Phase 7 / Plan B addendum).
//
// Board 1356657751 has a different shape than the 4 standard hotel boards
// covered by `runHotelLocationImport`:
//
//   - Outlet code is in `outlet_code1` (text, direct entry), NOT `mirror9`
//     (which doesn't exist on this board). Codes can be slash-separated
//     (e.g. "H9/9H") in addition to the comma-separated convention used on
//     the other boards.
//   - Items mix transit venues ("Terminal 3 Arrivals", "Underground Unit")
//     with Heathrow-line hotels ("Hilton London Paddington Hotel"). Some of
//     those hotels also exist on Live Estate with a different outlet code
//     (e.g. "Hilton London Metropole"); those duplicates are NOT
//     auto-deduped here — the operator runs the manual similarity-check
//     dedup workflow (`/settings/duplicates`) to merge them.
//   - Zero Assets-board items link back to this board, so the standard
//     `runAssetsImport` path will MISS these venues' kiosks. This module
//     synthesises kiosks inline (1 per outlet code) to cover the gap.
//   - "In Progress" group items have no outlet codes (pre-deployment); they
//     get a placeholder outlet code (TODO-<itemId>) and zero kiosks, mirroring
//     the "Ready to Launch" pattern in runHotelLocationImport.
//
// Region resolution: per-item via the LocationValue's trailing country token,
// same fallback used by runHotelLocationImport for the "Ready to Launch" group.

import { and, eq, sql } from "drizzle-orm";

import type { db as defaultDb } from "@/db";
import { kioskAssignments, kiosks, locations } from "@/db/schema";
import { iterateBoardItems, type MondayItem } from "@/lib/monday/client";
import {
  extractCountryFromLocation,
  extractLocationValue,
  extractMondayDate,
  extractMondayNumber,
  extractMondayStatusLabel,
  extractMondayText,
} from "@/lib/monday/extractors";
import { normaliseName } from "@/lib/normalise";

const HEATHROW_BOARD_ID = 1356657751;

// Live group → kiosks; In Progress group → placeholder location only.
const LIVE_GROUP_RE = /^\s*live\b/i;
const PENDING_GROUP_RE = /^\s*in progress\s*$/i;

// Phase 07-06 — Heathrow board uses `text4` as "Cust_cd (RPS)". Mostly empty
// per the data probe (1 of 12 items populated — Hilton London Metropole).
// `outlet_code1` is the per-kiosk code; `location` is the LocationValue
// (lat/lng come from the inline fragment).
//
// 2026-05 follow-up: the board exposes several metadata columns that the
// importer previously ignored. We now pull them so Heathrow rows land with
// the same metadata coverage as the 4 standard hotel boards (minus the
// columns the Heathrow board doesn't expose — hotel_group, launch_phase,
// star_rating, num_rooms, sourced_by, SSM-Group link, long_text/notes).
//
//   - status               Live / In Progress (writes locations.status)
//   - live_date            DateValue
//   - numeric              Maintenance Deduction (writes locations.maintenance_fee)
//   - key_contact_name     hotel-side contact name
//   - key_contact_email    hotel-side contact email
//   - finance_contact1     hotel finance contact
//   - category1            DropdownValue (writes locations.location_group —
//                          analogous to status_11 on hotel boards)
const HEATHROW_ITEM_FRAGMENT = `
  id
  name
  group { id title }
  column_values(ids: [
    "outlet_code1",
    "text4",
    "location",
    "status",
    "live_date",
    "numeric",
    "key_contact_name",
    "key_contact_email",
    "finance_contact1",
    "category1"
  ]) {
    id
    type
    text
    ... on LocationValue { lat lng }
  }
`;

const ETL_ACTOR_ID = "00000000-0000-0000-0000-000000000001";
const ETL_ACTOR_NAME = "System (heathrow-import)";

export type HeathrowImportResult = {
  liveLocationsInserted: number;
  liveLocationsSkippedExisting: number;
  placeholderLocationsCreated: number;
  itemsSkippedNoRegion: number;
  itemsSkippedNoOutlet: number;
  kiosksInserted: number;
  kiosksSkippedExisting: number;
  assignmentsInserted: number;
  /** Phase 07-06 — count of Heathrow locations imported with a populated
   * customer_code (from `text4`). Most Heathrow items have this empty per
   * the operator data; the count is for visibility into which Heathrow
   * venues actually have an RPS account on Monday. */
  customerCodesPopulated: number;
  unmappedGroupTitles: string[];
  durationMs: number;
};

export type HeathrowImportDeps = {
  mondayApiToken: string;
  db: typeof defaultDb;
  /** Same resolver passed to runHotelLocationImport — accepts any string and
   * matches against the runbook's GROUP_TITLE_REGION_PATTERNS, so the country
   * token from the LocationValue (e.g. "UK") resolves cleanly. */
  resolveRegionIdByGroup: (boardId: number, groupTitle: string) => Promise<string | null>;
  logger?: (phase: string, msg: string) => void;
};

const noopLogger = (_phase: string, _msg: string) => {};

function extractOutletCodes(item: MondayItem): string[] {
  const cv = item.column_values.find((c) => c.id === "outlet_code1");
  const text = cv?.text?.trim() ?? "";
  if (!text) return [];
  // Split on both `,` and `/` — Hilton London Metropole Hotel uses
  // "H9/9H" while the rest of the boards use comma-separated codes.
  return text
    .split(/[,/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Phase 07-06 — read `text4` as the customer_code on the Heathrow board.
 * Most Heathrow items have this empty (1/12 populated per the probe); we
 * only return non-empty trimmed values, otherwise null.
 */
function extractCustomerCode(item: MondayItem): string | null {
  const cv = item.column_values.find((c) => c.id === "text4");
  const text = cv?.text?.trim();
  return text && text.length > 0 ? text : null;
}

export async function runHeathrowImport(
  deps: HeathrowImportDeps,
): Promise<HeathrowImportResult> {
  const { mondayApiToken, db, resolveRegionIdByGroup, logger = noopLogger } = deps;
  const t0 = Date.now();

  const previousToken = process.env.MONDAY_API_TOKEN;
  process.env.MONDAY_API_TOKEN = mondayApiToken;

  let liveLocationsInserted = 0;
  let liveLocationsSkippedExisting = 0;
  let placeholderLocationsCreated = 0;
  let itemsSkippedNoRegion = 0;
  let itemsSkippedNoOutlet = 0;
  let kiosksInserted = 0;
  let kiosksSkippedExisting = 0;
  let assignmentsInserted = 0;
  let customerCodesPopulated = 0;
  const unmappedTitles = new Set<string>();

  try {
    logger("heathrow-import", `board=Heathrow Express SSMs (${HEATHROW_BOARD_ID}) start`);

    for await (const item of iterateBoardItems(HEATHROW_BOARD_ID, {
      itemFragment: HEATHROW_ITEM_FRAGMENT,
    })) {
      const groupTitle =
        (item as MondayItem & { group?: { title?: string } }).group?.title ?? "";
      const isLive = LIVE_GROUP_RE.test(groupTitle);
      const isPending = PENDING_GROUP_RE.test(groupTitle);
      if (!isLive && !isPending) {
        // Outside the in-scope groups — skip silently.
        continue;
      }

      const outletCodes = extractOutletCodes(item);

      // Live with no codes (e.g. "Terminal 5 Airside Domestic", ssm=0): skip
      // entirely; nothing to import. Pending with no codes is the placeholder
      // path; pending WITH codes still creates kiosks (treat like live).
      if (isLive && outletCodes.length === 0) {
        itemsSkippedNoOutlet++;
        continue;
      }

      const country = extractCountryFromLocation(item);
      let primaryRegionId: string | null = null;
      if (country) {
        primaryRegionId = await resolveRegionIdByGroup(HEATHROW_BOARD_ID, country);
      }
      if (!primaryRegionId) {
        // Last-ditch: try the group title (won't match for "Live SSMs" / "In
        // Progress" but covers any future group rename).
        primaryRegionId = await resolveRegionIdByGroup(HEATHROW_BOARD_ID, groupTitle);
      }
      if (!primaryRegionId) {
        itemsSkippedNoRegion++;
        if (groupTitle) unmappedTitles.add(groupTitle);
        continue;
      }

      // One location per item. customer_code is populated from text4 when
      // present; placeholder ("In Progress" with no codes) keeps it NULL.
      // ON CONFLICT target → mondayItemId (universal idempotency key, set
      // for every Heathrow row). Phase 07-06 — outlet_code is gone from
      // locations entirely; per-kiosk codes still live on the kiosks table
      // and are populated below.
      //
      // 2026-05 follow-up: metadata fields land on INSERT; ON CONFLICT now
      // uses DO UPDATE with COALESCE per metadata column so operator UI
      // edits between reseeds are preserved (fill-NULLs-only). Identity
      // columns (name, normalised_name, customer_code, monday_item_id,
      // primary_region_id) stay frozen on conflict.
      const isPlaceholder = isPending && outletCodes.length === 0;
      const customerCode = extractCustomerCode(item);

      // ── Metadata extraction (2026-05 follow-up) ─────────────────────────
      const locationValue = extractLocationValue(item, "location");
      const statusLabel = extractMondayStatusLabel(item, "status");
      const liveDate = extractMondayDate(item, "live_date");
      const maintenanceFee = extractMondayNumber(item, "numeric");
      const keyContactName = extractMondayText(item, "key_contact_name");
      const keyContactEmail = extractMondayText(item, "key_contact_email");
      const financeContact = extractMondayText(item, "finance_contact1");
      const locationGroup = extractMondayStatusLabel(item, "category1");

      const inserted = await db
        .insert(locations)
        .values({
          name: item.name,
          normalisedName: normaliseName(item.name),
          customerCode,
          mondayItemId: item.id,
          primaryRegionId,
          address: locationValue.address,
          latitude: locationValue.latitude,
          longitude: locationValue.longitude,
          status: statusLabel,
          liveDate,
          maintenanceFee:
            maintenanceFee !== null ? String(maintenanceFee) : null,
          keyContactName,
          keyContactEmail,
          financeContact,
          locationGroup,
        })
        .onConflictDoUpdate({
          target: locations.mondayItemId,
          // Phase 07-06 — partial unique on (monday_item_id) requires the
          // ON CONFLICT predicate to match for arbiter inference.
          targetWhere: sql`monday_item_id IS NOT NULL`,
          set: {
            address: sql`COALESCE(${locations.address}, EXCLUDED.address)`,
            latitude: sql`COALESCE(${locations.latitude}, EXCLUDED.latitude)`,
            longitude: sql`COALESCE(${locations.longitude}, EXCLUDED.longitude)`,
            status: sql`COALESCE(${locations.status}, EXCLUDED.status)`,
            liveDate: sql`COALESCE(${locations.liveDate}, EXCLUDED.live_date)`,
            maintenanceFee: sql`COALESCE(${locations.maintenanceFee}, EXCLUDED.maintenance_fee)`,
            keyContactName: sql`COALESCE(${locations.keyContactName}, EXCLUDED.key_contact_name)`,
            keyContactEmail: sql`COALESCE(${locations.keyContactEmail}, EXCLUDED.key_contact_email)`,
            financeContact: sql`COALESCE(${locations.financeContact}, EXCLUDED.finance_contact)`,
            locationGroup: sql`COALESCE(${locations.locationGroup}, EXCLUDED.location_group)`,
          },
        })
        .returning({
          id: locations.id,
          // xmax = 0 on fresh INSERT, non-0 on UPDATE-on-conflict.
          isNew: sql<boolean>`xmax = 0`,
        });

      const locationId = inserted[0].id;
      if (inserted[0].isNew) {
        if (isPlaceholder) placeholderLocationsCreated++;
        else liveLocationsInserted++;
        if (customerCode !== null) customerCodesPopulated++;
      } else {
        liveLocationsSkippedExisting++;
      }

      // Synthesise kiosks for items with codes. Each outlet code becomes one
      // kiosk linked to this item's location. Idempotent dedup on
      // kiosk_id = "HEATHROW-<itemId>-<code>".
      if (outletCodes.length > 0) {
        for (const code of outletCodes) {
          const kioskId = `HEATHROW-${item.id}-${code}`;
          const kioskInsert = await db
            .insert(kiosks)
            .values({ kioskId, outletCode: code })
            .onConflictDoNothing({ target: kiosks.kioskId })
            .returning({ id: kiosks.id });

          let kioskUuid: string;
          if (kioskInsert.length > 0) {
            kiosksInserted++;
            kioskUuid = kioskInsert[0].id;
          } else {
            kiosksSkippedExisting++;
            const existingKiosk = await db
              .select({ id: kiosks.id })
              .from(kiosks)
              .where(eq(kiosks.kioskId, kioskId))
              .limit(1);
            if (existingKiosk.length === 0) continue;
            kioskUuid = existingKiosk[0].id;
          }

          const existingAssignment = await db
            .select({ id: kioskAssignments.id })
            .from(kioskAssignments)
            .where(
              and(
                eq(kioskAssignments.kioskId, kioskUuid),
                eq(kioskAssignments.locationId, locationId),
              ),
            )
            .limit(1);
          if (existingAssignment.length === 0) {
            await db.insert(kioskAssignments).values({
              kioskId: kioskUuid,
              locationId,
              assignedBy: ETL_ACTOR_ID,
              assignedByName: ETL_ACTOR_NAME,
            });
            assignmentsInserted++;
          }
        }
      }
    }

    logger("heathrow-import", `done`);
  } finally {
    if (previousToken === undefined) {
      delete process.env.MONDAY_API_TOKEN;
    } else {
      process.env.MONDAY_API_TOKEN = previousToken;
    }
  }

  return {
    liveLocationsInserted,
    liveLocationsSkippedExisting,
    placeholderLocationsCreated,
    itemsSkippedNoRegion,
    itemsSkippedNoOutlet,
    kiosksInserted,
    kiosksSkippedExisting,
    assignmentsInserted,
    customerCodesPopulated,
    unmappedGroupTitles: [...unmappedTitles].sort(),
    durationMs: Date.now() - t0,
  };
}
