/**
 * D6 / Task 2.12 — Hourly Distribution must bucket sales by the LOCAL hour
 * at each property, controlled by the `analytics_display_timezone` admin
 * setting.
 *
 * The test captures the SQL fragment that getHourlyDistribution emits, then
 * asserts that:
 *   - 'local' mode resolves the target zone to per-row locations.iana_timezone
 *     and the SQL JOINs locations
 *   - 'utc' mode pins the target zone to the UTC literal (and the SQL still
 *     compiles — same FROM shape, just a different zone constant)
 *
 * Same fake-db / capture pattern as sales-txn-count-sweep.test.ts: we let
 * Drizzle render the SQL via toSQL() and pattern-match on the rendered text.
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

vi.mock("@/db", () => ({
  db: drizzle("postgres://noop"),
}));

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi.fn().mockResolvedValue([]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi.fn().mockResolvedValue(undefined),
}));

// Toggle this from each test via the typed setter below.
let displayTzMode: "local" | "utc" = "local";
vi.mock("@/lib/analytics/display-timezone-server", () => ({
  getAnalyticsDisplayTimezone: vi.fn(async () => displayTzMode),
  DISPLAY_TIMEZONE_TAG: "analytics:display-timezone",
}));

const filters = {
  dateFrom: "2025-01-01",
  dateTo: "2025-06-30",
} as const;

const userCtx = {
  id: "test-user",
  userType: "internal" as const,
  role: "admin" as const,
  ability: createMongoAbility([]) as AppAbility,
};

beforeEach(() => {
  captured.length = 0;
});

describe("getHourlyDistribution — D6 timezone bucketing", () => {
  it("default ('local') emits per-row iana_timezone and JOINs locations", async () => {
    displayTzMode = "local";
    const { getHourlyDistribution } = await import("../portfolio");
    await getHourlyDistribution(filters, userCtx);

    const sql = captured.join("\n--BREAK--\n");
    // (date + time) reconstruction landing in UTC timestamptz.
    expect(sql.toLowerCase()).toContain("at time zone 'utc'");
    // Per-row zone comes from locations.iana_timezone, requiring the JOIN.
    expect(sql).toContain('"locations"."iana_timezone"');
    expect(sql.toLowerCase()).toMatch(/inner join "locations"/);
    // Hour extraction wraps the AT-TIME-ZONE expression, not raw transaction_time.
    expect(sql.toLowerCase()).toContain("extract(hour from");
  });

  it("'utc' mode pins the target zone to the UTC literal", async () => {
    displayTzMode = "utc";
    const { getHourlyDistribution } = await import("../portfolio");
    await getHourlyDistribution(filters, userCtx);

    const sql = captured.join("\n--BREAK--\n");
    // Both AT TIME ZONE steps now use the literal 'UTC'.
    const utcCount = (sql.toLowerCase().match(/at time zone 'utc'/g) ?? []).length;
    expect(utcCount).toBeGreaterThanOrEqual(2);
    // No per-row zone reference in this mode.
    expect(sql).not.toContain('"locations"."iana_timezone"');
  });
});
