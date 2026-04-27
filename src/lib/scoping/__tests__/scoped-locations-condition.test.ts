/**
 * PR-19 / Task 3.6 — scopedLocationsCondition emits a `locations.id`-relative
 * scope predicate. Sibling of scopedSalesCondition; used by the cohort picker
 * (selects FROM locations, not sales_records).
 *
 * Strategy: hand-stub the minimum NodePgDatabase surface needed
 * (`db.select(...).from(...).where(...)` returns the userScopes rows) and
 * assert (a) admin → undefined, (b) external-region → SQL contains the
 * region-membership subselect, (c) external-location → SQL contains
 * inArray(locations.id, ...).
 */
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as drizzleSql, type SQL } from "drizzle-orm";
import {
  scopedLocationsCondition,
  type Scope,
  type UserCtx,
} from "../scoped-query";

const fakeDb = drizzle("postgres://noop");

function renderFragment(frag: SQL | undefined): string {
  if (!frag) return "";
  return fakeDb
    .select({ v: drizzleSql`1` })
    .from(drizzleSql`locations`)
    .where(frag)
    .toSQL().sql;
}

// Stub the chained `db.select().from().where()` call used inside
// scopedLocationsCondition. The helper resolves to the user_scopes rows.
function stubDbWithScopes(scopes: Scope[]) {
  return {
    select: () => ({
      from: () => ({
        where: async () => scopes,
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const admin: UserCtx = {
  id: "a1",
  userType: "internal",
  role: "admin",
};

const externalRegion: UserCtx = {
  id: "e-region",
  userType: "external",
  role: null,
};

const externalLocation: UserCtx = {
  id: "e-loc",
  userType: "external",
  role: null,
};

describe("scopedLocationsCondition", () => {
  it("returns undefined for admin (unrestricted)", async () => {
    const db = stubDbWithScopes([]); // admin → buildScopeFilter returns null regardless
    const result = await scopedLocationsCondition(db, admin);
    expect(result).toBeUndefined();
  });

  it("emits a region-membership subselect for external-region users", async () => {
    const db = stubDbWithScopes([
      { dimensionType: "region", dimensionId: "region-uk" },
    ]);
    const result = await scopedLocationsCondition(db, externalRegion);
    expect(result).toBeDefined();
    const rendered = renderFragment(result);
    expect(rendered).toContain("location_region_memberships");
    expect(rendered).toContain('"locations"."id"');
  });

  it("emits inArray on locations.id for external-location users", async () => {
    const db = stubDbWithScopes([
      { dimensionType: "location", dimensionId: "loc-1" },
      { dimensionType: "location", dimensionId: "loc-2" },
    ]);
    const result = await scopedLocationsCondition(db, externalLocation);
    expect(result).toBeDefined();
    const rendered = renderFragment(result);
    expect(rendered).toContain('"locations"."id" in');
  });

  it("throws on product/provider scopes (not applicable to locations)", async () => {
    const db = stubDbWithScopes([
      { dimensionType: "product", dimensionId: "p-1" },
    ]);
    await expect(scopedLocationsCondition(db, externalLocation)).rejects.toThrow(
      /not applicable to locations-only queries/,
    );
  });
});
