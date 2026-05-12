/**
 * Plan 10-03 GREEN — ability.test.ts
 *
 * Tests the public API of @/lib/casl/ability (buildAbility).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// react.cache mock — must come BEFORE importing ability (which imports react).
//
// react.cache() in Node.js (outside a React render) does NOT memoize across
// sequential awaits. We replace it with a Map-based implementation so the
// "same reference" memoisation test can pass. The cache map is cleared in
// beforeEach so each test gets a fresh request-scoped cache.
// ---------------------------------------------------------------------------

const __cacheStore = new Map<string, unknown>();

vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return {
    ...original,
    cache: <T extends (...args: Parameters<T>) => ReturnType<T>>(fn: T): T => {
      return ((...args: Parameters<T>): ReturnType<T> => {
        const key = JSON.stringify(args);
        if (!__cacheStore.has(key)) {
          __cacheStore.set(key, fn(...args));
        }
        return __cacheStore.get(key) as ReturnType<T>;
      }) as T;
    },
  };
});

import { buildAbility, type AppAbility, type Subject, type Action } from "@/lib/casl/ability";

// ---------------------------------------------------------------------------
// DB fixtures for unit project (no real Postgres — vi.mock replaces @/db).
//
// buildAbility calls db.select() three times per userId:
//   1. User row  (from userTable)
//   2. Grants    (from userRoles + roles + rolePermissions)
//   3. Scopes    (from userScopes)
//
// We intercept these via a stateful counter stored in __mockState.
// ---------------------------------------------------------------------------

interface UserRow { id: string; userType: string | null; role: string | null; }
interface GrantRow {
  roleId: string; roleKind: string;
  action: string | null; subject: string | null;
  fields: string[] | null; conditions: Record<string, unknown> | null; inverted: boolean;
}

const USER_ROWS: Record<string, UserRow> = {
  "user-system-001":   { id: "user-system-001",   userType: "system",   role: null    },
  "user-admin-001":    { id: "user-admin-001",    userType: "internal", role: "admin" },
  "user-readonly-001": { id: "user-readonly-001", userType: "internal", role: "viewer" },
  "user-ops-it-001":   { id: "user-ops-it-001",   userType: "internal", role: "member" },
};

const GRANT_ROWS: Record<string, GrantRow[]> = {
  "user-system-001": [],
  "user-admin-001": [
    { roleId: "role-admin", roleKind: "system", action: null, subject: null,
      fields: null, conditions: null, inverted: false },
  ],
  "user-readonly-001": [
    { roleId: "role-readonly", roleKind: "tier", action: "read", subject: "all",
      fields: null, conditions: null, inverted: false },
  ],
  "user-ops-it-001": [
    { roleId: "role-ops-it", roleKind: "tier", action: "read",   subject: "all",      fields: null, conditions: null, inverted: false },
    { roleId: "role-ops-it", roleKind: "tier", action: "create", subject: "Location", fields: null, conditions: null, inverted: false },
    { roleId: "role-ops-it", roleKind: "tier", action: "update", subject: "Location", fields: null, conditions: null, inverted: false },
  ],
};

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// __mockState is shared between the mock factory and the test helpers.
const __mockState = {
  userId: "user-admin-001",
  callIndex: 0,
};

// Build a fluent chain that resolves to fixture data based on call order.
function buildQueryChain() {
  const idx = __mockState.callIndex++;
  const uid = __mockState.userId;

  let data: unknown[];
  if (idx === 0) {
    const row = USER_ROWS[uid];
    data = row ? [row] : [];
  } else if (idx === 1) {
    data = GRANT_ROWS[uid] ?? [];
  } else {
    data = []; // scopes — empty for all test fixtures
  }

  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  const thenFn = (
    res: (v: unknown[]) => void,
    rej: (e: unknown) => void,
  ) => Promise.resolve(data).then(res, rej);

  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.then = thenFn as (...a: unknown[]) => unknown;
  return chain;
}

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => buildQueryChain()),
  },
}));

vi.mock("@/db/schema", () => ({
  user:            { id: "id", userType: "userType", role: "role" },
  userRoles:       { userId: "userId", roleId: "roleId" },
  roles:           { id: "id", kind: "kind" },
  rolePermissions: {
    roleId: "roleId", action: "action", subject: "subject",
    fields: "fields", conditions: "conditions", inverted: "inverted",
  },
  userScopes: { userId: "userId", roleId: "roleId", dimensionType: "dim", dimensionId: "id" },
}));

vi.mock("drizzle-orm", async (importOriginal) => {
  const original = await importOriginal<typeof import("drizzle-orm")>();
  return { ...original, eq: vi.fn() };
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Set which user the next buildAbility call will resolve fixture data for. */
function setUser(userId: string) {
  __mockState.userId = userId;
  __mockState.callIndex = 0;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildAbility", () => {
  beforeEach(async () => {
    // Clear the react.cache Map so each test gets a fresh per-request cache.
    __cacheStore.clear();
    vi.clearAllMocks();
    // Re-wire select mock after clearAllMocks.
    const { db } = await import("@/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => buildQueryChain());
  });

  it("system userType short-circuit: can manage all", async () => {
    // A user row with userType='system' must bypass all role checks
    setUser("user-system-001");
    const ability = await buildAbility("user-system-001");
    expect(ability.can("manage", "all")).toBe(true);
  });

  it("admin role: manage all regardless of scope rows (system role bypass)", async () => {
    // A user assigned the seeded system Admin role gets manage all
    setUser("user-admin-001");
    const ability = await buildAbility("user-admin-001");
    expect(ability.can("manage", "all")).toBe(true);
  });

  it("read-only role: cannot update Location", async () => {
    // A user assigned only the seeded read-only role cannot update any Location
    setUser("user-readonly-001");
    const ability = await buildAbility("user-readonly-001");
    expect(ability.can("update", "Location")).toBe(false);
  });

  it("react.cache memoisation: same userId returns same ability reference within request", async () => {
    // buildAbility wraps the DB query in react.cache — calling twice in same context
    // must return the same object reference and only hit the DB once.
    setUser("user-admin-001");
    const ability1 = await buildAbility("user-admin-001");
    const ability2 = await buildAbility("user-admin-001");
    expect(ability1).toBe(ability2);
  });

  it("ops-it tier role: can read Location", async () => {
    setUser("user-ops-it-001");
    const ability = await buildAbility("user-ops-it-001");
    expect(ability.can("read", "Location")).toBe(true);
  });

  it("ops-it tier role: cannot delete Location", async () => {
    setUser("user-ops-it-001");
    const ability = await buildAbility("user-ops-it-001");
    expect(ability.can("delete", "Location")).toBe(false);
  });
});
