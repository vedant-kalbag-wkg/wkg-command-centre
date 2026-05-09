import { describe, it, expect } from "vitest";
import { groupByPoc } from "./poc-batching";
import type { ClassifiedKiosk, PocGroup } from "./poc-batching";
import { sha256 } from "./hash";

// ---------------------------------------------------------------------------
// groupByPoc
// ---------------------------------------------------------------------------

describe("groupByPoc", () => {
  it("returns empty array for empty input", () => {
    expect(groupByPoc([])).toEqual([]);
  });

  it("returns a single group for a single kiosk", () => {
    const kiosks: ClassifiedKiosk[] = [
      { kioskId: "k1", internalPocId: "poc-A" },
    ];
    const result = groupByPoc(kiosks);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ pocUserId: "poc-A", kiosks });
  });

  it("groups multiple kiosks with the same POC into one group", () => {
    const kiosks: ClassifiedKiosk[] = [
      { kioskId: "k1", internalPocId: "poc-A" },
      { kioskId: "k2", internalPocId: "poc-A" },
      { kioskId: "k3", internalPocId: "poc-A" },
    ];
    const result = groupByPoc(kiosks);
    expect(result).toHaveLength(1);
    expect(result[0].pocUserId).toBe("poc-A");
    expect(result[0].kiosks).toHaveLength(3);
  });

  it("produces separate groups for different POC IDs", () => {
    const kiosks: ClassifiedKiosk[] = [
      { kioskId: "k1", internalPocId: "poc-A" },
      { kioskId: "k2", internalPocId: "poc-A" },
      { kioskId: "k3", internalPocId: "poc-B" },
    ];
    const result = groupByPoc(kiosks);
    expect(result).toHaveLength(2);
    const pocA = result.find((g) => g.pocUserId === "poc-A")!;
    const pocB = result.find((g) => g.pocUserId === "poc-B")!;
    expect(pocA.kiosks).toHaveLength(2);
    expect(pocB.kiosks).toHaveLength(1);
  });

  it("groups kiosks with null internalPocId as pocUserId: null (sentinel skip bucket)", () => {
    const kiosks: ClassifiedKiosk[] = [
      { kioskId: "k1", internalPocId: null },
      { kioskId: "k2", internalPocId: null },
    ];
    const result = groupByPoc(kiosks);
    expect(result).toHaveLength(1);
    expect(result[0].pocUserId).toBeNull();
    expect(result[0].kiosks).toHaveLength(2);
  });

  it("separates null-POC kiosks from assigned-POC kiosks", () => {
    const kiosks: ClassifiedKiosk[] = [
      { kioskId: "k1", internalPocId: "poc-A" },
      { kioskId: "k2", internalPocId: null },
      { kioskId: "k3", internalPocId: "poc-A" },
    ];
    const result = groupByPoc(kiosks);
    expect(result).toHaveLength(2);
    const pocA = result.find((g) => g.pocUserId === "poc-A")!;
    const nullPoc = result.find((g) => g.pocUserId === null)!;
    expect(pocA.kiosks).toHaveLength(2);
    expect(nullPoc.kiosks).toHaveLength(1);
    expect(nullPoc.kiosks[0].kioskId).toBe("k2");
  });
});

// ---------------------------------------------------------------------------
// sha256 (hash.ts)
// ---------------------------------------------------------------------------

describe("sha256", () => {
  it("returns a 64-character hexadecimal string", () => {
    const hash = sha256("hello");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input yields same output", () => {
    const input = "poc-user-id:2026-W19";
    expect(sha256(input)).toBe(sha256(input));
  });

  it("produces different hashes for different inputs", () => {
    expect(sha256("poc-user-id:2026-W19")).not.toBe(sha256("poc-user-id:2026-W20"));
  });
});
