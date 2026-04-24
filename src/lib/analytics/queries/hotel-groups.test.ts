import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockExecute = vi.fn();

vi.mock("@/db", () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}));

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics/queries/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics/queries/shared")>();
  return {
    ...actual,
    buildExclusionCondition: vi.fn().mockResolvedValue(undefined),
    buildDateCondition: vi.fn().mockReturnValue(undefined),
    buildDimensionFilters: vi.fn().mockReturnValue([]),
    buildMaturityCondition: vi.fn().mockReturnValue(undefined),
    combineConditions: vi.fn().mockReturnValue(undefined),
  };
});

// ─── Import after mocks ─────────────────────────────────────────────────────

import { getHotelGroupsList } from "./hotel-groups";
import type { AnalyticsFilters } from "@/lib/analytics/types";
import type { UserCtx } from "@/lib/scoping/scoped-query";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const filters: AnalyticsFilters = {
  dateFrom: "2025-01-01",
  dateTo: "2025-06-30",
};

const userCtx: UserCtx = {
  id: "test-user",
  userType: "internal",
  role: "admin",
};

/**
 * The post-rewrite query returns group-level totals assembled by the SQL
 * engine (CTE pre-aggregates per location, outer aggregates per hotel group).
 * From the TypeScript side we just consume whatever the outer SELECT
 * produced, so the unit test verifies the function reads the columns the
 * outer SELECT aliases (group_id, group_name, revenue, transactions,
 * hotel_count) and threads previous-period deltas correctly.
 */
const currentRows = [
  {
    group_id: "hg-1",
    group_name: "Luxury Collection",
    revenue: "50000",
    transactions: "200",
    hotel_count: "5",
  },
  {
    group_id: "hg-2",
    group_name: "Budget Chain",
    revenue: "20000",
    transactions: "500",
    hotel_count: "10",
  },
];

const prevRows = [
  { group_id: "hg-1", revenue: "40000", transactions: "180" },
  // hg-2 has no previous period data — tests the null-delta branch
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("getHotelGroupsList – shape + delta wiring", () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it("returns one row per hotel group with numeric fields and period deltas", async () => {
    mockExecute
      .mockResolvedValueOnce(currentRows) // current period CTE query
      .mockResolvedValueOnce(prevRows); // previous period CTE query

    const result = await getHotelGroupsList(filters, userCtx);

    expect(result).toHaveLength(2);

    const luxury = result.find((r) => r.id === "hg-1")!;
    expect(luxury.name).toBe("Luxury Collection");
    expect(luxury.revenue).toBe(50000);
    expect(luxury.transactions).toBe(200);
    expect(luxury.hotelCount).toBe(5);
    // calculatePeriodChange returns percent: ((50000-40000)/40000)*100 = 25
    expect(luxury.revenueChange).toBeCloseTo(25, 4);
    // ((200-180)/180)*100 ≈ 11.11
    expect(luxury.transactionChange).toBeCloseTo(11.11, 1);

    const budget = result.find((r) => r.id === "hg-2")!;
    expect(budget.revenue).toBe(20000);
    expect(budget.transactions).toBe(500);
    expect(budget.hotelCount).toBe(10);
    // No previous period → null deltas
    expect(budget.revenueChange).toBeNull();
    expect(budget.transactionChange).toBeNull();
  });

  it("issues exactly two db.execute calls (current CTE + previous CTE)", async () => {
    mockExecute
      .mockResolvedValueOnce(currentRows)
      .mockResolvedValueOnce(prevRows);

    await getHotelGroupsList(filters, userCtx);

    // No hidden third query — the rewrite keeps the same 2-statement shape
    // as the original implementation.
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("current-period SQL uses pre-aggregating CTE (structural guard against regression)", async () => {
    mockExecute
      .mockResolvedValueOnce(currentRows)
      .mockResolvedValueOnce([]);

    await getHotelGroupsList(filters, userCtx);

    // Structural smoke-test: reconstruct the static portions of the Drizzle
    // query from .queryChunks to confirm the CTE template is intact. Table
    // and column references are emitted as Drizzle column objects (not raw
    // strings) so they don't appear here — we only assert on the literal SQL
    // skeleton. If someone reverts to the pre-rewrite single-SELECT shape
    // (which spills 9 MB to disk), this test fails because "WITH loc_agg"
    // and "FROM loc_agg la" will no longer be in the chunks.
    const firstCallArg = mockExecute.mock.calls[0]![0] as {
      queryChunks: unknown[];
    };
    const sqlText = firstCallArg.queryChunks
      .filter((c): c is { value: [string] } =>
        typeof c === "object" &&
        c !== null &&
        "value" in c &&
        Array.isArray((c as { value: unknown }).value),
      )
      .map((c) => c.value[0])
      .join("");

    expect(sqlText).toMatch(/WITH loc_agg AS/i);
    expect(sqlText).toMatch(/FROM loc_agg la/i);
    expect(sqlText).toMatch(/COUNT\(DISTINCT la\.location_id\)/i);
    expect(sqlText).toMatch(/SUM\(la\.transactions\)/i);
  });

  it("handles empty result set (no hotel groups in period)", async () => {
    mockExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await getHotelGroupsList(filters, userCtx);

    expect(result).toEqual([]);
  });
});
