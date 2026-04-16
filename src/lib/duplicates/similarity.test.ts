import { describe, it, expect } from "vitest";
import {
  normalizeForMatch,
  bigramJaccard,
  haversineMeters,
  scorePair,
} from "./similarity";

describe("normalizeForMatch", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeForMatch("  Hilton, London  Kensington! ")).toBe(
      "hilton london kensington"
    );
  });
  it("strips trailing [code] suffixes", () => {
    expect(normalizeForMatch("Hilton London [WK-001]")).toBe("hilton london");
  });
  it("returns empty string for null/undefined", () => {
    expect(normalizeForMatch(null)).toBe("");
    expect(normalizeForMatch(undefined)).toBe("");
  });
  it("strips diacritics (Café → cafe, Zürich → zurich)", () => {
    expect(normalizeForMatch("Café Royal")).toBe("cafe royal");
    expect(normalizeForMatch("Zürich Grand Hôtel")).toBe("zurich grand hotel");
  });
});

describe("bigramJaccard", () => {
  it("returns 1 for identical strings", () => {
    expect(bigramJaccard("hilton london", "hilton london")).toBe(1);
  });
  it("returns 0 for fully disjoint strings", () => {
    expect(bigramJaccard("abc", "xyz")).toBe(0);
  });
  it("returns ~0.85+ for near-identical hotel names", () => {
    expect(
      bigramJaccard("hilton london kensington", "hilton london kensington")
    ).toBeGreaterThanOrEqual(0.85);
  });
  it("returns < 0.75 for same-chain different-property", () => {
    expect(
      bigramJaccard(
        "hilton london kensington",
        "hilton london paddington"
      )
    ).toBeLessThan(0.75);
  });
  it("handles short strings without crashing", () => {
    expect(bigramJaccard("a", "a")).toBe(1);
    expect(bigramJaccard("", "")).toBe(0);
  });
});

describe("haversineMeters", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineMeters(51.5, -0.1, 51.5, -0.1)).toBeCloseTo(0, 1);
  });
  it("returns ~111km for 1 degree of latitude", () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112000);
  });
});

describe("scorePair", () => {
  const base = {
    id: "a",
    name: "Hilton London Kensington",
    customerCode: null,
    hotelGroup: null,
    latitude: null,
    longitude: null,
  };

  it("scores identical names ~1.0", () => {
    const r = scorePair(base, { ...base, id: "b" });
    expect(r.score).toBeGreaterThanOrEqual(0.95);
    expect(r.reasons).toContain("name");
  });

  it("boosts when customer codes match exactly", () => {
    const a = { ...base, customerCode: "WK-001" };
    const b = { ...base, id: "b", name: "The Hilton Kensington", customerCode: "WK-001" };
    const r = scorePair(a, b);
    expect(r.reasons).toContain("code");
    expect(r.score).toBeGreaterThan(bigramJaccard(
      normalizeForMatch(a.name),
      normalizeForMatch(b.name)
    ));
    // Pin CODE_BOOST magnitude: score == min(1, nameSim + 0.15)
    expect(r.score).toBeCloseTo(
      Math.min(1, r.nameSimilarity + 0.15),
      5
    );
  });

  it("boosts when within 200m geo proximity", () => {
    const a = { ...base, latitude: 51.5, longitude: -0.1 };
    const b = { ...base, id: "b", name: "Hilton Ken.", latitude: 51.5001, longitude: -0.1 };
    const r = scorePair(a, b);
    expect(r.reasons).toContain("geo");
  });

  it("does NOT boost geo when coords missing on either side", () => {
    const a = { ...base, latitude: 51.5, longitude: -0.1 };
    const b = { ...base, id: "b", latitude: null, longitude: null };
    const r = scorePair(a, b);
    expect(r.reasons).not.toContain("geo");
  });

  it("clamps score at 1.0", () => {
    const a = { ...base, customerCode: "X", hotelGroup: "Hilton", latitude: 51.5, longitude: -0.1 };
    const b = { ...a, id: "b" };
    const r = scorePair(a, b);
    expect(r.score).toBeLessThanOrEqual(1.0);
  });

  it("does NOT stack boosts when name similarity is below threshold", () => {
    const a = {
      id: "a",
      name: "Hilton London Kensington",
      customerCode: "X",
      hotelGroup: "Hilton",
      latitude: 51.5,
      longitude: -0.1,
    };
    const b = {
      id: "b",
      name: "Marriott Tokyo Airport",
      customerCode: "X",
      hotelGroup: "Hilton",
      latitude: 51.5,
      longitude: -0.1,
    };
    const r = scorePair(a, b);
    expect(r.reasons).not.toContain("code");
    expect(r.reasons).not.toContain("geo");
    expect(r.reasons).not.toContain("group");
    expect(r.score).toBe(r.nameSimilarity);
  });

  it("still reports distanceMeters even when geo boost is gated off by low name sim", () => {
    const a = {
      id: "a",
      name: "Hilton London Kensington",
      customerCode: null,
      hotelGroup: null,
      latitude: 51.5,
      longitude: -0.1,
    };
    const b = {
      id: "b",
      name: "Marriott Tokyo Airport",
      customerCode: null,
      hotelGroup: null,
      latitude: 51.5,
      longitude: -0.1,
    };
    const r = scorePair(a, b);
    expect(r.distanceMeters).toBeCloseTo(0, 1);
    expect(r.reasons).not.toContain("geo");
  });
});
