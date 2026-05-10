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

// Phase 9.1 CR-03 — hotel-groups.ts now imports buildActiveLocationCondition
// directly from @/lib/analytics/active-locations (not via the legacy alias in
// shared.ts). Mock here to short-circuit the active-locations DB lookup the
// same way regions.test.ts does — keeps mockExecute call counts stable.
vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi.fn().mockResolvedValue([]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi
    .fn()
    .mockResolvedValue(undefined),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { getHotelGroupsList, getHotelGroupDetail } from "./hotel-groups";
import type { AnalyticsFilters } from "@/lib/analytics/types";
import type { UserCtx } from "@/lib/scoping/scoped-query";

/**
 * Recursively flatten Drizzle's nested queryChunks tree into a literal SQL
 * skeleton. Drizzle interleaves literal string fragments with column/table
 * refs and (crucially) child sql`...` objects; we recurse into nested
 * `queryChunks`/`chunks` arrays and concat every literal fragment. This is
 * enough to assert structural rewrites (presence of EXISTS, absence of an
 * INNER JOIN onto the membership table) regardless of how deeply nested the
 * predicate has been combined.
 */
function chunksToSql(arg: unknown): string {
  if (arg == null) return "";
  if (typeof arg === "string") return arg;
  if (Array.isArray(arg)) return arg.map(chunksToSql).join("");
  if (typeof arg === "object") {
    const obj = arg as Record<string, unknown>;
    // Literal string fragment chunk: { value: [string] }
    if (Array.isArray(obj.value) && typeof obj.value[0] === "string") {
      return obj.value[0];
    }
    // Nested SQL object: walk queryChunks/chunks if present
    if (Array.isArray(obj.queryChunks)) return chunksToSql(obj.queryChunks);
    if (Array.isArray(obj.chunks)) return chunksToSql(obj.chunks);
  }
  return "";
}

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
 * outer SELECT aliases (group_id, group_name, revenue_native, revenue_gbp,
 * currency_key, transactions, hotel_count) and threads previous-period
 * deltas correctly.
 *
 * Phase 9.1 / FX-03 (D-11/D-12): outer SELECT now dual-emits revenue_native
 * + revenue_gbp + currency_key. Public `revenue` field on HotelGroupData
 * binds to the GBP arm so cross-group ranking is currency-agnostic.
 */
const currentRows = [
  {
    group_id: "hg-1",
    group_name: "Luxury Collection",
    revenue_native: "50000",
    revenue_gbp: "50000",
    currency_key: "GBP",
    transactions: "200",
    hotel_count: "5",
  },
  {
    group_id: "hg-2",
    group_name: "Budget Chain",
    revenue_native: "20000",
    revenue_gbp: "20000",
    currency_key: "GBP",
    transactions: "500",
    hotel_count: "10",
  },
];

const prevRows = [
  { group_id: "hg-1", revenue_native: "40000", revenue_gbp: "40000", currency_key: "GBP", transactions: "180" },
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

// ─── D5 Part E — multi-group fan-out guard ──────────────────────────────────
//
// Hotel groups stay N:N with locations (Resolved Decision D5). The previous
// `getHotelGroupDetail` body INNER JOIN'd through location_hotel_group_
// memberships and filtered by `hotel_groups.id IN (selectedGroupIds)`,
// which fanned a multi-group location's sales out across each matching
// membership and double-counted them inside the response. The rewrite
// replaces that JOIN+IN with a WHERE EXISTS predicate against the membership
// table — semantically equivalent for single-group locations, but qualifies
// each sales row exactly once for multi-group locations regardless of how
// many of the selected groups they belong to.
//
// We need the real `combineConditions` here so the EXISTS predicate actually
// makes it into the emitted SQL skeleton (the suite-level mock returns
// undefined and would elide the entire WHERE clause). Behavioural assertions
// then verify the rewritten query body returns one row per location, not
// one row per (location, matching-group) pair.
describe("getHotelGroupDetail – multi-group fan-out guard (D5 Part E)", () => {
  beforeEach(async () => {
    mockExecute.mockReset();
    // Restore the real combineConditions for these structural assertions.
    const sharedActual =
      await vi.importActual<typeof import("@/lib/analytics/queries/shared")>(
        "@/lib/analytics/queries/shared",
      );
    const sharedMock = await import("@/lib/analytics/queries/shared");
    (sharedMock as unknown as { combineConditions: typeof sharedActual.combineConditions })
      .combineConditions = sharedActual.combineConditions;
  });

  it("emits EXISTS membership predicate (not INNER JOIN onto memberships) in the summary query", async () => {
    // Four queries in getHotelGroupDetail: summary, hotel breakdown, daily
    // trends, prev-period summary. Mock all four with empty/zero results.
    mockExecute
      .mockResolvedValueOnce([{ revenue_native: "0", revenue_gbp: "0", currency_key: null, transactions: "0", hotel_count: "0" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ revenue_native: "0", revenue_gbp: "0", currency_key: null, transactions: "0" }]);

    await getHotelGroupDetail(["hg-1", "hg-2"], filters, userCtx);

    // First call = summary query.
    const summarySql = chunksToSql(mockExecute.mock.calls[0]![0]);
    // Membership filter must now be an EXISTS predicate, not a JOIN onto
    // the membership table followed by an IN filter.
    expect(summarySql).toMatch(/EXISTS\s*\(\s*SELECT\s+1\s+FROM/i);
    // The rewritten FROM is just sales_records + locations — no join onto
    // location_hotel_group_memberships in the FROM clause.
    expect(summarySql).not.toMatch(/INNER JOIN\s+"location_hotel_group_memberships"/i);
  });

  it("does not multi-count a location membered to multiple selected groups (single GROUP BY row per location in hotel breakdown)", async () => {
    // Mock a single per-location row from the hotel breakdown query — the
    // rewrite GROUP BY's by location_id with EXISTS in WHERE, so a location
    // membered to both selected groups appears once with its full revenue,
    // not twice with revenue split or duplicated.
    mockExecute
      .mockResolvedValueOnce([{ revenue_native: "100", revenue_gbp: "100", currency_key: "GBP", transactions: "1", hotel_count: "1" }])
      .mockResolvedValueOnce([
        {
          location_id: "loc-jv",
          outlet_code: "JV1",
          hotel_name: "JV Hotel",
          revenue_native: "100",
          revenue_gbp: "100",
          currency_key: "GBP",
          transactions: "1",
          rooms: "50",
          kiosks: "2",
          star_rating: "4",
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ revenue_native: "0", revenue_gbp: "0", currency_key: null, transactions: "0" }]);

    const result = await getHotelGroupDetail(["hg-hilton", "hg-marriott"], filters, userCtx);

    // Behavioural check: the response surfaces the JV hotel exactly once
    // even though it belongs to both selected groups, and the summary
    // hotel_count is 1 (not 2). The SQL engine guarantees this via the
    // EXISTS+GROUP BY rewrite; the structural assertion below catches a
    // regression to the JOIN+IN pattern that would re-introduce the
    // membership table in the FROM clause.
    expect(result.hotels).toHaveLength(1);
    expect(result.hotels[0]!.locationId).toBe("loc-jv");
    expect(result.hotels[0]!.revenue).toBe(100);
    // Task 4.8 / PR-24 — kiosks is now sourced from a real
    // active-kiosk subquery; quantity is dropped from HotelInGroup.
    expect(result.hotels[0]!.kiosks).toBe(2);
    expect(result.hotels[0]).not.toHaveProperty("quantity");
    expect(result.metrics.hotelCount).toBe(1);

    // Structural guard on the hotel-breakdown query (call #2): it must
    // GROUP BY and use EXISTS, not an INNER JOIN onto memberships.
    const breakdownSql = chunksToSql(mockExecute.mock.calls[1]![0]);
    expect(breakdownSql).toMatch(/EXISTS\s*\(\s*SELECT\s+1\s+FROM/i);
    expect(breakdownSql).not.toMatch(/INNER JOIN\s+"location_hotel_group_memberships"/i);
    expect(breakdownSql).toMatch(/GROUP BY/i);
  });
});
