import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  kioskAssignments,
  locationHotelGroupMemberships,
  locationRegionMemberships,
  salesRecords,
} from "../../src/db/schema";

/**
 * Proves all four tierIds-filtered subqueries in computePerformerPatterns
 * (src/lib/analytics/queries/high-performer-analysis.ts) bind `tierIds` as a
 * single array parameter, not N unpacked uuids.
 *
 * Before Phase 2's rewrite, each had `IN (${sql.join(tierIds.map(...), ...)})`
 * which produced N+constant parameters — a different prepared-statement
 * shape per call site, defeating PG's plan cache. After: 1 parameter,
 * stable plan regardless of tierIds.length.
 *
 * Failure mode: if a future edit reverts to sql.join form, params.length
 * becomes N (or N+constant) and the matching named expectation fails with
 * the fragment name (hotelGroupRows / regionRows / kioskRows / topProductRows).
 *
 * --- Deviations from spec ---
 *
 * 1. PgDialect direct vs db.dialect:
 *    Spec proposed `db.dialect.toQuery(...)` via the runtime `db` export,
 *    which would require DATABASE_URL just to load the module. We instead
 *    instantiate `new PgDialect()` directly — no DB connection, no env
 *    coupling. The compile path is identical:
 *      PgDialect.sqlToQuery(sql) → QueryWithTypings extends { sql, params }
 *    (see node_modules/drizzle-orm/pg-core/dialect.d.ts:53 and
 *     node_modules/drizzle-orm/sql/sql.d.ts:31-37).
 *
 * 2. sql.param(tierIds) instead of bare ${tierIds}:
 *    Spec hypothesised `${tierIds}::uuid[]` would bind as one array param.
 *    In drizzle-orm 0.45.2 it does NOT — the SQL builder treats a raw JS
 *    array chunk as `(p1, p2, ..., pN)` (see node_modules/drizzle-orm/sql/
 *    sql.js:93-103). The canonical way to bind a single value (array
 *    included) is `sql.param(value)`. With it, the emitted SQL is
 *    `ANY($1::uuid[])` and params is `[tierIds]` — exactly the stable
 *    1-parameter shape Phase 2 wants. Task 7 must use this form.
 *
 * 3. tests/db/ added to vitest unit project include glob:
 *    Existing config excluded `tests/**` from the unit project entirely
 *    (only `*.integration.test.ts` was discovered there, by the integration
 *    project). This pure-unit test lives at the spec-mandated path
 *    `tests/db/high-performer-bind-shape.test.ts`, so vitest.config.ts
 *    was extended to also pick up `tests/**\/*.test.ts` for the unit
 *    project (excluding `*.integration.test.ts` and `*.spec.ts`).
 */
describe("high-performer-analysis bind shape", () => {
  const dialect = new PgDialect();
  const fixture50: string[] = Array.from({ length: 50 }, () =>
    crypto.randomUUID(),
  );
  const fixture10: string[] = Array.from({ length: 10 }, () =>
    crypto.randomUUID(),
  );

  function paramCount(tierIds: string[]): Record<string, number> {
    // Each fragment as it will appear in the rewritten code in
    // src/lib/analytics/queries/high-performer-analysis.ts (Task 7).
    // Keep these in sync with the production templates.
    //
    // NOTE: `sql.param(tierIds)` is required, not bare `${tierIds}` — see
    // top-of-file deviation #2.
    const tierIdsParam = sql.param(tierIds);
    const fragments = {
      hotelGroupRows: sql`
        SELECT 1 FROM ${locationHotelGroupMemberships}
        WHERE ${locationHotelGroupMemberships.locationId} = ANY(${tierIdsParam}::uuid[])
      `,
      regionRows: sql`
        SELECT 1 FROM ${locationRegionMemberships}
        WHERE ${locationRegionMemberships.locationId} = ANY(${tierIdsParam}::uuid[])
      `,
      kioskRows: sql`
        SELECT 1 FROM ${kioskAssignments}
        WHERE ${kioskAssignments.locationId} = ANY(${tierIdsParam}::uuid[])
          AND ${kioskAssignments.unassignedAt} IS NULL
      `,
      topProductRows: sql`
        SELECT 1 FROM ${salesRecords}
        WHERE ${salesRecords.locationId} = ANY(${tierIdsParam}::uuid[])
      `,
    };

    const counts: Record<string, number> = {};
    for (const [name, fragment] of Object.entries(fragments)) {
      const compiled = dialect.sqlToQuery(fragment);
      counts[name] = compiled.params.length;
    }
    return counts;
  }

  it("emits param count invariant under tierIds length", () => {
    const c50 = paramCount(fixture50);
    const c10 = paramCount(fixture10);
    for (const name of Object.keys(c50)) {
      expect(c50[name], `${name} with 50 ids`).toBe(1);
      expect(c10[name], `${name} with 10 ids`).toBe(1);
      expect(c50[name], `${name} length-invariance (50 vs 10)`).toBe(c10[name]);
    }
  });
});
