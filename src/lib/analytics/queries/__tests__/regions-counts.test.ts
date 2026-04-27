/**
 * Task 3.8 — getRegionsList Query 2 (hotel-group + location-group counts per
 * region) must apply the same global filter as Query 1 so badge counts match
 * the detail-panel KPIs. Previously Query 2 joined membership tables with no
 * filter and returned portfolio-wide totals.
 *
 * The fix introduces a DISTINCT location_id subquery against sales_records
 * using the same whereClause. We capture the rendered SQL of every fragment
 * passed to executeRows and assert the subquery shape is present, and that
 * dimension filters (e.g. regionIds) flow through to it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";

const captured: string[] = [];

const fakeDb = drizzle("postgres://noop");

function renderFragment(frag: unknown): string {
  if (!frag) return "";
  try {
    return fakeDb
      .select({ v: drizzleSql`1` })
      .from(drizzleSql`sales_records`)
      .where(frag as never)
      .toSQL().sql;
  } catch {
    const obj = frag as { toSQL?: () => { sql: string } };
    if (obj?.toSQL) return obj.toSQL().sql;
    return String(frag);
  }
}

vi.mock("@/db/execute-rows", () => ({
  executeRows: vi.fn(async (frag: unknown) => {
    captured.push(renderFragment(frag));
    return [];
  }),
}));

vi.mock("@/db", () => ({
  db: drizzle("postgres://noop"),
}));

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi.fn().mockResolvedValue([]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi
    .fn()
    .mockResolvedValue(undefined),
}));

const userCtx = {
  id: "test-user",
  userType: "internal" as const,
  role: "admin" as const,
};

beforeEach(() => {
  captured.length = 0;
});

describe("getRegionsList — Query 2 badge counts honour the global filter (Task 3.8)", () => {
  it("default filters: Query 2 SQL emits the DISTINCT sales_records subquery", async () => {
    const { getRegionsList } = await import("../regions");
    await getRegionsList(
      { dateFrom: "2025-01-01", dateTo: "2025-06-30" },
      userCtx,
    );

    // Two queries fire in parallel; Query 2 is the one with hotel_group_count.
    const query2 = captured.find((s) => s.includes("hotel_group_count"));
    expect(query2).toBeDefined();
    expect(query2!).toMatch(/select\s+distinct/i);
    expect(query2!).toContain("sales_records");
    // The location_id correlation predicate.
    expect(query2!).toMatch(/location_region_memberships/i);
  });

  it("regionIds filter: Query 2 inner subquery references region membership", async () => {
    const { getRegionsList } = await import("../regions");
    await getRegionsList(
      {
        dateFrom: "2025-01-01",
        dateTo: "2025-06-30",
        regionIds: ["00000000-0000-0000-0000-000000000001"],
      },
      userCtx,
    );

    const query2 = captured.find((s) => s.includes("hotel_group_count"));
    expect(query2).toBeDefined();
    // The dimension filter (regionIds) is applied via a location_region_memberships
    // membership predicate inside buildDimensionFilters; it must appear inside
    // Query 2's whereClause-bearing subquery, proving the filter flowed in.
    expect(query2!).toMatch(/select\s+distinct/i);
    expect(query2!).toContain("sales_records");
    // The whereClause for a regionIds filter contains a region_id predicate.
    expect(query2!.toLowerCase()).toMatch(/region_id/);
  });
});
