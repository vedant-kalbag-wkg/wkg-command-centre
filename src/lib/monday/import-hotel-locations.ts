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
// pull `group { id title }` so the runbook can resolve region per item, and
// `location` (LocationValue.text contains the address — the trailing `, <country>`
// is the per-item region fallback when the group title doesn't resolve, e.g.
// for the "Ready to Launch" group on board 1743012104 which mixes UK/DE/ES/PT).
const HOTEL_ITEM_FRAGMENT = `
  id
  name
  group { id title }
  column_values(ids: ["mirror9", "location"]) {
    id
    type
    text
    ... on MirrorValue { display_value }
  }
`;

// Pending-deployment groups: hotels here have `Number of SSMs` set but no
// outlet code yet (mirror9 empty, no Assets entry). Per the operator workflow
// they get imported as placeholder locations (`outlet_code = TODO-<itemId>`)
// so they appear in the system; kiosks are attached when the actual install
// happens. Match is case-insensitive on group title.
const PENDING_GROUP_PATTERNS: RegExp[] = [
  /^\s*ready to launch\s*$/i,
];

// Placeholder outlet code prefix for pending-deployment locations. The Monday
// item id makes it unique within a region and trivially greppable in the UI.
export const PLACEHOLDER_OUTLET_PREFIX = "TODO-";

function isPendingGroup(groupTitle: string): boolean {
  return PENDING_GROUP_PATTERNS.some((re) => re.test(groupTitle));
}

// Pull the trailing country from a Monday LocationValue's `text` field, e.g.
// "Novotel London Bridge, Southwark Bridge Road, London, UK" → "UK". Returns
// the last comma-separated token, trimmed. Used as a region-resolution fallback
// when the group title doesn't match an existing pattern.
function extractCountryFromLocation(item: MondayItem): string | null {
  const cv = item.column_values.find((c) => c.id === "location");
  const text = cv?.text?.trim();
  if (!text) return null;
  const tokens = text.split(",").map((s) => s.trim()).filter(Boolean);
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

export type HotelLocationImportResult = {
  locationsInserted: number;
  locationsSkippedExisting: number;
  hotelsSkippedNoOutletCode: number;
  hotelsSkippedNoRegion: number;
  /** Pending-deployment locations imported with a TODO-<itemId> placeholder
   * outlet code (no kiosk attached). Operator updates outlet_code via the
   * merge/edit UI when the kiosk arrives on Monday. */
  placeholderLocationsCreated: number;
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
  let placeholderLocationsCreated = 0;
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
        const groupTitle =
          (item as MondayItem & { group?: { title?: string } }).group?.title ??
          "";

        // Pending-deployment hotels: mirror9 empty + group is "Ready to Launch".
        // Import as placeholder location, no kiosk attached. Region falls back
        // to the country in the LocationValue (`, UK` / `, Germany` / etc.)
        // since the plain "Ready to Launch" group title doesn't resolve and
        // mixes regions.
        const isPlaceholder = outletCodes.length === 0 && isPendingGroup(groupTitle);

        if (outletCodes.length === 0 && !isPlaceholder) {
          hotelsSkippedNoOutletCode++;
          continue;
        }

        // Resolve region: try group title first, fall back to LocationValue's
        // trailing country token. The runbook's mapper accepts any string and
        // matches against GROUP_TITLE_REGION_PATTERNS, so the country name
        // (e.g. "UK", "Germany", "Spain") drops in cleanly.
        let primaryRegionId = await resolveRegionIdByGroup(boardId, groupTitle);
        if (!primaryRegionId) {
          const country = extractCountryFromLocation(item);
          if (country) {
            primaryRegionId = await resolveRegionIdByGroup(boardId, country);
          }
        }
        if (!primaryRegionId) {
          hotelsSkippedNoRegion++;
          if (groupTitle) unmappedTitles.add(groupTitle);
          continue;
        }

        // One location per hotel (per the v2 data-model rule "one location per
        // hotel, N kiosks via kiosk_assignments"). For deployed hotels: primary
        // outlet_code = first mirror9 code; per-kiosk codes come from Assets.
        // For pending-deployment hotels: primary outlet_code = TODO-<itemId>
        // placeholder; operator updates via merge/edit UI when kiosk arrives.
        const primaryOutletCode = isPlaceholder
          ? `${PLACEHOLDER_OUTLET_PREFIX}${item.id}`
          : outletCodes[0];
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
          if (isPlaceholder) placeholderLocationsCreated++;
          else locationsInserted++;
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
    placeholderLocationsCreated,
    unmappedGroupTitles: [...unmappedTitles].sort(),
    hotelMondayIdToLocationId,
    boardsProcessed: HOTEL_BOARD_IDS.length,
    durationMs: Date.now() - t0,
  };
}
