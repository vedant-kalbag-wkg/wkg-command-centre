/**
 * Per-dashboard contract test for D1 COUNT(*) sweep (PR-4).
 *
 * Each query module that emits a "Transactions" KPI must scope the count to
 * non-fee, non-reversal rows via FILTER (WHERE …) so the value matches the
 * mode-invariant Transactions definition in queries/shared.ts.
 *
 * We capture the raw `sql` template object passed to executeRows (or the
 * Drizzle query builder's .where()) and serialise it to text via Drizzle's
 * toSQL pipeline, then assert the predicate text is present. This keeps the
 * test surface small — one assertion per dashboard — and the helper-level
 * coverage stays in shared.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";

const captured: string[] = [];

const fakeDb = drizzle("postgres://noop");

function renderFragment(frag: unknown): string {
  if (!frag) return "";
  try {
    // Drizzle SQL templates have a toSQL() method — we wrap the fragment in a
    // dummy SELECT so any embedded refs resolve.
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
    // Return one zero-filled stub row — enough for caller-side `rows[0]!`
    // dereferences in queries like getPortfolioSummary that assume non-empty.
    return [
      new Proxy(
        {},
        {
          get: (_target, prop) =>
            prop === Symbol.toPrimitive ? () => 0 : "0",
        },
      ),
    ];
  }),
}));

vi.mock("@/db", () => {
  const realFakeDb = drizzle("postgres://noop");
  return {
    db: realFakeDb,
  };
});

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

// PR #40 review (Nit #7): the legacy `buildExclusionCondition` mock was a
// no-op holdover; hotel-groups.ts now imports `buildActiveLocationCondition`
// directly from @/lib/analytics/active-locations. The active-locations mock
// below covers the predicate; no shared.ts override needed.

vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi.fn().mockResolvedValue([]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi.fn().mockResolvedValue(undefined),
}));

// Phase 6 plan 06-05 — `getOutletTiers` now consumes
// `getOutletTierThresholdsCached`. Stub with defaults so this DB-free SQL
// rendering sweep doesn't reach for `db.select(appSettings)`.
vi.mock("@/lib/analytics/thresholds-server", () => ({
  getOutletTierThresholdsCached: vi
    .fn()
    .mockResolvedValue({ top: 80, mid: 50, bottom: 20 }),
}));

const filters = {
  dateFrom: "2025-01-01",
  dateTo: "2025-06-30",
} as const;

const userCtx = {
  id: "test-user",
  userType: "internal" as const,
  role: "admin" as const,
};

beforeEach(() => {
  captured.length = 0;
});

const SALES_TXN_FILTER_FRAGMENT = "is_weknow_fee";

describe("D1 COUNT(*) sweep — every Transactions KPI scopes to non-fee, non-reversal", () => {
  it("portfolio.getPortfolioSummary — total_transactions FILTERS on sales-txn", async () => {
    const { getPortfolioSummary } = await import("../portfolio");
    await getPortfolioSummary(filters, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toContain("total_transactions");
    expect(sql).toContain(SALES_TXN_FILTER_FRAGMENT);
    expect(sql).toMatch(/count\(\*\)\s+filter\s+\(where/i);
  });

  it("portfolio.getDailyTrends — transactions FILTERS on sales-txn", async () => {
    const { getDailyTrends } = await import("../portfolio");
    await getDailyTrends(filters, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toContain(SALES_TXN_FILTER_FRAGMENT);
    expect(sql).toMatch(/count\(\*\)\s+filter\s+\(where/i);
  });

  it("portfolio.getOutletTiers — transactions FILTERS on sales-txn", async () => {
    const { getOutletTiers } = await import("../portfolio");
    await getOutletTiers(filters, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toContain(SALES_TXN_FILTER_FRAGMENT);
  });

  it("heat-map.getHeatMapData — transactions FILTERS on sales-txn", async () => {
    const { getHeatMapData } = await import("../heat-map");
    await getHeatMapData(filters, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toContain(SALES_TXN_FILTER_FRAGMENT);
  });

  it("hotel-groups.getHotelGroupsList — loc_agg transactions FILTERS on sales-txn", async () => {
    const { getHotelGroupsList } = await import("../hotel-groups");
    await getHotelGroupsList(filters, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toContain(SALES_TXN_FILTER_FRAGMENT);
  });

  it("regions.getRegionsList — transactions FILTERS on sales-txn", async () => {
    const { getRegionsList } = await import("../regions");
    await getRegionsList(filters, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toContain(SALES_TXN_FILTER_FRAGMENT);
  });

  it("location-groups.getLocationGroupsList — transactions FILTERS on sales-txn", async () => {
    const { getLocationGroupsList } = await import("../location-groups");
    await getLocationGroupsList(filters, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toContain(SALES_TXN_FILTER_FRAGMENT);
  });

  it("comparison.getEntityMetrics(location) — transactions FILTERS on sales-txn", async () => {
    const { getEntityMetrics } = await import("../comparison");
    await getEntityMetrics("location", ["00000000-0000-0000-0000-000000000001"], filters, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toContain(SALES_TXN_FILTER_FRAGMENT);
  });

  it("maturity-analysis.getRevenueByMaturityBucket — SUM filtered by amount-mode", async () => {
    const { getRevenueByMaturityBucket } = await import("../maturity-analysis");
    await getRevenueByMaturityBucket(filters, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    // Maturity-analysis doesn't surface a transactions tile, but its SUM
    // must filter by amount-mode (non-fee in sales mode) so revenue doesn't
    // include fee rows.
    expect(sql).toContain(SALES_TXN_FILTER_FRAGMENT);
  });

  it("trend-series.transactions metric — emits sales-txn filter", async () => {
    const { getTrendSeriesData } = await import("../trend-series");
    await getTrendSeriesData("transactions", {}, filters, "2025-01-01", "2025-06-30", userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toContain(SALES_TXN_FILTER_FRAGMENT);
    expect(sql).toContain("is_reversal");
  });
});

describe("Task 4.6 / PR-25 — D9 internal-account default-exclude", () => {
  // The buildDimensionFilters funnel emits a `NOT IN (SELECT … WHERE
  // location_type = 'internal')` predicate by default. Setting
  // includeInternalAccounts=true on the filters opts back in for admin audit.
  // We assert against getPortfolioSummary because every dashboard funnels
  // through buildDimensionFilters; one happy-path + one opt-in case is enough
  // to pin the contract.
  const internalExclusionRegex = /not in[\s\S]*?location_type[\s\S]*?=\s*'internal'/i;

  it("default filters → portfolio query excludes internal-type locations", async () => {
    const { getPortfolioSummary } = await import("../portfolio");
    await getPortfolioSummary(filters, userCtx);
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).toMatch(internalExclusionRegex);
  });

  it("includeInternalAccounts=true → portfolio query drops the exclusion", async () => {
    const { getPortfolioSummary } = await import("../portfolio");
    await getPortfolioSummary(
      { ...filters, includeInternalAccounts: true },
      userCtx,
    );
    const sql = captured.join("\n--BREAK--\n");
    expect(sql).not.toMatch(internalExclusionRegex);
  });
});

describe("Task 4.1 / PR-23 — getCategoryPerformance groups by category, excludes fees", () => {
  it("groups by COALESCE(products.category_name, …) and filters fees in WHERE", async () => {
    const { getCategoryPerformance } = await import("../portfolio");
    await getCategoryPerformance(filters, userCtx);
    const sqlText = captured.join("\n--BREAK--\n").toLowerCase();

    // (1) GROUP BY uses category_name with a COALESCE wrapper for NULL bucket.
    expect(sqlText).toMatch(/group by\s+coalesce\(.*category_name/);
    // (2) Non-fee predicate landed in the outer WHERE (buildNonFeeCondition)
    //     in addition to the existing salesTxn FILTERs. We count matches of
    //     `is_weknow_fee … = false` (the `…` bridges Drizzle's quoted column
    //     boundary, e.g. `"is_weknow_fee" = false`) and require ≥3 because:
    //       - pre-fix: 2 matches (one per `COUNT(*) FILTER (WHERE ${salesTxn})`,
    //         emitted twice for the transactions + quantity tiles)
    //       - post-fix: 3 matches (the two FILTERs PLUS the new outer WHERE
    //         from `buildNonFeeCondition()`)
    //     A bare `toContain("is_weknow_fee")` / `toContain("false")` pair
    //     would pass against pre-fix code and fail to pin Bug #2.
    const nonFeeMatches = sqlText.match(/is_weknow_fee[^a-z0-9_]*=\s*false/g) ?? [];
    expect(nonFeeMatches.length).toBeGreaterThanOrEqual(3);
    // (3) NULL category coalesced into an explicit bucket — proves the
    //     "— Uncategorised" wrapping is wired in (case-insensitive match).
    expect(sqlText).toContain("coalesce");
  });
});

describe("Task 4.14 / PR-28 — Compare hotel-group dedup invariant", () => {
  // PR-6 Part E reshaped Compare's hotel-group metric query to gate sales rows
  // via EXISTS (location_hotel_group_memberships) rather than INNER JOIN'ing
  // the membership table. INNER JOIN would fan a multi-group location's
  // sales out across each membership, double-counting revenue inside a single
  // hotel-group's Compare card. EXISTS qualifies each sales row against the
  // current hotel_group at most once, keeping per-card totals correct even
  // when the same location belongs to several selected groups (e.g. a JV).
  // Pin the structural invariant so a future "while I'm here" rewrite can't
  // silently regress to the INNER JOIN shape.
  it("getEntityMetrics(hotel_group) gates sales rows via EXISTS, not INNER JOIN through memberships", async () => {
    const { getEntityMetrics } = await import("../comparison");
    await getEntityMetrics(
      "hotel_group",
      ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"],
      filters,
      userCtx,
    );
    const sqlText = captured.join("\n--BREAK--\n").toLowerCase();
    // (1) The membership gate is an EXISTS subquery scoped to the current
    //     hotel_group, NOT a top-level INNER JOIN that would fan out.
    expect(sqlText).toMatch(/exists\s*\([\s\S]*?location_hotel_group_memberships[\s\S]*?hotel_group_id/);
    // (2) The membership table does NOT appear in any top-level join — i.e.
    //     it occurs only inside the EXISTS body. We assert this by checking
    //     no `(inner|left)\s+join\s+"location_hotel_group_memberships"` arm.
    expect(sqlText).not.toMatch(/\b(inner|left)\s+join\s+"?location_hotel_group_memberships/);
  });
});
