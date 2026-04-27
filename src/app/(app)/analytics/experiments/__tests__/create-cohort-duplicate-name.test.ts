/**
 * Phase 4.10 — createCohort surfaces the (created_by, name) UNIQUE-violation
 * (migration 0035) as a typed DuplicateCohortNameError. Earlier behaviour
 * leaked the raw Postgres error to the client; this test pins the friendly
 * surface so the form can render the right message.
 *
 * Strategy: mock the auth context + the audit write, then make
 * `db.insert(...).values(...).returning()` reject with the shape pg / drizzle
 * produce on UNIQUE violations (`{ code: '23505', constraint: '...' }`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertReturningFn = vi.fn();

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: () => insertReturningFn(),
      }),
    }),
  },
}));

vi.mock("@/lib/auth/get-user-ctx", () => ({
  getUserCtx: vi.fn().mockResolvedValue({
    id: "user-1",
    userType: "internal",
    role: "admin",
  }),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi
        .fn()
        .mockResolvedValue({ user: { id: "user-1", name: "Test User" } }),
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

const writeAuditLogFn = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAuditLog: (...args: unknown[]) => writeAuditLogFn(...args),
}));

import { createCohort, DuplicateCohortNameError } from "../actions";

const okCohort = {
  id: "cohort-1",
  name: "Q1 Promo",
  description: null,
  locationIds: ["loc-a"],
  controlType: "rest_of_portfolio",
  controlLocationIds: null,
  interventionDate: null,
  createdBy: "user-1",
  createdAt: new Date("2026-04-27T00:00:00Z"),
  updatedAt: new Date("2026-04-27T00:00:00Z"),
};

const baseInput = {
  name: "Q1 Promo",
  locationIds: ["loc-a"],
  controlType: "rest_of_portfolio" as const,
};

beforeEach(() => {
  insertReturningFn.mockReset();
  writeAuditLogFn.mockReset();
});

describe("createCohort — duplicate (created_by, name)", () => {
  it("rethrows DuplicateCohortNameError when pg returns code 23505 with the right constraint", async () => {
    const pgError = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "experiment_cohorts_created_by_name_unique",
    });
    insertReturningFn.mockRejectedValueOnce(pgError);

    let caught: unknown;
    try {
      await createCohort(baseInput);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DuplicateCohortNameError);
    expect((caught as Error).message).toMatch(/Q1 Promo/);
  });

  it("rethrows DuplicateCohortNameError even if only the message references the index (defensive)", async () => {
    const messageOnly = new Error(
      'duplicate key value violates unique constraint "experiment_cohorts_created_by_name_unique"',
    );
    insertReturningFn.mockRejectedValueOnce(messageOnly);

    await expect(createCohort(baseInput)).rejects.toBeInstanceOf(
      DuplicateCohortNameError,
    );
  });

  it("does not swallow unrelated errors (re-throws them as-is)", async () => {
    const otherError = new Error("connection lost");
    insertReturningFn.mockRejectedValueOnce(otherError);

    await expect(createCohort(baseInput)).rejects.toBe(otherError);
  });

  it("passes the happy path through unchanged and writes an audit log", async () => {
    insertReturningFn.mockResolvedValueOnce([okCohort]);

    const result = await createCohort(baseInput);
    expect(result.id).toBe("cohort-1");
    expect(result.name).toBe("Q1 Promo");
    expect(writeAuditLogFn).toHaveBeenCalledTimes(1);
  });
});
