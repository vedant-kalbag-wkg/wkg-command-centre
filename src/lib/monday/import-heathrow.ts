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

import { and, eq } from "drizzle-orm";

import type { db as defaultDb } from "@/db";
import { kioskAssignments, kiosks, locations } from "@/db/schema";
import { iterateBoardItems, type MondayItem } from "@/lib/monday/client";
import { normaliseName } from "@/lib/normalise";

const HEATHROW_BOARD_ID = 1356657751;

// Live group → kiosks; In Progress group → placeholder location only.
const LIVE_GROUP_RE = /^\s*live\b/i;
const PENDING_GROUP_RE = /^\s*in progress\s*$/i;

// Phase 07-06 — Heathrow board uses `text4` as "Cust_cd (RPS)". Mostly empty
// per the data probe (1 of 12 items populated — Hilton London Metropole).
// Pulled alongside outlet_code1 (per-kiosk codes) and the location text. The
// `number_of_ssms` field is no longer requested — it was only used to skip
// pre-deployment items, which the In-Progress group handling already covers.
const HEATHROW_ITEM_FRAGMENT = `
  id
  name
  group { id title }
  column_values(ids: ["outlet_code1", "text4", "location"]) {
    id
    type
    text
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

function extractCountryFromLocation(item: MondayItem): string | null {
  const cv = item.column_values.find((c) => c.id === "location");
  const text = cv?.text?.trim();
  if (!text) return null;
  const tokens = text.split(",").map((s) => s.trim()).filter(Boolean);
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
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
      const isPlaceholder = isPending && outletCodes.length === 0;
      const customerCode = extractCustomerCode(item);

      const inserted = await db
        .insert(locations)
        .values({
          name: item.name,
          normalisedName: normaliseName(item.name),
          customerCode,
          mondayItemId: item.id,
          primaryRegionId,
        })
        .onConflictDoNothing({
          target: locations.mondayItemId,
        })
        .returning({ id: locations.id });

      let locationId: string;
      if (inserted.length > 0) {
        if (isPlaceholder) placeholderLocationsCreated++;
        else liveLocationsInserted++;
        if (customerCode !== null) customerCodesPopulated++;
        locationId = inserted[0].id;
      } else {
        liveLocationsSkippedExisting++;
        const existing = await db
          .select({ id: locations.id })
          .from(locations)
          .where(eq(locations.mondayItemId, item.id))
          .limit(1);
        if (existing.length === 0) continue;
        locationId = existing[0].id;
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
