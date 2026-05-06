// Net-new hotel-location importer (Phase 7 / Plan B / D-06).
//
// Lifts hotel rows from the 4 Monday hotel boards into the `locations` table.
// Monday is the SoT for hotel identity in v1.1 — every reseed re-derives
// `locations` from these boards. Idempotent: re-running on an already-reseeded
// DB is a no-op (dedup via the `(primary_region_id, outlet_code)` unique
// constraint).
//
// Region resolution is per-item, by Monday `group.title`. The hotel boards on
// Monday partition items into groups whose titles encode the region (e.g.
// "Live: UK Hotels", "Removed Spain", "Waiting to Launch - GERMANY"). The
// runbook (Plan B Task 3) supplies a mapper that translates a group title to
// a `regions.id`; items in unmappable groups are counted and skipped — the
// runbook surfaces the count so the operator can either add a regions row or
// fix the group title on Monday before the next reseed.
//
// Kiosk creation is NOT done here — kiosks come from the Monday Assets board
// via `runAssetsImport` (the canonical SoT for per-kiosk outlet codes). This
// importer's only job is `locations`. It returns a `hotelMondayIdToLocationId`
// map so the runbook can chain the assets-import step with hotel-resolution
// already loaded.
//
// Mirrors the structural shape of `src/lib/monday/import-location-products.ts`
// (deps injection, logger, retry-aware cursor pagination via the shared client).

import { and, eq } from "drizzle-orm";

import type { db as defaultDb } from "@/db";
import { locations } from "@/db/schema";
import { iterateBoardItems, type MondayItem } from "@/lib/monday/client";
import { normaliseName } from "@/lib/normalise";

// Board IDs duplicated from import-location-products.ts on purpose — both
// importers reach into the same Monday boards but for different reasons, and
// keeping the constant local avoids a coupling that doesn't earn its keep.
const HOTEL_BOARD_IDS = [1356570756, 1743012104, 5026387784, 5092887865];
const BOARD_NAMES: Record<number, string> = {
  1356570756: "Live Estate",
  1743012104: "Ready to Launch",
  5026387784: "Removed",
  5092887865: "Australia DCM",
};

// Custom item fragment — mirror9 is a Monday MirrorValue (outlet code mirrored
// from a downstream board) so we MUST request `display_value` via the typed
// inline fragment; the default `text` field on a MirrorValue is null. We also
// pull `group { id title }` so the runbook can resolve region per item.
const HOTEL_ITEM_FRAGMENT = `
  id
  name
  group { id title }
  column_values(ids: ["mirror9"]) {
    id
    type
    ... on MirrorValue { display_value }
  }
`;

export type HotelLocationImportResult = {
  locationsInserted: number;
  locationsSkippedExisting: number;
  hotelsSkippedNoOutletCode: number;
  hotelsSkippedNoRegion: number;
  /** Group titles encountered that the resolver couldn't map. */
  unmappedGroupTitles: string[];
  /** Monday hotel item id → `locations.id`. Populated for every hotel that
   * landed in `locations` (whether newly inserted or already existed). The
   * runbook hands this to `runAssetsImport` so each Asset's
   * `link_to_hotel_ssms` can be resolved to a real location id. */
  hotelMondayIdToLocationId: Map<string, string>;
  boardsProcessed: number;
  durationMs: number;
};

export type HotelLocationImportDeps = {
  mondayApiToken: string;
  db: typeof defaultDb;
  /**
   * Resolves a Monday group title (e.g. "Live: UK Hotels") to a `regions.id`.
   * Returns `null` when the title doesn't match any known region — the
   * importer skips the item and surfaces the title in `unmappedGroupTitles`
   * so the operator can decide whether to add a region or fix Monday.
   */
  resolveRegionIdByGroup: (
    boardId: number,
    groupTitle: string,
  ) => Promise<string | null>;
  logger?: (phase: string, msg: string) => void;
};

const noopLogger = (_phase: string, _msg: string) => {};

function extractOutletCodes(item: MondayItem): string[] {
  const mirror = item.column_values.find((cv) => cv.id === "mirror9");
  const display = mirror?.display_value?.trim();
  if (!display) return [];
  return display
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function runHotelLocationImport(
  deps: HotelLocationImportDeps,
): Promise<HotelLocationImportResult> {
  const { mondayApiToken, db, resolveRegionIdByGroup, logger = noopLogger } = deps;
  const t0 = Date.now();

  // Bridge the dep-injected token into env for the duration of the call —
  // matches the pattern in import-location-products.ts so the shared client
  // (which reads MONDAY_API_TOKEN from env) sees it.
  const previousToken = process.env.MONDAY_API_TOKEN;
  process.env.MONDAY_API_TOKEN = mondayApiToken;

  let locationsInserted = 0;
  let locationsSkippedExisting = 0;
  let hotelsSkippedNoOutletCode = 0;
  let hotelsSkippedNoRegion = 0;
  const unmappedTitles = new Set<string>();
  const hotelMondayIdToLocationId = new Map<string, string>();

  try {
    for (const boardId of HOTEL_BOARD_IDS) {
      logger("hotel-import", `board=${BOARD_NAMES[boardId]} (${boardId}) start`);
      let boardCount = 0;

      for await (const item of iterateBoardItems(boardId, {
        itemFragment: HOTEL_ITEM_FRAGMENT,
      })) {
        boardCount++;
        const outletCodes = extractOutletCodes(item);
        if (outletCodes.length === 0) {
          hotelsSkippedNoOutletCode++;
          continue;
        }

        const groupTitle =
          (item as MondayItem & { group?: { title?: string } }).group?.title ??
          "";
        const primaryRegionId = await resolveRegionIdByGroup(boardId, groupTitle);
        if (!primaryRegionId) {
          hotelsSkippedNoRegion++;
          if (groupTitle) unmappedTitles.add(groupTitle);
          continue;
        }

        // One location per hotel (per the v2 data-model rule "one location per
        // hotel, N kiosks via kiosk_assignments"). The location's primary
        // outlet_code is the FIRST mirror9 code; per-kiosk outlet codes are
        // imported separately from the Monday Assets board.
        const primaryOutletCode = outletCodes[0];
        const inserted = await db
          .insert(locations)
          .values({
            name: item.name,
            normalisedName: normaliseName(item.name),
            outletCode: primaryOutletCode,
            primaryRegionId,
          })
          .onConflictDoNothing({
            target: [locations.primaryRegionId, locations.outletCode],
          })
          .returning({ id: locations.id });

        let locationId: string;
        if (inserted.length > 0) {
          locationsInserted++;
          locationId = inserted[0].id;
        } else {
          locationsSkippedExisting++;
          // Look up the existing row's id so we can still emit the
          // hotel-id → location-id mapping for the assets-import step.
          const existing = await db
            .select({ id: locations.id })
            .from(locations)
            .where(
              and(
                eq(locations.primaryRegionId, primaryRegionId),
                eq(locations.outletCode, primaryOutletCode),
              ),
            )
            .limit(1);
          if (existing.length === 0) continue; // shouldn't happen, defensive
          locationId = existing[0].id;
        }

        hotelMondayIdToLocationId.set(item.id, locationId);
      }

      logger(
        "hotel-import",
        `board=${BOARD_NAMES[boardId]} done (${boardCount} items)`,
      );
    }
  } finally {
    if (previousToken === undefined) {
      delete process.env.MONDAY_API_TOKEN;
    } else {
      process.env.MONDAY_API_TOKEN = previousToken;
    }
  }

  return {
    locationsInserted,
    locationsSkippedExisting,
    hotelsSkippedNoOutletCode,
    hotelsSkippedNoRegion,
    unmappedGroupTitles: [...unmappedTitles].sort(),
    hotelMondayIdToLocationId,
    boardsProcessed: HOTEL_BOARD_IDS.length,
    durationMs: Date.now() - t0,
  };
}
