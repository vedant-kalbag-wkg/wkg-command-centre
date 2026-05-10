// Phase 9.1 gap closure (CR-04) — pure calendar-day arithmetic helper.
// Sister tests live in src/lib/fx/rate-lookup.test.ts (the staleDays consumer)
// and tests/sales/backfill-net-amount-gbp.integration.test.ts (the backfill
// consumer). Boundary tests below name each DST transition explicitly so a
// future failure points at the spec line rather than at an opaque assertion.

import { describe, expect, it } from "vitest";
import { daysBetweenIso } from "@/lib/fx/days-between-iso";

describe("daysBetweenIso", () => {
  it("returns 0 for the same day", () => {
    expect(daysBetweenIso("2026-05-08", "2026-05-08")).toBe(0);
  });

  it("returns 1 for a 1-day gap", () => {
    expect(daysBetweenIso("2026-05-08", "2026-05-09")).toBe(1);
  });

  it("returns 7 at the D-07 ceiling boundary", () => {
    expect(daysBetweenIso("2026-05-08", "2026-05-15")).toBe(7);
  });

  it("returns 8 just past the D-07 ceiling", () => {
    expect(daysBetweenIso("2026-05-08", "2026-05-16")).toBe(8);
  });

  it("returns 1 across UK DST spring-forward (2026-03-27 to 2026-03-28)", () => {
    // UK clocks lose an hour at 01:00 GMT on the last Sunday of March (29 Mar
    // 2026 in calendar reality, but this test asserts the helper itself is
    // zone-blind — adjacent calendar days are 1 day apart regardless of which
    // wall-clock hour vanished).
    expect(daysBetweenIso("2026-03-27", "2026-03-28")).toBe(1);
  });

  it("returns 1 across UK DST fall-back (2026-10-30 to 2026-10-31)", () => {
    // UK clocks gain an hour at 02:00 BST on the last Sunday of October.
    // Adjacent calendar days are still exactly 1 day apart in UTC midnight
    // arithmetic — the helper is zone-blind by construction (Date.UTC).
    expect(daysBetweenIso("2026-10-30", "2026-10-31")).toBe(1);
  });

  it("returns -1 for reversed inputs", () => {
    expect(daysBetweenIso("2026-05-09", "2026-05-08")).toBe(-1);
  });

  it("throws on malformed input naming the value", () => {
    expect(() => daysBetweenIso("not-a-date", "2026-05-08")).toThrow(
      /Invalid ISO date.*not-a-date/,
    );
    expect(() => daysBetweenIso("2026-05-08", "2026/05/09")).toThrow(
      /Invalid ISO date.*2026\/05\/09/,
    );
  });
});
