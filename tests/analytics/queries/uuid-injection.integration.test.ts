/**
 * Phase 9.1 Plan 09 — CR-01 / WR-04 closure: SQL injection probe.
 *
 * Asserts that the analytics detail queries (region, hotel-group,
 * location-group) reject an SQL-injection probe id at the drizzle pg-adapter
 * uuid-bind boundary. Pre-fix the queries did `sql.raw(\`(${ids.map((id) =>
 * \`'${id}'\`).join(",")})\`)` — string-concat into raw SQL — and a probe id
 * would have either errored at query parse (semicolon-split exec) or quietly
 * returned data. Post-fix the same probe is bound through `inArray()` /
 * `sql.param(ids)::uuid[]`, and the pg adapter throws on the uuid cast.
 *
 * Mirrors tests/analytics/num-rooms-aggregation.integration.test.ts for the
 * vi.hoisted + vi.mock setup; we don't need to seed any rows because the
 * probe is rejected before the WHERE clause produces a result set.
 */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createMongoAbility } from "@casl/ability";
import type { AppAbility } from "@/lib/casl/types";

import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../../helpers/test-db";

const dbHolder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/db", () => ({
  get db() {
    return dbHolder.db;
  },
}));

// Tests run as an "internal admin" user — short-circuit the scoping helper so
// we don't need to seed userScopes. The queries we test here own their own
// filter shape; the scope predicate is verified elsewhere.
vi.mock("@/lib/scoping/scoped-query", () => ({
  scopedSalesCondition: vi.fn().mockResolvedValue(undefined),
}));

import { getRegionDetail } from "@/lib/analytics/queries/regions";
import { getHotelGroupDetail } from "@/lib/analytics/queries/hotel-groups";
import { getLocationGroupDetail } from "@/lib/analytics/queries/location-groups";
import type { AnalyticsFilters } from "@/lib/analytics/types";
import type { UserCtx } from "@/lib/scoping/scoped-query";

const VALID_FILTERS: AnalyticsFilters = {
  dateFrom: "2026-01-01",
  dateTo: "2026-01-31",
};

const VALID_USER_CTX: UserCtx = {
  id: "test-user",
  userType: "internal",
  role: "admin",
  ability: createMongoAbility([]) as AppAbility,
};

const SQL_INJECTION_PROBE =
  "'/**/UNION/**/SELECT/**/null,null,null,null,null,null,null,null--";

describe("Analytics query SQL injection — CR-01 fix", () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await setupTestDb();
    dbHolder.db = ctx.db;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  it("getRegionDetail rejects an SQL-injection probe id (drizzle param-bind throws)", async () => {
    // Drizzle's pg adapter throws on uuid bind cast for non-UUID strings.
    await expect(
      getRegionDetail(
        [SQL_INJECTION_PROBE],
        VALID_FILTERS,
        VALID_USER_CTX,
      ),
    ).rejects.toThrow();
  });

  it("getHotelGroupDetail rejects an SQL-injection probe id", async () => {
    await expect(
      getHotelGroupDetail(
        [SQL_INJECTION_PROBE],
        VALID_FILTERS,
        VALID_USER_CTX,
      ),
    ).rejects.toThrow();
  });

  it("getLocationGroupDetail rejects an SQL-injection probe id", async () => {
    await expect(
      getLocationGroupDetail(
        [SQL_INJECTION_PROBE],
        VALID_FILTERS,
        VALID_USER_CTX,
      ),
    ).rejects.toThrow();
  });
});
