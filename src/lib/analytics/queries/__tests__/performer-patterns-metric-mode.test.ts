/**
 * PR-16 / Task 3.10 — Performer Pattern tier ranking honours metricMode.
 *
 * `getLocationRevenuesForRequest` drives the high/low-performer tier ranking
 * in `computePerformerPatterns`. Pre-fix it hardcoded `buildNonFeeCondition()`
 * on its per-location SUM, so toggling Sales↔Revenue at the global filter bar
 * left the displayed numbers unchanged. The fix swaps in
 * `buildAmountModeCondition(filters)` so the FILTER (WHERE …) arm flips with
 * `filters.metricMode`.
 *
 * We render the SQL passed to `executeRows` and assert the predicate text:
 *   - sales mode (default / explicit) → `is_weknow_fee = false`
 *   - revenue mode → `is_weknow_fee = true`
 * Both calls must keep the SUM(...) FILTER (WHERE …) shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMongoAbility } from "@casl/ability";
import type { AppAbility } from "@/lib/casl/types";
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

vi.mock("@/db", () => {
  const realFakeDb = drizzle("postgres://noop");
  return {
    db: realFakeDb,
  };
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
  ability: createMongoAbility([]) as AppAbility,
};

const baseFilters = {
  dateFrom: "2025-01-01",
  dateTo: "2025-06-30",
} as const;

const SUM_FILTER_SHAPE = /sum\([^)]*\)\s+filter\s+\(where/i;
const IS_FEE_FALSE = /"is_weknow_fee"\s*=\s*false/i;
const IS_FEE_TRUE = /"is_weknow_fee"\s*=\s*true/i;

beforeEach(() => {
  captured.length = 0;
});

describe("getLocationRevenuesForRequest — metricMode flips per-location SUM filter", () => {
  it("sales mode (metricMode undefined) emits SUM FILTER (WHERE is_weknow_fee = false)", async () => {
    const { getLocationRevenuesForRequest } = await import("../location-revenues");
    await getLocationRevenuesForRequest(baseFilters, userCtx);

    expect(captured).toHaveLength(1);
    const rendered = captured[0]!;
    expect(rendered).toMatch(SUM_FILTER_SHAPE);
    expect(rendered).toMatch(IS_FEE_FALSE);
    expect(rendered).not.toMatch(IS_FEE_TRUE);
  });

  it("revenue mode emits SUM FILTER (WHERE is_weknow_fee = true)", async () => {
    const { getLocationRevenuesForRequest } = await import("../location-revenues");
    await getLocationRevenuesForRequest(
      { ...baseFilters, metricMode: "revenue" },
      userCtx,
    );

    expect(captured).toHaveLength(1);
    const rendered = captured[0]!;
    expect(rendered).toMatch(SUM_FILTER_SHAPE);
    expect(rendered).toMatch(IS_FEE_TRUE);
    expect(rendered).not.toMatch(IS_FEE_FALSE);
  });

  it("explicit sales mode behaves identically to the default", async () => {
    const { getLocationRevenuesForRequest } = await import("../location-revenues");
    await getLocationRevenuesForRequest(
      { ...baseFilters, metricMode: "sales" },
      userCtx,
    );

    expect(captured).toHaveLength(1);
    const rendered = captured[0]!;
    expect(rendered).toMatch(SUM_FILTER_SHAPE);
    expect(rendered).toMatch(IS_FEE_FALSE);
  });
});
