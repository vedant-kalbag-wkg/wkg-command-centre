// Net-new Assets-board importer (Phase 7 / Plan B — kiosk SoT correction).
//
// The Monday Assets board (id 1426737864) is the canonical source of truth
// for kiosks (488 items as of 2026-05). Each item carries:
//   - `outlet_code1` (text) — the per-kiosk outlet code that appears in
//     NetSuite sales rows (e.g. "F9", "T2", "CB")
//   - `link_to_hotel_ssms` (board_relation) — points to the hotel item on
//     one of the 4 hotel boards (Live Estate / Ready to Launch / Removed /
//     Australia DCM). Single-link in practice; we take the first id.
//   - `group.title` — region grouping (Live SSMs / Live Spain / Live Germany
//     / Live Australia / Live Prague / Available Assets). Not used for
//     region resolution here — the location's region is inherited via the
//     linked hotel.
//
// Why it exists: the previous design used `import-hotel-locations.ts` to
// fan out one kiosk per comma-separated mirror9 outlet code on the hotel
// board. Mirror9 only covers ~244 of 291 GB sales codes — airport / transit
// outlets (CB, UG, T2, T3, M3, M5, etc.) live on Assets but never on a
// hotel mirror9 row, so 66k sales rows were falling to the
// LOCATION_NEEDED sentinel. This importer drives kiosk creation directly
// from Assets so coverage tracks the operator-curated SoT.
//
// Mirrors the structural shape of `src/lib/monday/import-hotel-locations.ts`:
// dep-injected db + token, retry-aware pagination via `iterateBoardItems`,
// idempotent dedup by `kiosk_id = "ASSET-<mondayAssetId>"`.

import { and, eq } from "drizzle-orm";

import type { db as defaultDb } from "@/db";
import { kioskAssignments, kiosks } from "@/db/schema";
import { iterateBoardItems, type MondayItem } from "@/lib/monday/client";

const ASSETS_BOARD_ID = 1426737864;

// Custom item fragment — `outlet_code1` is a plain text column (use `text`),
// `link_to_hotel_ssms` is a `BoardRelationValue` whose linked-hotel ids only
// surface via the typed inline fragment's `linked_item_ids` field. Pulling
// `text`/`value` for both keeps the request resilient to a board that ever
// gets retyped.
const ASSET_ITEM_FRAGMENT = `
  id
  name
  group { id title }
  column_values(ids: ["outlet_code1", "link_to_hotel_ssms"]) {
    id
    type
    text
    value
    ... on BoardRelationValue { linked_item_ids }
  }
`;

export type AssetsImportResult = {
  kiosksInserted: number;
  kiosksSkippedExisting: number;
  assignmentsInserted: number;
  assetsSkippedNoOutletCode: number;
  assetsSkippedNoLinkedHotel: number;
  /** Linked hotel id was set on the asset but isn't in the hotel-import
   * map — typically because the hotel itself was skipped during hotel-import
   * (no region mapping, no mirror9 outlet). */
  assetsSkippedHotelNotResolvable: number;
  /** Up to 50 unmapped Monday hotel ids — surfaced for diagnostics so the
   * operator can decide whether to fix Monday or extend the region map. */
  unmappedHotelMondayIds: string[];
  durationMs: number;
};

export type AssetsImportDeps = {
  mondayApiToken: string;
  db: typeof defaultDb;
  /** Monday hotel item id → `locations.id`, built by the runbook from the
   * hotel-import step. Used to resolve each asset's `link_to_hotel_ssms`
   * to a real location. */
  hotelMondayIdToLocationId: Map<string, string>;
  logger?: (phase: string, msg: string) => void;
};

const noopLogger = (_phase: string, _msg: string) => {};

const ETL_ACTOR_ID = "00000000-0000-0000-0000-000000000001";
const ETL_ACTOR_NAME = "System (assets-import)";

type LinkedColumnValue = MondayItem["column_values"][number] & {
  linked_item_ids?: string[] | null;
};

function extractOutletCode(item: MondayItem): string | null {
  const cv = item.column_values.find((c) => c.id === "outlet_code1");
  const text = cv?.text?.trim();
  return text && text.length > 0 ? text : null;
}

function extractLinkedHotelId(item: MondayItem): string | null {
  const cv = item.column_values.find(
    (c) => c.id === "link_to_hotel_ssms",
  ) as LinkedColumnValue | undefined;
  const ids = cv?.linked_item_ids ?? [];
  return ids.length > 0 ? ids[0] : null;
}

export async function runAssetsImport(
  deps: AssetsImportDeps,
): Promise<AssetsImportResult> {
  const {
    mondayApiToken,
    db,
    hotelMondayIdToLocationId,
    logger = noopLogger,
  } = deps;
  const t0 = Date.now();

  // Bridge the dep-injected token into env for the duration of the call
  // (matches the pattern in import-hotel-locations.ts so the shared client,
  // which reads MONDAY_API_TOKEN from env, sees it).
  const previousToken = process.env.MONDAY_API_TOKEN;
  process.env.MONDAY_API_TOKEN = mondayApiToken;

  let kiosksInserted = 0;
  let kiosksSkippedExisting = 0;
  let assignmentsInserted = 0;
  let assetsSkippedNoOutletCode = 0;
  let assetsSkippedNoLinkedHotel = 0;
  let assetsSkippedHotelNotResolvable = 0;
  const unmappedHotelMondayIds = new Set<string>();

  try {
    logger("assets-import", `board=Assets (${ASSETS_BOARD_ID}) start`);
    let processed = 0;

    for await (const item of iterateBoardItems(ASSETS_BOARD_ID, {
      itemFragment: ASSET_ITEM_FRAGMENT,
    })) {
      processed++;

      const outletCode = extractOutletCode(item);
      if (!outletCode) {
        assetsSkippedNoOutletCode++;
        continue;
      }

      const linkedHotelId = extractLinkedHotelId(item);
      if (!linkedHotelId) {
        assetsSkippedNoLinkedHotel++;
        continue;
      }

      const locationId = hotelMondayIdToLocationId.get(linkedHotelId);
      if (!locationId) {
        assetsSkippedHotelNotResolvable++;
        if (unmappedHotelMondayIds.size < 50) {
          unmappedHotelMondayIds.add(linkedHotelId);
        }
        continue;
      }

      // Idempotent kiosk dedup: kiosk_id = "ASSET-<mondayAssetId>". Re-runs
      // produce the same kiosk uuid for the same Monday asset.
      const kioskId = `ASSET-${item.id}`;
      const kioskInsert = await db
        .insert(kiosks)
        .values({ kioskId, outletCode })
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
        if (existingKiosk.length === 0) continue; // shouldn't happen, defensive
        kioskUuid = existingKiosk[0].id;
      }

      // Skip the assignment INSERT when one already exists for this
      // (kiosk, location) pair — re-import idempotency. There's no unique
      // constraint on the pair, so we explicitly check.
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

    logger(
      "assets-import",
      `board=Assets done (${processed} items processed)`,
    );
  } finally {
    if (previousToken === undefined) {
      delete process.env.MONDAY_API_TOKEN;
    } else {
      process.env.MONDAY_API_TOKEN = previousToken;
    }
  }

  return {
    kiosksInserted,
    kiosksSkippedExisting,
    assignmentsInserted,
    assetsSkippedNoOutletCode,
    assetsSkippedNoLinkedHotel,
    assetsSkippedHotelNotResolvable,
    unmappedHotelMondayIds: [...unmappedHotelMondayIds].sort(),
    durationMs: Date.now() - t0,
  };
}
