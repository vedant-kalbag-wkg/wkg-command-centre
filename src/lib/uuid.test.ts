import { describe, it, expect } from "vitest";
import { UUID_REGEX, isUuid, assertUuid, assertUuidArray } from "@/lib/uuid";

describe("UUID validator (Phase 9.1 CR-01 / WR-04)", () => {
  it("UUID_REGEX accepts a valid v4", () => {
    expect(UUID_REGEX.test("0c2a3b1d-1234-4abc-89ef-0123456789ab")).toBe(true);
  });

  it("UUID_REGEX accepts uppercase", () => {
    expect(UUID_REGEX.test("0C2A3B1D-1234-4ABC-89EF-0123456789AB")).toBe(true);
  });

  it("isUuid rejects empty / too-short / wrong shape / SQLi probe", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("0c2a3b1d-1234-4abc-89ef")).toBe(false);
    expect(isUuid("'/**/UNION/**/SELECT/**/null--")).toBe(false);
  });

  it("assertUuid throws naming the value", () => {
    expect(() => assertUuid("not-a-uuid")).toThrow(/Invalid UUID:/);
  });

  it("assertUuidArray throws on first non-UUID, naming it", () => {
    expect(() =>
      assertUuidArray([
        "0c2a3b1d-1234-4abc-89ef-0123456789ab",
        "bad",
        "0c2a3b1d-1234-4abc-89ef-0123456789ac",
      ]),
    ).toThrow(/Invalid UUID in array:.*bad/);
  });
});
