/**
 * Trend Builder must respect the global AnalyticsFilterBar (PR-18c, Task 3.1).
 *
 * Before this fix, getTrendSeriesData ignored every dimension on the bar
 * except dateRange + locationGroup. We assert here that the rendered SQL
 * for getTrendSeriesData includes the predicate fragments produced by
 * `buildDimensionFilters` and `buildMaturityCondition` when the global
 * filter object carries those dimensions.
 *
 * Pattern mirrors sales-txn-count-sweep.test.ts: capture the rendered SQL
 * via a mocked `executeRows` and assert text fragments. Intersection with
 * per-series filters is implicit in `combineConditions(AND ...)` and not
 * asserted here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMongoAbility } from "@casl/ability";
import type { AppAbility } from "@/lib/casl/types";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";
import type { AnalyticsFilters } from "@/lib/analytics/types";

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

vi.mock("@/db", () => {
  const realFakeDb = drizzle("postgres://noop");
  return { db: realFakeDb };
});

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/scoping/scoped-active-locations", () => ({
  // Single sentinel id keeps the rendered SQL deterministic and lets the
  // 4.17 tests assert the effective-locations CTE exists.
  getScopedActiveLocationIds: vi
    .fn()
    .mockResolvedValue(["00000000-0000-0000-0000-0000000000ff"]),
}));

vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi.fn().mockResolvedValue([]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi.fn().mockResolvedValue(undefined),
}));

const userCtx = {
  id: "test-user",
  userType: "internal" as const,
  role: "admin" as const,
  ability: createMongoAbility([]) as AppAbility,
};

const baseGlobal: AnalyticsFilters = {
  dateFrom: "2025-01-01",
  dateTo: "2025-06-30",
};

beforeEach(() => {
  captured.length = 0;
});

describe("getTrendSeriesData — global FilterBar dimensions reach the SQL (PR-18c)", () => {
  it("globalFilters.regionIds emits the location_region_memberships predicate", async () => {
    const { getTrendSeriesData } = await import("../trend-series");
    const global: AnalyticsFilters = {
      ...baseGlobal,
      regionIds: ["00000000-0000-0000-0000-0000000000aa"],
    };
    await getTrendSeriesData("revenue", {}, global, "2025-01-01", "2025-06-30", userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toContain("location_region_memberships");
  });

  it("globalFilters.maturityBuckets emits the kiosk_assignments maturity predicate", async () => {
    const { getTrendSeriesData } = await import("../trend-series");
    const global: AnalyticsFilters = {
      ...baseGlobal,
      maturityBuckets: ["3-6mo"],
    };
    await getTrendSeriesData("revenue", {}, global, "2025-01-01", "2025-06-30", userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toContain("kiosk_assignments");
    expect(sql).toMatch(/interval/i);
  });
});

describe("getBusinessEvents — hierarchical scope-type visibility (PR-29 / Task 4.17)", () => {
  it("default filters render the four-branch visibility predicate", async () => {
    const { getBusinessEvents } = await import("../trend-series");
    await getBusinessEvents("2025-01-01", "2025-06-30", baseGlobal, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    // CTE-anchored effective set
    expect(sql).toMatch(/effective_locations/i);
    // All four scope branches are present
    expect(sql).toMatch(/'global'/);
    expect(sql).toMatch(/'hotel'/);
    expect(sql).toMatch(/'region'/);
    expect(sql).toMatch(/'hotel_group'/);
    // Region/hotel-group branches go through the membership tables
    expect(sql).toContain("location_region_memberships");
    expect(sql).toContain("location_hotel_group_memberships");
    // Date-range predicate still applies
    expect(sql).toMatch(/start_date/);
    expect(sql).toMatch(/end_date/);
  });

  it("regionIds filter narrows the effective-locations subquery", async () => {
    const { getBusinessEvents } = await import("../trend-series");
    const global: AnalyticsFilters = {
      ...baseGlobal,
      regionIds: ["00000000-0000-0000-0000-0000000000aa"],
    };
    await getBusinessEvents("2025-01-01", "2025-06-30", global, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    // The effective-locations CTE now has the locations.id-anchored region
    // membership predicate as well as the universal region branch in the
    // visibility predicate, so the membership table should appear at least
    // twice (once in CTE, once in visibility OR-arm).
    const hits = sql.match(/location_region_memberships/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });

  it("internal-type locations are excluded by default from the effective set", async () => {
    const { getBusinessEvents } = await import("../trend-series");
    await getBusinessEvents("2025-01-01", "2025-06-30", baseGlobal, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    // D9 / Task 4.6 — buildEffectiveLocationsPredicate adds an
    // `location_type IS DISTINCT FROM 'internal'` guard unless
    // includeInternalAccounts. Pin the exact predicate shape so accidentally
    // inverting or removing the guard fails this test (a loose `/internal/`
    // regex would still pass against unrelated identifiers, the userCtx
    // literal, or even an inverted comparison).
    expect(sql).toMatch(/location_type"?\s+IS\s+DISTINCT\s+FROM\s+'internal'/i);
  });
});
