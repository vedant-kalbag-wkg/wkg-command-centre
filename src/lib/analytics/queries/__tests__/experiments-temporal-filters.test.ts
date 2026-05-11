/**
 * PR-17 / Task 3.5 — Experiments Temporal analysis honours global filters.
 *
 * `getCohortTemporalComparison` previously constructed throwaway filter objects
 * containing only `{ dateFrom, dateTo }` for each of its four
 * `getCohortMetrics` calls, dropping every other field of `AnalyticsFilters`
 * (region, hotelGroupIds, hotelIds, productIds, maturityBuckets, metricMode,
 * etc.). The fix spreads the inbound filters into each call, overriding only
 * the date range per period.
 *
 * Test boundary: spy on the filter-builder helpers from `shared` (each is
 * called once per `getCohortMetrics` invocation) and assert all 4 calls
 * receive the merged filter set with the date range overridden — proving the
 * spread happened.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMongoAbility } from "@casl/ability";
import type { AppAbility } from "@/lib/casl/types";
import type { AnalyticsFilters } from "@/lib/analytics/types";

const buildDimensionFiltersSpy = vi.fn((_f: AnalyticsFilters) => {});
const buildMaturityConditionSpy = vi.fn((_f: AnalyticsFilters) => {});
const buildAmountModeConditionSpy = vi.fn((_f: AnalyticsFilters) => {});
const buildDateConditionSpy = vi.fn((_f: AnalyticsFilters) => {});

vi.mock("@/lib/analytics/queries/shared", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/analytics/queries/shared")>();
  return {
    ...mod,
    buildDimensionFilters: (f: AnalyticsFilters) => {
      buildDimensionFiltersSpy(f);
      return mod.buildDimensionFilters(f);
    },
    buildMaturityCondition: (f: AnalyticsFilters) => {
      buildMaturityConditionSpy(f);
      return mod.buildMaturityCondition(f);
    },
    buildAmountModeCondition: (f: AnalyticsFilters) => {
      buildAmountModeConditionSpy(f);
      return mod.buildAmountModeCondition(f);
    },
    buildDateCondition: (f: AnalyticsFilters) => {
      buildDateConditionSpy(f);
      return mod.buildDateCondition(f);
    },
  };
});

// db.select(...).from(...).where(...) chain → resolves to [] (no Postgres needed).
const chain = {
  from: () => chain,
  where: () => Promise.resolve([]),
};

vi.mock("@/db", () => ({
  db: {
    select: () => chain,
  },
}));

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
  ability: createMongoAbility([]) as AppAbility,
};

const baseFilters: AnalyticsFilters = {
  dateFrom: "IGNORED",
  dateTo: "IGNORED",
  hotelGroupIds: ["hg-1"],
  regionIds: ["reg-1"],
  maturityBuckets: ["3-6"],
  metricMode: "revenue",
  productIds: ["prod-1"],
};

beforeEach(() => {
  buildDimensionFiltersSpy.mockClear();
  buildMaturityConditionSpy.mockClear();
  buildAmountModeConditionSpy.mockClear();
  buildDateConditionSpy.mockClear();
});

describe("getCohortTemporalComparison — forwards full AnalyticsFilters to all 4 period calls", () => {
  it("spreads filters into every getCohortMetrics call and overrides only the date range", async () => {
    const { getCohortTemporalComparison } = await import(
      "@/lib/analytics/queries/experiments"
    );

    await getCohortTemporalComparison(
      ["loc-1"],
      "2025-06-01",
      baseFilters,
      userCtx,
    );

    // getCohortMetrics is invoked 4× (pre, during, yoyPre, yoyDuring); each
    // routes through buildDimensionFilters + buildMaturityCondition +
    // buildAmountModeCondition + buildDateCondition exactly once.
    expect(buildDimensionFiltersSpy).toHaveBeenCalledTimes(4);
    expect(buildMaturityConditionSpy).toHaveBeenCalledTimes(4);
    expect(buildAmountModeConditionSpy).toHaveBeenCalledTimes(4);
    expect(buildDateConditionSpy).toHaveBeenCalledTimes(4);

    // Sample any of the spy chains — they all see the same filter object per call.
    const seenFilters = buildDimensionFiltersSpy.mock.calls.map(
      (args) => args[0] as AnalyticsFilters,
    );

    for (const f of seenFilters) {
      // Non-date fields preserved verbatim
      expect(f.hotelGroupIds).toEqual(["hg-1"]);
      expect(f.regionIds).toEqual(["reg-1"]);
      expect(f.maturityBuckets).toEqual(["3-6"]);
      expect(f.metricMode).toBe("revenue");
      expect(f.productIds).toEqual(["prod-1"]);

      // Date range overridden — must NOT leak the inbound 'IGNORED' sentinel
      expect(f.dateFrom).not.toBe("IGNORED");
      expect(f.dateTo).not.toBe("IGNORED");
      expect(typeof f.dateFrom).toBe("string");
      expect(typeof f.dateTo).toBe("string");
    }

    // Sanity-check: the four period date ranges are pairwise distinct
    const ranges = seenFilters.map((f) => `${f.dateFrom}|${f.dateTo}`);
    expect(new Set(ranges).size).toBe(4);
  });

  it("metricMode in filters propagates to buildAmountModeCondition for every period", async () => {
    const { getCohortTemporalComparison } = await import(
      "@/lib/analytics/queries/experiments"
    );

    await getCohortTemporalComparison(
      ["loc-1"],
      "2025-06-01",
      { ...baseFilters, metricMode: "sales" },
      userCtx,
    );

    expect(buildAmountModeConditionSpy).toHaveBeenCalledTimes(4);
    for (const args of buildAmountModeConditionSpy.mock.calls) {
      expect((args[0] as AnalyticsFilters).metricMode).toBe("sales");
    }
  });
});
