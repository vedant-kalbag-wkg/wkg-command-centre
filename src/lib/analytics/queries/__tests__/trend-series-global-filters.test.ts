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

vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi.fn().mockResolvedValue([]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi.fn().mockResolvedValue(undefined),
}));

const userCtx = {
  id: "test-user",
  userType: "internal" as const,
  role: "admin" as const,
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
