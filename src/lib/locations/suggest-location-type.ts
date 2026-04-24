import type { LocationType } from "@/lib/analytics/types";

export type LocationSignals = {
  name: string;
  outletCode: string;
  hotelGroup?: string | null;
  numRooms?: number | null;
  starRating?: number | null;
};

export function suggestLocationType(loc: LocationSignals): LocationType | null {
  if (loc.outletCode === "IN") return "online";
  if (loc.outletCode === "BK") return "retail_desk";
  if (/^Hex SSM /i.test(loc.name)) return "hex_kiosk";
  if (
    /^Heathrow Terminal/i.test(loc.name) ||
    /^Heathrow underground/i.test(loc.name) ||
    /^T.\s?Mobile/i.test(loc.name) ||
    /^T.\s?Ambassador/i.test(loc.name)
  ) {
    return "airport";
  }
  if (loc.hotelGroup || loc.numRooms != null || loc.starRating != null) return "hotel";
  return null;
}
