/**
 * Structural regression guard for Tasks 2.1 + 2.2 (PR-7).
 *
 * Asserts that `getLocationGroupsList`, `getLocationGroupDetail` and the
 * location-group breakdown inside `getRegionDetail` all emit a scalar
 * subquery for `total_rooms` (via `locationGroupRoomsSubquery`) — never the
 * historical `SUM(DISTINCT locations.num_rooms)` or bare-JOIN
 * `SUM(locations.num_rooms)` shapes that fan rooms across each location's
 * sales rows.
 *
 * Behavioural correctness is exercised in
 * `tests/analytics/num-rooms-aggregation.integration.test.ts`; this unit
 * suite stays in the fast `unit` project so a regression to the buggy SQL
 * shape fails CI without spinning up Testcontainers.
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
    // Return a single zero-filled stub row — sufficient for caller-side
    // `rows[0]!` dereferences (e.g. summary aggregate readouts).
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
  // Non-empty active id list so the subquery emits its full body (the helper
  // short-circuits to literal `0` on an empty list).
  getActiveLocationIds: vi
    .fn()
    .mockResolvedValue(["00000000-0000-0000-0000-000000000001"]),
  buildActiveLocationCondition: vi.fn().mockResolvedValue(undefined),
  buildActiveLocationConditionForRawContext: vi.fn().mockResolvedValue(undefined),
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

// Markers that prove the subquery body made it into the rendered SQL. The
// helper aliases the inner `locations` as `l` and the membership table as
// `lgm`; aliases come through unquoted in the rendered Drizzle SQL.
const SUBQUERY_BODY = /SELECT\s+SUM\(l\.num_rooms\)/i;
const ARCHIVED_FILTER = /l\.archived_at\s+IS\s+NULL/i;
const MEMBERSHIP_JOIN = /INNER JOIN "location_group_memberships" lgm/i;

// Anti-patterns: the historical buggy shapes must not reappear.
const SUM_DISTINCT_NUM_ROOMS = /SUM\(\s*DISTINCT\s+"locations"\."num_rooms"\s*\)/i;

describe("Tasks 2.1 + 2.2 — total_rooms scalar subquery", () => {
  it("location-groups.getLocationGroupsList — emits scalar subquery, drops SUM(DISTINCT)", async () => {
    const { getLocationGroupsList } = await import("../location-groups");
    await getLocationGroupsList(filters, userCtx);
    const sql = captured.join("\n--BREAK--\n");

    expect(sql).toMatch(SUBQUERY_BODY);
    expect(sql).toMatch(ARCHIVED_FILTER);
    expect(sql).toMatch(MEMBERSHIP_JOIN);
    expect(sql).not.toMatch(SUM_DISTINCT_NUM_ROOMS);
  });

  it("location-groups.getLocationGroupDetail — emits scalar subquery scoped to selected groups", async () => {
    const { getLocationGroupDetail } = await import("../location-groups");
    // Detail issues: summary, hotel breakdown, prev-period summary. Stub
    // executeRows always returns the proxy row — fine for SQL capture.
    await getLocationGroupDetail(
      ["00000000-0000-0000-0000-000000000aaa"],
      filters,
      userCtx,
    );
    const sql = captured.join("\n--BREAK--\n");

    expect(sql).toMatch(SUBQUERY_BODY);
    expect(sql).toMatch(ARCHIVED_FILTER);
    // Detail-view scope constrains to the supplied groupIds.
    // drizzle-orm inArray() emits `"table"."column" in ($1, $2, ...)` (lowercase,
    // quoted identifier) — accept both the quoted-identifier and unquoted shapes,
    // plus drizzle's ANY($N::text[]) shape for forward-compat.
    expect(sql).toMatch(/location_group_id"?\s*(in|IN|=\s*ANY)\s*\(/i);
    expect(sql).not.toMatch(SUM_DISTINCT_NUM_ROOMS);
  });

  it("regions.getRegionDetail — location-group breakdown emits scalar subquery (no fan-out)", async () => {
    const { getRegionDetail } = await import("../regions");
    await getRegionDetail(
      ["00000000-0000-0000-0000-000000000bbb"],
      filters,
      userCtx,
    );
    const sql = captured.join("\n--BREAK--\n");

    expect(sql).toMatch(SUBQUERY_BODY);
    expect(sql).toMatch(ARCHIVED_FILTER);
    // Region path additionally constrains to locations within the region.
    expect(sql).toMatch(/l\.id\s+IN/i);
    // The bare-JOIN bug shape (SUM("locations"."num_rooms") without DISTINCT)
    // — the regions.ts pre-fix incantation — must be gone too.
    expect(sql).not.toMatch(/SUM\(\s*"locations"\."num_rooms"\s*\)/i);
  });
});
