/**
 * PR-19 / Task 3.7 — fetchCohortComparison normalises the delta per-location.
 *
 * Raw `cohort_revenue - control_revenue` is dominated by group-size disparity
 * (5-hotel cohort vs 200-hotel "rest of portfolio" control). The fix divides
 * each side by its respective location count.
 *
 * Strategy: mock the four downstream surfaces — `getCohortMetrics` /
 * `getRestOfPortfolioMetrics` (return fixed totals), `getActiveLocationIds` +
 * `scopedLocationsCondition` (drive the scoped-active-id count), and `db`
 * (return a fixed cohort row) — then call `fetchCohortComparison` and assert
 * the delta math.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const cohortMetricsFn = vi.fn();
const restOfPortfolioMetricsFn = vi.fn();
const activeLocationIdsFn = vi.fn();
const scopedLocationsConditionFn = vi.fn();
const getUserCtxFn = vi.fn();

let cohortRow: {
  id: string;
  locationIds: string[];
  controlType: "rest_of_portfolio" | "named_control";
  controlLocationIds: string[] | null;
} | null = null;

vi.mock("@/lib/analytics/queries/experiments", () => ({
  getCohortMetrics: (...args: unknown[]) => cohortMetricsFn(...args),
  getRestOfPortfolioMetrics: (...args: unknown[]) =>
    restOfPortfolioMetricsFn(...args),
  findSimilarLocations: vi.fn(),
  getCohortTemporalComparison: vi.fn(),
}));

vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: (...args: unknown[]) => activeLocationIdsFn(...args),
}));

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedLocationsCondition: (...args: unknown[]) =>
    scopedLocationsConditionFn(...args),
}));

vi.mock("@/lib/auth/get-user-ctx", () => ({
  getUserCtx: (...args: unknown[]) => getUserCtxFn(...args),
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

// db.select(...).from(...).where(...).limit(1) → returns [cohortRow] or [].
// Generic enough to also handle the scoped-active-id helper's
// db.select(...).from(...).where(...) chain (scopeCondition is undefined in
// our tests so this branch isn't exercised, but the chain must resolve).
function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = async () => (cohortRow ? [cohortRow] : []);
  // Promise-resolving variant: when there's no .limit() (the scoped-active-id
  // helper), `await chain` is the result. Default to []. We don't reach this
  // path under either test because scopeCondition === undefined short-circuits.
  (chain as { then?: unknown }).then = (resolve: (v: unknown[]) => void) =>
    resolve([]);
  return chain;
}

vi.mock("@/db", () => ({
  db: {
    select: () => makeChain(),
  },
}));

const ctx = {
  id: "test-user",
  userType: "internal" as const,
  role: "admin" as const,
};

const filters = { dateFrom: "2025-01-01", dateTo: "2025-06-30" };

beforeEach(() => {
  cohortMetricsFn.mockReset();
  restOfPortfolioMetricsFn.mockReset();
  activeLocationIdsFn.mockReset();
  scopedLocationsConditionFn.mockReset();
  getUserCtxFn.mockReset();
  cohortRow = null;

  getUserCtxFn.mockResolvedValue(ctx);
  scopedLocationsConditionFn.mockResolvedValue(undefined); // admin → unrestricted
});

describe("fetchCohortComparison — per-location delta normalisation", () => {
  it("rest_of_portfolio: delta is per-location for revenue + transactions; raw for avgRevenue", async () => {
    const cohortIds = ["c1", "c2", "c3", "c4", "c5"]; // size 5
    cohortRow = {
      id: "cohort-1",
      locationIds: cohortIds,
      controlType: "rest_of_portfolio",
      controlLocationIds: null,
    };

    // 200 active locations total, 5 in cohort → 195 in control.
    const allActiveIds = Array.from({ length: 200 }, (_, i) => `loc-${i}`);
    // Force overlap with cohort by stuffing the cohort ids in.
    allActiveIds[0] = "c1";
    allActiveIds[1] = "c2";
    allActiveIds[2] = "c3";
    allActiveIds[3] = "c4";
    allActiveIds[4] = "c5";
    activeLocationIdsFn.mockResolvedValue(allActiveIds);

    cohortMetricsFn.mockResolvedValue({
      revenue: 50_000,
      transactions: 500,
      avgRevenue: 100,
    });
    restOfPortfolioMetricsFn.mockResolvedValue({
      revenue: 1_950_000,
      transactions: 19_500,
      avgRevenue: 100,
    });

    const { fetchCohortComparison } = await import("../actions");
    const result = await fetchCohortComparison("cohort-1", filters);

    expect(result.cohortSize).toBe(5);
    expect(result.controlSize).toBe(195); // 200 - 5 cohort overlap
    // Per-location revenue: 50_000/5 - 1_950_000/195 = 10_000 - 10_000 = 0
    expect(result.delta.revenue).toBe(0);
    // Per-location txns: 500/5 - 19_500/195 = 100 - 100 = 0
    expect(result.delta.transactions).toBe(0);
    // avgRevenue is per-transaction already → raw delta
    expect(result.delta.avgRevenue).toBe(0);
  });

  it("named_control: controlSize = controlLocationIds.length; delta uses that divisor", async () => {
    const cohortIds = ["c1", "c2"]; // size 2
    const namedControlIds = ["k1", "k2", "k3", "k4"]; // size 4
    cohortRow = {
      id: "cohort-2",
      locationIds: cohortIds,
      controlType: "named_control",
      controlLocationIds: namedControlIds,
    };

    cohortMetricsFn
      .mockResolvedValueOnce({
        revenue: 1_000,
        transactions: 100,
        avgRevenue: 10,
      }) // cohort call
      .mockResolvedValueOnce({
        revenue: 4_000,
        transactions: 400,
        avgRevenue: 10,
      }); // named-control call (uses getCohortMetrics path)

    const { fetchCohortComparison } = await import("../actions");
    const result = await fetchCohortComparison("cohort-2", filters);

    expect(result.cohortSize).toBe(2);
    expect(result.controlSize).toBe(4);
    // 1000/2 - 4000/4 = 500 - 1000 = -500
    expect(result.delta.revenue).toBe(-500);
    // 100/2 - 400/4 = 50 - 100 = -50
    expect(result.delta.transactions).toBe(-50);
    expect(result.delta.avgRevenue).toBe(0);
    // Named control bypasses rest-of-portfolio aggregation.
    expect(restOfPortfolioMetricsFn).not.toHaveBeenCalled();
  });

  it("empty cohort (size 0): no divide-by-zero — delta = 0 - per_loc_control", async () => {
    cohortRow = {
      id: "cohort-empty",
      locationIds: [],
      controlType: "rest_of_portfolio",
      controlLocationIds: null,
    };

    activeLocationIdsFn.mockResolvedValue(["a", "b", "c", "d"]); // 4 control locs

    cohortMetricsFn.mockResolvedValue({
      revenue: 0,
      transactions: 0,
      avgRevenue: 0,
    });
    restOfPortfolioMetricsFn.mockResolvedValue({
      revenue: 4_000,
      transactions: 400,
      avgRevenue: 10,
    });

    const { fetchCohortComparison } = await import("../actions");
    const result = await fetchCohortComparison("cohort-empty", filters);

    expect(result.cohortSize).toBe(0);
    expect(result.controlSize).toBe(4);
    // safeDiv(0, 0) = 0 (not NaN)
    expect(result.delta.revenue).toBe(-1_000); // 0 - 4000/4
    expect(result.delta.transactions).toBe(-100); // 0 - 400/4
    expect(result.delta.avgRevenue).toBe(-10);
  });
});
