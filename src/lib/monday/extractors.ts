/**
 * Pure extractors that turn Monday `MondayColumnValue` shapes into the
 * field types the `locations` Drizzle schema expects. Shared by
 * `runHotelLocationImport` (`import-hotel-locations.ts`) and
 * `runHeathrowImport` (`import-heathrow.ts`) so column-handling stays
 * consistent across the two importers that write into `locations`.
 *
 * Every function is side-effect-free: no DB, no Monday client, no env. The
 * column shapes covered here are populated by the typed inline fragments
 * the importers attach to their `column_values(...)` queries — e.g.
 * `... on LocationValue { lat lng }` populates `cv.lat`/`cv.lng` even
 * though the base `MondayColumnValue` type doesn't declare them.
 */

import type { MondayColumnValue, MondayItem } from "@/lib/monday/client";

type ColWithLatLng = MondayColumnValue & {
  lat?: number | null;
  lng?: number | null;
};

type ColWithLinkedIds = MondayColumnValue & {
  linked_item_ids?: string[] | null;
};

function findColumn(
  item: MondayItem,
  columnId: string,
): MondayColumnValue | undefined {
  return item.column_values.find((c) => c.id === columnId);
}

/** Trim and return null for empty/whitespace strings. */
function trimToNull(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

/**
 * LocationValue → `{ address, latitude, longitude }`. `text` is the
 * formatted address, `lat`/`lng` come from the LocationValue inline
 * fragment when included in the importer's GraphQL fragment.
 */
export function extractLocationValue(
  item: MondayItem,
  columnId = "location",
): { address: string | null; latitude: number | null; longitude: number | null } {
  const cv = findColumn(item, columnId) as ColWithLatLng | undefined;
  return {
    address: trimToNull(cv?.text),
    latitude: typeof cv?.lat === "number" ? cv.lat : null,
    longitude: typeof cv?.lng === "number" ? cv.lng : null,
  };
}

/**
 * DropdownValue → array of label strings, trimmed and de-empty'd. Single
 * label → 1-element array; multi-label ("Arora, Radisson Hotels") → N
 * elements; unset → empty array.
 */
export function extractDropdownLabels(
  item: MondayItem,
  columnId: string,
): string[] {
  const text = trimToNull(findColumn(item, columnId)?.text);
  if (!text) return [];
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** StatusValue's `text` is the human label ("Phase 0", "Live", etc.). */
export function extractMondayStatusLabel(
  item: MondayItem,
  columnId: string,
): string | null {
  return trimToNull(findColumn(item, columnId)?.text);
}

/**
 * DateValue → `Date`. Monday returns date-only ("2023-08-31") or
 * date-with-time ("2023-08-31 15:06"). Both parse cleanly via the JS
 * `Date` constructor. Returns null on empty / unparseable.
 */
export function extractMondayDate(
  item: MondayItem,
  columnId: string,
): Date | null {
  const text = trimToNull(findColumn(item, columnId)?.text);
  if (!text) return null;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** NumbersValue → number. Empty / non-numeric → null. */
export function extractMondayNumber(
  item: MondayItem,
  columnId: string,
): number | null {
  const text = trimToNull(findColumn(item, columnId)?.text);
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** RatingValue's `text` is the integer rating ("1"-"5"). */
export function extractMondayRating(
  item: MondayItem,
  columnId: string,
): number | null {
  return extractMondayNumber(item, columnId);
}

/**
 * BoardRelationValue → first linked item id. Importers that need every
 * linked id should access `column_values[*].linked_item_ids` directly;
 * the hotel/Heathrow importers only need a single link target.
 */
export function extractLinkedItemId(
  item: MondayItem,
  columnId: string,
): string | null {
  const cv = findColumn(item, columnId) as ColWithLinkedIds | undefined;
  const ids = cv?.linked_item_ids ?? [];
  return ids.length > 0 ? ids[0] : null;
}

/** Plain TextValue / EmailValue / LongTextValue → trimmed string or null. */
export function extractMondayText(
  item: MondayItem,
  columnId: string,
): string | null {
  return trimToNull(findColumn(item, columnId)?.text);
}

/**
 * Pull the trailing country token from a Monday LocationValue's `text`, e.g.
 * "Novotel London Bridge, Southwark Bridge Road, London, UK" → "UK". Used as
 * a region-resolution fallback when the group title doesn't match an existing
 * pattern. Returns the last comma-separated token, trimmed; single-token text
 * returns that token; empty / missing column returns null.
 */
export function extractCountryFromLocation(
  item: MondayItem,
  columnId = "location",
): string | null {
  const text = trimToNull(findColumn(item, columnId)?.text);
  if (!text) return null;
  const tokens = text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}
