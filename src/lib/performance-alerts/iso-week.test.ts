import { describe, it, expect } from "vitest";
import { isoWeekKey } from "./iso-week";

describe("isoWeekKey", () => {
  // ISO-8601 week numbers computed in Europe/London wall-clock time.
  // The critical boundary: 2026-W53 ends Sunday 2027-01-03, 2027-W01 starts Monday 2027-01-04.

  it("returns correct week for a mid-year Monday (2026-05-04)", () => {
    // 2026-05-04 is Monday of ISO week 2026-W19
    expect(isoWeekKey(new Date("2026-05-04T00:00:00Z"))).toBe("2026-W19");
  });

  it("returns correct week for a mid-year Thursday (2026-05-07)", () => {
    // Thursday of the same week
    expect(isoWeekKey(new Date("2026-05-07T00:00:00Z"))).toBe("2026-W19");
  });

  it("returns W53 for Monday 2026-12-28 (last ISO week of 2026)", () => {
    // 2026-12-28 Monday — still in ISO year 2026 W53
    expect(isoWeekKey(new Date("2026-12-28T00:00:00Z"))).toBe("2026-W53");
  });

  it("returns W53 for Thursday 2026-12-31", () => {
    // 2026-12-31 Thursday — still in W53 (Thursday rule determines ISO year)
    expect(isoWeekKey(new Date("2026-12-31T00:00:00Z"))).toBe("2026-W53");
  });

  it("returns W53 for Sunday 2027-01-03 (last day of 2026-W53)", () => {
    // Sunday is still in 2026-W53
    expect(isoWeekKey(new Date("2027-01-03T00:00:00Z"))).toBe("2026-W53");
  });

  it("returns W01 for Monday 2027-01-04 (first day of 2027)", () => {
    // Monday 2027-01-04 flips to 2027-W01
    expect(isoWeekKey(new Date("2027-01-04T00:00:00Z"))).toBe("2027-W01");
  });

  it("handles BST: a datetime that is Monday in London but Sunday in UTC", () => {
    // 2026-05-31T23:30:00Z = Sunday 23:30 UTC
    // BUT in Europe/London (BST = UTC+1): it's Monday 00:30 → 2026-W23.
    // The previous version used 2026-06-01T00:00:00Z which is Monday in BOTH
    // UTC and London (01:00 BST), so it didn't actually exercise the boundary.
    // This timestamp is genuinely Sunday in UTC (W22) and Monday in London (W23) —
    // the assertion proves we use London wall-clock, not UTC.
    expect(isoWeekKey(new Date("2026-05-31T23:30:00Z"))).toBe("2026-W23");
  });

  it("pads single-digit week numbers with leading zero", () => {
    // 2026-01-05 is Monday of 2026-W02 (2026-W01 started 2025-12-29)
    expect(isoWeekKey(new Date("2026-01-05T00:00:00Z"))).toBe("2026-W02");
  });
});
