import { describe, expect, test } from "vitest";
import { suggestLocationType } from "./suggest-location-type";

describe("suggestLocationType", () => {
  test("outlet_code 'IN' → online", () => {
    expect(suggestLocationType({ name: "Whatever", outletCode: "IN" })).toBe("online");
  });
  test("outlet_code 'BK' → retail_desk", () => {
    expect(suggestLocationType({ name: "Whatever", outletCode: "BK" })).toBe("retail_desk");
  });
  test("name starting 'Hex SSM ' → hex_kiosk", () => {
    expect(suggestLocationType({ name: "Hex SSM Heathrow T2", outletCode: "HX2" })).toBe("hex_kiosk");
  });
  test("Heathrow Terminal → airport", () => {
    expect(suggestLocationType({ name: "Heathrow Terminal 5", outletCode: "T5" })).toBe("airport");
  });
  test("Heathrow underground → airport", () => {
    expect(suggestLocationType({ name: "Heathrow underground POD", outletCode: "UG1" })).toBe("airport");
  });
  test("T_ Mobile → airport", () => {
    expect(suggestLocationType({ name: "T5 Mobile 01", outletCode: "M01" })).toBe("airport");
  });
  test("T_ Ambassador → airport", () => {
    expect(suggestLocationType({ name: "T3 Ambassador Suite", outletCode: "AMB" })).toBe("airport");
  });
  test("has hotel signals (numRooms) → hotel", () => {
    expect(suggestLocationType({ name: "Hilton Mayfair", outletCode: "HM", numRooms: 200 })).toBe("hotel");
  });
  test("has hotel signals (starRating) → hotel", () => {
    expect(suggestLocationType({ name: "Mandarin Oriental", outletCode: "MO", starRating: 5 })).toBe("hotel");
  });
  test("has hotel signals (hotelGroup) → hotel", () => {
    expect(suggestLocationType({ name: "Some Property", outletCode: "SP", hotelGroup: "Hilton" })).toBe("hotel");
  });
  test("no signals → null", () => {
    expect(suggestLocationType({ name: "Random Name", outletCode: "XYZ" })).toBeNull();
  });
  test("first match wins — IN outletCode beats Hex-named hotel", () => {
    expect(suggestLocationType({ name: "Hex SSM IN", outletCode: "IN" })).toBe("online");
  });
  test("numRooms: 0 still counts as hotel signal", () => {
    expect(suggestLocationType({ name: "X", outletCode: "X", numRooms: 0 })).toBe("hotel");
  });
  test("starRating: 0 still counts as hotel signal", () => {
    expect(suggestLocationType({ name: "X", outletCode: "X", starRating: 0 })).toBe("hotel");
  });
});
