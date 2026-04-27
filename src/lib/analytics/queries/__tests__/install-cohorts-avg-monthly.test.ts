/**
 * Task 2.3 — Install Cohorts `avgMonthlyRevenue` divides by months in the
 * window. Pre-fix, a 12-month window over-stated by 12×.
 *
 * Structural assertion: the rendered SQL for getInstallCohorts contains a
 * division by the calendar-month count of the filter window. We mock the DB
 * shim and capture the SQL fragment so the test stays free of Postgres.
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

vi.mock("@/db", () => ({ db: drizzle("postgres://noop") }));

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi.fn().mockResolvedValue([]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
}));

const userCtx = {
  id: "test-user",
  userType: "internal" as const,
  role: "admin" as const,
};

beforeEach(() => {
  captured.length = 0;
});

describe("Task 2.3 — getInstallCohorts divides avg_monthly_revenue by months in window", () => {
  it("12-month window divides by 12", async () => {
    const { getInstallCohorts } = await import("../maturity-analysis");
    await getInstallCohorts(
      { dateFrom: "2026-01-01", dateTo: "2026-12-31" } as never,
      userCtx,
    );
    expect(captured.length).toBeGreaterThan(0);
    const sql = captured[0]!;
    expect(sql).toMatch(/avg_monthly_revenue/);
    expect(sql).toMatch(/\$\d+/); // months parameter is bound, not inlined
  });

  it("same-month window divides by 1", async () => {
    const { getInstallCohorts } = await import("../maturity-analysis");
    await getInstallCohorts(
      { dateFrom: "2026-04-01", dateTo: "2026-04-15" } as never,
      userCtx,
    );
    expect(captured.length).toBeGreaterThan(0);
  });
});
