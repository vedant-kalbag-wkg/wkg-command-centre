import { describe, it, expect, vi } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// `mergeComparisonResults` is a pure function but lives in pivot.ts alongside
// `executePivot`, which transitively imports `@/db`. Stub the DB-touching
// edges so the import graph resolves without a live Postgres URL — same shape
// as portfolio.test.ts / heat-map.test.ts.

vi.mock("@/db", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("@/db/execute-rows", () => ({
  executeRows: vi.fn(),
}));

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics/active-locations", () => ({
  buildActiveLocationConditionForRawContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics/cached-query", () => ({
  wrapAnalyticsQuery: <T>(fn: T) => fn,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { mergeComparisonResults } from "./pivot";
import type { PivotResponse } from "@/lib/analytics/types";

// Helper: trivial PivotResponse builder for the tests below.
function pivotResponse(
  rows: Array<{ dim: string; cells: Record<string, number> }>,
  grandTotals: Record<string, number>,
  headers: string[],
): PivotResponse {
  return {
    headers,
    rows: rows.map(({ dim, cells }) => ({
      dimensions: { hotel_name: dim },
      cells: Object.fromEntries(
        Object.entries(cells).map(([k, v]) => [
          k,
          { value: v, formatted: String(v) },
        ]),
      ),
    })),
    grandTotals: Object.fromEntries(
      Object.entries(grandTotals).map(([k, v]) => [
        k,
        { value: v, formatted: String(v) },
      ]),
    ),
    rowCount: rows.length,
    truncated: false,
  };
}

// ─── Task 2.6 — comparison columns key-match, not positional ───────────────

describe("mergeComparisonResults (Task 2.6)", () => {
  it("attributes prev-period values by exact key when row sets differ between periods", () => {
    // Current period rows: A, B, C (in that order).
    // Prev period rows:    B, C    (A is missing).
    //
    // Old positional logic indexed prevRows[i] alongside currentRows[i] inside
    // the same key bucket — but when row sets differ, even per-row cells could
    // be paired against the wrong prev cell after a Map miss. Here we assert
    // exact key matching: A has no prev, B and C match by name.
    const current = pivotResponse(
      [
        { dim: "A", cells: { sum_net_amount: 100 } },
        { dim: "B", cells: { sum_net_amount: 200 } },
        { dim: "C", cells: { sum_net_amount: 300 } },
      ],
      { sum_net_amount: 600 },
      ["Hotel", "Sum of Revenue"],
    );

    const prev = pivotResponse(
      [
        { dim: "B", cells: { sum_net_amount: 100 } },
        { dim: "C", cells: { sum_net_amount: 200 } },
      ],
      { sum_net_amount: 300 },
      ["Hotel", "Sum of Revenue"],
    );

    const merged = mergeComparisonResults(current, prev, ["hotel_name"]);

    // Row A has no prev — must render "—" not a wrong delta.
    const rowA = merged.rows.find((r) => r.dimensions.hotel_name === "A")!;
    expect(rowA.cells["sum_net_amount_change"].formatted).toBe("—");
    expect(rowA.cells["sum_net_amount_change"].value).toBe(0);

    // Row B: 200 vs prev 100 → +100%.
    const rowB = merged.rows.find((r) => r.dimensions.hotel_name === "B")!;
    expect(rowB.cells["sum_net_amount_change"].value).toBe(100);

    // Row C: 300 vs prev 200 → +50%.
    const rowC = merged.rows.find((r) => r.dimensions.hotel_name === "C")!;
    expect(rowC.cells["sum_net_amount_change"].value).toBe(50);
  });

  it("matches per-cell prev values by key when crosstab columns differ between periods", () => {
    // Current has Jan + Feb columns; prev has Feb + Mar. Old positional logic
    // would pair current Jan with prev Feb (both at index 0), inflating Jan's
    // change against unrelated data. Key-matching: Jan has no prev, Feb pairs
    // with Feb.
    const current = pivotResponse(
      [{ dim: "A", cells: { "Jan 2025": 100, "Feb 2025": 200 } }],
      { "Jan 2025": 100, "Feb 2025": 200 },
      ["Hotel", "Jan 2025", "Feb 2025"],
    );

    const prev = pivotResponse(
      [{ dim: "A", cells: { "Feb 2025": 50, "Mar 2025": 80 } }],
      { "Feb 2025": 50, "Mar 2025": 80 },
      ["Hotel", "Feb 2025", "Mar 2025"],
    );

    const merged = mergeComparisonResults(current, prev, ["hotel_name"]);

    const rowA = merged.rows[0];
    // Jan has no prev → "—", NOT an erroneous delta against prev Feb.
    expect(rowA.cells["Jan 2025_change"].formatted).toBe("—");
    // Feb 200 vs prev Feb 50 → +300%.
    expect(rowA.cells["Feb 2025_change"].value).toBe(300);
  });

  it("matches grand totals by key, not by ordinal position", () => {
    // Mirror the per-row test for grand totals: current's Jan should NOT
    // borrow prev's Feb just because both sit at column index 0.
    const current = pivotResponse(
      [{ dim: "A", cells: { "Jan 2025": 100, "Feb 2025": 200 } }],
      { "Jan 2025": 100, "Feb 2025": 200 },
      ["Hotel", "Jan 2025", "Feb 2025"],
    );

    const prev = pivotResponse(
      [{ dim: "A", cells: { "Feb 2025": 50, "Mar 2025": 80 } }],
      { "Feb 2025": 50, "Mar 2025": 80 },
      ["Hotel", "Feb 2025", "Mar 2025"],
    );

    const merged = mergeComparisonResults(current, prev, ["hotel_name"]);

    expect(merged.grandTotals["Jan 2025_change"].formatted).toBe("—");
    expect(merged.grandTotals["Feb 2025_change"].value).toBe(300);
  });

  it("renders 'New' when prev value is zero and current is positive", () => {
    const current = pivotResponse(
      [{ dim: "A", cells: { sum_net_amount: 100 } }],
      { sum_net_amount: 100 },
      ["Hotel", "Sum of Revenue"],
    );
    const prev = pivotResponse(
      [{ dim: "A", cells: { sum_net_amount: 0 } }],
      { sum_net_amount: 0 },
      ["Hotel", "Sum of Revenue"],
    );

    const merged = mergeComparisonResults(current, prev, ["hotel_name"]);
    expect(merged.rows[0].cells["sum_net_amount_change"].formatted).toBe("New");
    expect(merged.grandTotals["sum_net_amount_change"].formatted).toBe("New");
  });
});
