/**
 * Task 3.9 — listRegionOptions must restrict to regions visible to the
 * caller. Previously every internal user (including external-region-scoped
 * users via impersonation, and any future role widening) saw all regions in
 * the picker. The fix gates the SELECT on a membership subquery driven by
 * getScopedActiveLocationIds.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";

const captured: string[] = [];
const scopedActiveIdsFn = vi.fn();
const requireRoleFn = vi.fn();

function renderFragment(frag: unknown): string {
  if (!frag) return "";
  const fakeDb = drizzle("postgres://noop");
  try {
    return fakeDb
      .select({ v: drizzleSql`1` })
      .from(drizzleSql`regions`)
      .where(frag as never)
      .toSQL().sql;
  } catch {
    const obj = frag as { toSQL?: () => { sql: string } };
    if (obj?.toSQL) return obj.toSQL().sql;
    return String(frag);
  }
}

// Build a chainable mock that captures the where() fragment then resolves
// to an empty result set when the chain terminates with .orderBy(...).
function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = (frag: unknown) => {
    captured.push(renderFragment(frag));
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
    leftJoin: vi.fn(),
  },
}));

vi.mock("@/lib/scoping/scoped-active-locations", () => ({
  getScopedActiveLocationIds: (...args: unknown[]) =>
    scopedActiveIdsFn(...args),
}));

vi.mock("@/lib/rbac", () => ({
  requireRole: (...roles: string[]) => requireRoleFn(...roles),
  redactSensitiveFields: (x: unknown) => x,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(async () => undefined),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {},
  PutObjectCommand: class {},
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async () => "https://example.com/signed",
}));

beforeEach(() => {
  captured.length = 0;
  scopedActiveIdsFn.mockReset();
  requireRoleFn.mockReset();
  requireRoleFn.mockResolvedValue({
    user: {
      id: "user-uk-1",
      name: "UK External User",
      role: "viewer",
      userType: "external",
    },
  });
});

describe("listRegionOptions — scope-restricted picker (Task 3.9)", () => {
  it("non-empty scoped active ids: SQL gates regions on a membership subquery referencing those ids", async () => {
    scopedActiveIdsFn.mockResolvedValue([
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
    ]);
    const { listRegionOptions } = await import("../actions");
    await listRegionOptions();

    expect(scopedActiveIdsFn).toHaveBeenCalledWith({
      id: "user-uk-1",
      userType: "external",
      role: "viewer",
    });
    expect(captured.length).toBe(1);
    const sql = captured[0]!;
    // Picker filter must use the location_region_memberships subquery.
    expect(sql).toContain("location_region_memberships");
    expect(sql.toLowerCase()).toMatch(/in \(/);
    // The scoped active ids should be parameterised — look for the inArray
    // placeholder shape.
    expect(sql).toMatch(/\$1|location_id/i);
  });

  it("empty scoped active ids: returns [] without hitting the DB", async () => {
    scopedActiveIdsFn.mockResolvedValue([]);
    const { listRegionOptions } = await import("../actions");
    const result = await listRegionOptions();

    expect(result).toEqual([]);
    expect(captured.length).toBe(0);
  });

  it("requireRole rejection: returns [] (preserves prior swallow-and-return-empty behaviour)", async () => {
    requireRoleFn.mockRejectedValueOnce(new Error("Forbidden"));
    const { listRegionOptions } = await import("../actions");
    const result = await listRegionOptions();

    expect(result).toEqual([]);
    expect(scopedActiveIdsFn).not.toHaveBeenCalled();
  });
});
