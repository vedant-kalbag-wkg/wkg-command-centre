/**
 * PR-15 / Task 3.4 — buildCommissionWhere must invoke scopedSalesCondition
 * so external-region users only see their scoped commission numbers.
 *
 * Strategy: mock scopedSalesCondition to return a marker SQL fragment, call
 * buildCommissionWhere directly with a fixture userCtx, and assert that
 *   (a) the helper was invoked with the userCtx, and
 *   (b) the marker text appears in the rendered WHERE clause.
 *
 * Renders the resulting SQL via the same toSQL() trick used in
 * src/lib/analytics/queries/__tests__/sales-txn-count-sweep.test.ts.
 */
import { describe, it, expect, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";

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

const SCOPE_MARKER = "__SCOPE_MARKER_PR15__";

const scopedSalesConditionMock = vi.fn(async () =>
  drizzleSql.raw(SCOPE_MARKER) as unknown,
);

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: scopedSalesConditionMock,
}));

vi.mock("@/db", () => ({
  db: drizzle("postgres://noop"),
}));

// PR #40 review (Nit #7): where-builder.ts now imports
// buildActiveLocationCondition directly from @/lib/analytics/active-locations
// (the legacy buildExclusionCondition alias was removed). Mock the
// active-locations module to short-circuit the DB lookup; not under test here.
vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi.fn().mockResolvedValue([]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi.fn().mockResolvedValue(undefined),
}));

const filters = {
  dateFrom: "2025-01-01",
  dateTo: "2025-06-30",
} as const;

const userCtx = {
  id: "test-user",
  userType: "external" as const,
  role: "viewer" as const,
};

describe("commission/actions — buildCommissionWhere applies scopedSalesCondition", () => {
  it("invokes scopedSalesCondition with the userCtx and includes its SQL in the WHERE", async () => {
    const { buildCommissionWhere } = await import("../where-builder");

    const where = await buildCommissionWhere(filters, userCtx);

    expect(scopedSalesConditionMock).toHaveBeenCalled();
    const callArgs = scopedSalesConditionMock.mock.calls[0] as unknown[];
    expect(callArgs[1]).toBe(userCtx);

    const rendered = renderFragment(where);
    expect(rendered).toContain(SCOPE_MARKER);
  });
});
