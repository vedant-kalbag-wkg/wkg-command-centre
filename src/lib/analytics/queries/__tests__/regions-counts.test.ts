/**
 * getRegionsList Query 2 (hotel-group + location-group counts per region) is
 * structurally unified with getRegionDetail's hotelGroupBreakdown so the
 * selector card and the detail panel cannot diverge on counts (Task 4.19 /
 * PR-27).
 *
 * History:
 * - Task 3.8 / PR-20 wired the global filter into Query 2 via an inner
 *   `SELECT DISTINCT location_id FROM sales_records WHERE whereClause`
 *   subquery so the badge counts matched the detail in typical cases.
 * - Task 4.19 / PR-27 collapses both queries to the same `FROM sales_records
 *   INNER JOIN location_region_memberships LEFT JOIN
 *   location_{hotel_group,group}_memberships` shape so future filter changes
 *   cannot reintroduce drift.
 *
 * These tests render the SQL fragment passed to `executeRows` and assert the
 * structural shape — same join shape, same membership tables, same
 * whereClause-driven filter as the detail-panel breakdown.
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
    const rendered = renderFragment(frag);
    captured.push(rendered);
    // Detail's summary aggregate expects a single row; return a stub so the
    // surrounding code path (getRegionDetail) doesn't throw on `revenue`
    // access. Test assertions only inspect captured SQL strings.
    if (/COALESCE\(SUM\(/i.test(rendered)) {
      return [{ revenue: "0", transactions: "0" }];
    }
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
  it("default filters: Query 2 SQL drives off sales_records and joins region + hotel-group memberships", async () => {
    const { getRegionsList } = await import("../regions");
    await getRegionsList(
      { dateFrom: "2025-01-01", dateTo: "2025-06-30" },
      userCtx,
    );

    // Two queries fire in parallel; Query 2 is the one with hotel_group_count.
    const query2 = captured.find((s) => s.includes("hotel_group_count"));
    expect(query2).toBeDefined();
    // Driving table is sales_records (matches the detail-panel breakdown).
    expect(query2!).toMatch(/FROM\s+"sales_records"/i);
    // Membership joins for both region and hotel-group are present, scoped on
    // sales_records.location_id — same shape as getRegionDetail.
    expect(query2!).toMatch(
      /INNER JOIN\s+"location_region_memberships"\s+ON\s+"location_region_memberships"\."location_id"\s*=\s*"sales_records"\."location_id"/i,
    );
    expect(query2!).toMatch(
      /LEFT JOIN\s+"location_hotel_group_memberships"\s+ON\s+"location_hotel_group_memberships"\."location_id"\s*=\s*"sales_records"\."location_id"/i,
    );
    // Date predicate from buildDateCondition flows through as the whereClause.
    expect(query2!).toMatch(/"sales_records"\."transaction_date"\s*>=/i);
    // Counts dedupe via DISTINCT — multi-membership rows must not inflate.
    expect(query2!).toMatch(
      /COUNT\(DISTINCT\s+"location_hotel_group_memberships"\."hotel_group_id"\)/i,
    );
    expect(query2!).toMatch(
      /COUNT\(DISTINCT\s+"location_group_memberships"\."location_group_id"\)/i,
    );
  });

  it("regionIds filter: Query 2 propagates the dimension filter into the whereClause", async () => {
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
    // Dimension filter (regionIds) lands in the whereClause as a
    // location_region_memberships subquery on sales_records.location_id.
    expect(query2!).toMatch(
      /"sales_records"\."location_id"\s+IN\s*\(\s*SELECT\s+"location_region_memberships"\."location_id"/i,
    );
    expect(query2!.toLowerCase()).toContain("region_id");
  });
});

describe("getRegionsList — Query 2 is structurally unified with getRegionDetail (Task 4.19)", () => {
  it("selector Query 2 and detail hotelGroupBreakdown both gate hotel-groups via location_hotel_group_memberships against sales_records", async () => {
    const regionsModule = await import("../regions");

    // Capture selector Query 2.
    captured.length = 0;
    await regionsModule.getRegionsList(
      { dateFrom: "2025-01-01", dateTo: "2025-06-30" },
      userCtx,
    );
    const selectorQ2 = captured.find((s) => s.includes("hotel_group_count"));
    expect(selectorQ2).toBeDefined();

    // Capture detail's hotelGroupBreakdown.
    captured.length = 0;
    await regionsModule.getRegionDetail(
      ["00000000-0000-0000-0000-000000000001"],
      { dateFrom: "2025-01-01", dateTo: "2025-06-30" },
      userCtx,
    );
    const detailHgQuery = captured.find(
      (s) => s.includes('"hotel_groups"') && s.includes("group_name"),
    );
    expect(detailHgQuery).toBeDefined();

    // Acceptance gate: both queries reference the same membership scoping
    // table to gate hotel-group inclusion.
    expect(selectorQ2!).toContain('"location_hotel_group_memberships"');
    expect(detailHgQuery!).toContain('"location_hotel_group_memberships"');

    // And both correlate that membership against sales_records.location_id —
    // not against an unfiltered membership scan.
    expect(selectorQ2!).toMatch(
      /"location_hotel_group_memberships"\."location_id"\s*=\s*"sales_records"\."location_id"/i,
    );
    expect(detailHgQuery!).toMatch(
      /"location_hotel_group_memberships"\."location_id"\s*=\s*"sales_records"\."location_id"/i,
    );

    // Both apply the global whereClause's date predicate to sales_records.
    expect(selectorQ2!).toMatch(/"sales_records"\."transaction_date"\s*>=/i);
    expect(detailHgQuery!).toMatch(/"sales_records"\."transaction_date"\s*>=/i);
  });
});
