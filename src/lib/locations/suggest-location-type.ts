import type { LocationType } from "@/lib/analytics/types";

export type LocationSignals = {
  name: string;
  outletCode: string;
  hotelGroup?: string | null;
  numRooms?: number | null;
  starRating?: number | null;
};

/**
 * In-process mirror of the SQL classifier in `scripts/backfill-location-type.ts`
 * (that script is the source of truth). First match wins:
 *   1. outletCode === "IN"              → "online"
 *   2. outletCode === "BK"              → "retail_desk"
 *   3. name LIKE "Hex SSM %"            → "hex_kiosk"
 *   4. name LIKE "Heathrow Terminal%" / "Heathrow underground%" / "T_ Mobile%" / "T_ Ambassador%" → "airport"
 *   5. hotelGroup / numRooms / starRating present → "hotel"
 * Otherwise returns null.
 */
export function suggestLocationType(loc: LocationSignals): LocationType | null {
  if (loc.outletCode === "IN") return "online";
  if (loc.outletCode === "BK") return "retail_desk";
  if (/^Hex SSM /i.test(loc.name)) return "hex_kiosk";
  if (
    /^Heathrow Terminal/i.test(loc.name) ||
    /^Heathrow underground/i.test(loc.name) ||
    /^T.\sMobile/i.test(loc.name) ||
    /^T.\sAmbassador/i.test(loc.name)
  ) {
    return "airport";
  }
  if (loc.hotelGroup || loc.numRooms != null || loc.starRating != null) return "hotel";
  return null;
}
