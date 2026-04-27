/**
 * PR-30 / Task 4.11 — Actions Dashboard server-side query coverage.
 *
 * Two invariants pinned here:
 *
 *   D. Default sort: `due_date ASC NULLS LAST, created_at ASC`. The previous
 *      implementation ordered by `created_at` only, which surfaced new actions
 *      ahead of overdue ones — backwards from how operators actually want to
 *      triage. A regression here would silently return rows in the wrong order.
 *
 *   C. `locationIds` filter: when supplied, the WHERE clause must use the
 *      `inArray(action_items.location_id, …)` form so the picker actually
 *      narrows the result set. Missing this clause was the bug the picker
 *      was added to fix.
 *
 * Strategy: stub `db.select(...).from(...).leftJoin(...).leftJoin(...).where(...).orderBy(...)`
 * with an inline-thenable chain, capture the WHERE fragment + ORDER BY args
 * via `toSQL()`, and assert against the rendered SQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";

const captured: { where: string; orderBy: string } = { where: "", orderBy: "" };

function renderFragment(frag: unknown): string {
  if (!frag) return "";
  const fakeDb = drizzle("postgres://noop");
  try {
    return fakeDb
      .select({ v: drizzleSql`1` })
      .from(drizzleSql`action_items`)
      .where(frag as never)
      .toSQL().sql;
  } catch {
    const obj = frag as { toSQL?: () => { sql: string } };
    if (obj?.toSQL) return obj.toSQL().sql;
    return String(frag);
  }
}

function renderOrderBy(...frags: unknown[]): string {
  if (frags.length === 0) return "";
  const fakeDb = drizzle("postgres://noop");
  try {
    return fakeDb
      .select({ v: drizzleSql`1` })
      .from(drizzleSql`action_items`)
      .orderBy(...(frags as never[]))
      .toSQL().sql;
  } catch {
    return frags
      .map((f) => {
        const obj = f as { toSQL?: () => { sql: string } };
        if (obj?.toSQL) return obj.toSQL().sql;
        return String(f);
      })
      .join(", ");
  }
}

// Chainable mock — listActionItems uses
// db.select(...).from(...).leftJoin(...).leftJoin(...).where(...).orderBy(...)
// Drizzle's subquery alias for `owner` also calls db.select(...).from(...).as(...),
// so the chain must support `.as()` and stop there (no await on that branch).
function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.as = () => chain; // for the `.as("owner")` subquery
  chain.where = (frag: unknown) => {
    captured.where = renderFragment(frag);
    return chain;
  };
  chain.orderBy = async (...frags: unknown[]) => {
    captured.orderBy = renderOrderBy(...frags);
    return [];
  };
  (chain as { then?: unknown }).then = (resolve: (v: unknown[]) => void) =>
    resolve([]);
  return chain;
}

vi.mock("@/db", () => ({
  db: {
    select: () => makeChain(),
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

beforeEach(() => {
  captured.where = "";
  captured.orderBy = "";
});

describe("listActionItems — sort + locationIds filter (Task 4.11)", () => {
  it("default sort is due_date ASC NULLS LAST, then created_at ASC", async () => {
    const { listActionItems } = await import("../actions");
    await listActionItems();

    expect(captured.orderBy).toMatch(/due_date/i);
    expect(captured.orderBy.toUpperCase()).toContain("ASC NULLS LAST");
    expect(captured.orderBy).toMatch(/created_at/i);
    // Order-of-args matters: due_date fragment must appear before created_at.
    const duePos = captured.orderBy.toLowerCase().indexOf("due_date");
    const createdPos = captured.orderBy.toLowerCase().indexOf("created_at");
    expect(duePos).toBeGreaterThanOrEqual(0);
    expect(createdPos).toBeGreaterThan(duePos);
  });

  it("locationIds filter renders an IN (...) clause against location_id", async () => {
    const { listActionItems } = await import("../actions");
    await listActionItems({
      locationIds: [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ],
    });

    expect(captured.where).toMatch(/location_id/i);
    expect(captured.where.toLowerCase()).toMatch(/in \(/);
  });

  it("status + actionType + locationIds combine via AND", async () => {
    const { listActionItems } = await import("../actions");
    await listActionItems({
      status: "open",
      actionType: "investigation",
      locationIds: ["11111111-1111-1111-1111-111111111111"],
    });

    expect(captured.where.toLowerCase()).toContain("status");
    expect(captured.where.toLowerCase()).toContain("action_type");
    expect(captured.where.toLowerCase()).toContain("location_id");
    expect(captured.where.toLowerCase()).toContain(" and ");
  });

  it("no filters: WHERE is empty (undefined fragment), sort still applied", async () => {
    const { listActionItems } = await import("../actions");
    await listActionItems();

    expect(captured.where).toBe("");
    expect(captured.orderBy).toMatch(/due_date/i);
  });
});
