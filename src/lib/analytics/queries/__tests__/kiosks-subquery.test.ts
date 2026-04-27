/**
 * Structural regression guard for Task 4.8 / PR-24.
 *
 * The Hotels-in-Group / Hotels-in-Location-Group breakdown rows used to
 * project `NULL::text AS kiosks` (so the typed `kiosks` field was always
 * null) and a redundant `COUNT(*) FILTER (WHERE …) AS quantity` column
 * that mirrored `transactions` (the underlying `sales_records.quantity`
 * column was dropped in migration 0022). The fix swaps the NULL projection
 * for `activeKioskCountFragment()` and removes the duplicate quantity
 * projection from `getHotelGroupDetail` and `getLocationGroupDetail`.
 *
 * This suite captures the rendered SQL of both detail queries via the
 * mocking pattern in `sales-txn-count-sweep.test.ts` and asserts:
 *  - The literal `NULL::text AS kiosks` projection is gone.
 *  - The active-kiosk subquery body (kiosk_assignments / unassigned_at)
 *    is present.
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
  return { db: realFakeDb };
});

vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics/active-locations", () => ({
  getActiveLocationIds: vi
    .fn()
    .mockResolvedValue(["00000000-0000-0000-0000-000000000001"]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/analytics/queries/shared", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/analytics/queries/shared")>();
  return {
    ...actual,
    // hotel-groups.ts uses the legacy outlet-exclusion helper; short-circuit
    // to keep the test off the DB. Other helpers stay real so the kiosks
    // subquery body actually renders into the captured SQL.
    buildExclusionCondition: vi.fn().mockResolvedValue(undefined),
  };
});

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

// Anti-pattern: pre-fix shape projected the literal NULL into the kiosks
// column. The post-fix SQL must not contain this anywhere.
const NULL_KIOSKS_PROJECTION = /NULL::text\s+AS\s+kiosks/i;
// Subquery body markers — Drizzle renders the column refs as
// "kiosk_assignments"."unassigned_at" / "kiosk_assignments"."location_id".
const KIOSK_ASSIGNMENTS_TABLE = /"kiosk_assignments"/i;
const UNASSIGNED_AT_PREDICATE =
  /"kiosk_assignments"\."unassigned_at"\s+IS\s+NULL/i;

describe("Task 4.8 / PR-24 — kiosks column wired to active-kiosk subquery", () => {
  it("hotel-groups.getHotelGroupDetail — emits kiosk_assignments subquery, drops NULL kiosks projection", async () => {
    const { getHotelGroupDetail } = await import("../hotel-groups");
    await getHotelGroupDetail(
      ["00000000-0000-0000-0000-00000000aaaa"],
      filters,
      userCtx,
    );
    const sql = captured.join("\n--BREAK--\n");

    expect(sql).not.toMatch(NULL_KIOSKS_PROJECTION);
    expect(sql).toMatch(KIOSK_ASSIGNMENTS_TABLE);
    expect(sql).toMatch(UNASSIGNED_AT_PREDICATE);
  });

  it("location-groups.getLocationGroupDetail — emits kiosk_assignments subquery, drops NULL kiosks projection", async () => {
    const { getLocationGroupDetail } = await import("../location-groups");
    await getLocationGroupDetail(
      ["00000000-0000-0000-0000-00000000bbbb"],
      filters,
      userCtx,
    );
    const sql = captured.join("\n--BREAK--\n");

    expect(sql).not.toMatch(NULL_KIOSKS_PROJECTION);
    expect(sql).toMatch(KIOSK_ASSIGNMENTS_TABLE);
    expect(sql).toMatch(UNASSIGNED_AT_PREDICATE);
  });
});
