/**
 * PR-30 / Task 4.12 — Flag Review page server actions.
 *
 * Two queries pinned here:
 *
 *  - `fetchAllFlags`: WHERE clause must reflect the `resolved` filter
 *    (default = active only via `resolved_at IS NULL`; `true` = resolved
 *    only via `resolved_at IS NOT NULL`; `"all"` = no resolved-state
 *    filter), and `flagTypes` / `locationIds` must render `inArray`
 *    clauses against the right columns when supplied.
 *  - `fetchActionItemsForFlag` (lives in actions-dashboard/actions.ts):
 *    must filter on `source_type = 'flag' AND source_id = <flagId>` so
 *    flag rows show only their own follow-up actions.
 *
 * Note: `fetchAllFlags` is wrapped in `unstable_cache`, but Next's
 * `unstable_cache` is mocked here (no-op pass-through), so the WHERE
 * fragment we capture is the raw Drizzle one — same shape we'd see
 * on a cache miss in production.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";

const captured: { where: string }[] = [];

function renderFragment(frag: unknown): string {
  if (!frag) return "";
  const fakeDb = drizzle("postgres://noop");
  try {
    return fakeDb
      .select({ v: drizzleSql`1` })
      .from(drizzleSql`location_flags`)
      .where(frag as never)
      .toSQL().sql;
  } catch {
    const obj = frag as { toSQL?: () => { sql: string } };
    if (obj?.toSQL) return obj.toSQL().sql;
    return String(frag);
  }
}

function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.as = () => chain; // for `.as("owner")` subquery aliases
  chain.where = (frag: unknown) => {
    captured.push({ where: renderFragment(frag) });
    return chain;
  };
  chain.orderBy = async () => [];
  chain.limit = async () => [];
  (chain as { then?: unknown }).then = (resolve: (v: unknown[]) => void) =>
    resolve([]);
  return chain;
}

vi.mock("@/db", () => ({
  db: {
    select: () => makeChain(),
    selectDistinct: () => makeChain(),
  },
}));

vi.mock("@/lib/auth/get-user-ctx", () => ({
  getUserCtx: vi.fn().mockResolvedValue({
    id: "u-1",
    userType: "internal",
    role: "admin",
  }),
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(),
}));

// Pass-through cache wrapper — the only thing we care about is the inner
// function's WHERE clause shape. The real `unstable_cache` would memoise
// the result; for assertion purposes we want the raw query each call.
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/rbac", () => ({
  getSessionOrThrow: vi.fn().mockResolvedValue({
    user: { id: "u-1", name: "Test User" },
  }),
}));

beforeEach(() => {
  captured.length = 0;
});

describe("fetchAllFlags — Flag Review filters (Task 4.12)", () => {
  it("default (no filters): WHERE includes resolved_at IS NULL (active only)", async () => {
    const { fetchAllFlags } = await import("../actions");
    await fetchAllFlags();

    expect(captured.length).toBe(1);
    expect(captured[0]!.where.toLowerCase()).toContain("resolved_at");
    expect(captured[0]!.where.toLowerCase()).toContain("is null");
  });

  it("resolved=true: WHERE includes resolved_at IS NOT NULL", async () => {
    const { fetchAllFlags } = await import("../actions");
    await fetchAllFlags({ resolved: true });

    expect(captured.length).toBe(1);
    expect(captured[0]!.where.toLowerCase()).toContain("resolved_at");
    expect(captured[0]!.where.toLowerCase()).toContain("is not null");
  });

  it('resolved="all": WHERE has no resolved_at clause', async () => {
    const { fetchAllFlags } = await import("../actions");
    await fetchAllFlags({ resolved: "all" });

    expect(captured.length).toBe(1);
    // No resolved-state filter — but with no other filters either, the
    // WHERE fragment is undefined → captured.where is "" (empty render).
    expect(captured[0]!.where.toLowerCase()).not.toContain("resolved_at");
  });

  it("flagTypes filter: WHERE renders an IN (...) against flag_type", async () => {
    const { fetchAllFlags } = await import("../actions");
    await fetchAllFlags({
      resolved: "all",
      flagTypes: ["relocate", "monitor"],
    });

    expect(captured.length).toBe(1);
    expect(captured[0]!.where.toLowerCase()).toContain("flag_type");
    expect(captured[0]!.where.toLowerCase()).toMatch(/in \(/);
  });

  it("locationIds filter: WHERE renders an IN (...) against location_id", async () => {
    const { fetchAllFlags } = await import("../actions");
    await fetchAllFlags({
      resolved: "all",
      locationIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(captured.length).toBe(1);
    expect(captured[0]!.where.toLowerCase()).toContain("location_id");
    expect(captured[0]!.where.toLowerCase()).toMatch(/in \(/);
  });

  it("combines resolved=true + flagTypes + locationIds via AND", async () => {
    const { fetchAllFlags } = await import("../actions");
    await fetchAllFlags({
      resolved: true,
      flagTypes: ["relocate"],
      locationIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(captured.length).toBe(1);
    const where = captured[0]!.where.toLowerCase();
    expect(where).toContain("resolved_at");
    expect(where).toContain("flag_type");
    expect(where).toContain("location_id");
    expect(where).toContain(" and ");
  });
});

describe("fetchActionItemsForFlag — links to flag via source columns (Task 4.12)", () => {
  it("WHERE filters on source_type='flag' AND source_id=<flagId>", async () => {
    const { fetchActionItemsForFlag } = await import(
      "../../actions-dashboard/actions"
    );
    await fetchActionItemsForFlag(
      "flag-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    );

    expect(captured.length).toBe(1);
    const where = captured[0]!.where.toLowerCase();
    expect(where).toContain("source_type");
    expect(where).toContain("source_id");
    expect(where).toContain(" and ");
  });
});
