/**
 * Wave 0 RED scaffold — migration-0051-backfill.integration.test.ts
 *
 * Integration tests for migration 0051 schema + backfill correctness.
 * AUTH-06 SC1 + AUTH-07 SC1: after migration 0051 runs, the roles table
 * must have exactly 3 seed rows, user_roles must backfill for pre-existing users,
 * and userScopes.role_id must be populated for all pre-existing scope rows.
 *
 * Fails because the `roles`, `role_permissions`, and `user_roles` tables do not
 * exist until Plan 10-02 ships migration 0051.
 * Do NOT make these pass in this plan — Wave 2 is the GREEN bar.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { isNull, isNotNull, count } from "drizzle-orm";
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../helpers/test-db";
import { user, userScopes } from "@/db/schema";

describe("migration 0051 backfill (integration)", () => {
  let ctx: TestDbContext;

  // Pre-seeded users with old user.role text values — simulating the pre-0051 state
  const preExistingAdminId = randomUUID();
  const preExistingMemberId = randomUUID();
  const preExistingViewerId = randomUUID();

  beforeAll(async () => {
    ctx = await setupTestDb();

    // Seed users with the legacy role text values
    await ctx.db.insert(user).values([
      {
        id: preExistingAdminId,
        email: "pre-admin-0051@t.t",
        name: "Pre-existing Admin",
        emailVerified: true,
        userType: "internal",
        role: "admin",
      },
      {
        id: preExistingMemberId,
        email: "pre-member-0051@t.t",
        name: "Pre-existing Member",
        emailVerified: true,
        userType: "internal",
        role: "member",
      },
      {
        id: preExistingViewerId,
        email: "pre-viewer-0051@t.t",
        name: "Pre-existing Viewer",
        emailVerified: true,
        userType: "internal",
        role: "viewer",
      },
    ]);

    // Seed a userScope row for the member user (simulates pre-existing scope)
    // This row starts without a role_id — the backfill must populate it.
    await ctx.db.insert(userScopes).values({
      id: randomUUID(),
      userId: preExistingMemberId,
      scopeType: "region",
      scopeId: "test-region-0051",
      // role_id is intentionally omitted — the backfill populates it
    });
  }, 120_000);

  afterAll(async () => {
    await teardownTestDb(ctx);
  });

  it("roles table contains exactly 3 seed rows after migration 0051", async () => {
    // Fails because the `roles` table doesn't exist until Plan 10-02.
    // After migration 0051: admin (kind=system), ops-it (kind=tier), read-only (kind=tier).
    const { roles } = await import("@/db/schema");

    const [{ total }] = await ctx.db
      .select({ total: count() })
      .from(roles);

    expect(total).toBe(3);
  });

  it("role_permissions rows exist for ops-it and read-only; admin has zero rule rows", async () => {
    // Fails because the `role_permissions` table doesn't exist until Plan 10-02.
    // Admin (kind=system) short-circuits — no rule rows needed, managed in code.
    // Ops-it and read-only must have ≥1 rule row each.
    const { roles, rolePermissions } = await import("@/db/schema");

    const adminRole = await ctx.db.query.roles?.findFirst({
      where: (r: { kind: { equals: (s: string) => unknown } }) =>
        r.kind.equals("system"),
    });
    const opsItRole = await ctx.db.query.roles?.findFirst({
      where: (r: { name: { equals: (s: string) => unknown } }) =>
        r.name.equals("ops-it"),
    });
    const readOnlyRole = await ctx.db.query.roles?.findFirst({
      where: (r: { name: { equals: (s: string) => unknown } }) =>
        r.name.equals("read-only"),
    });

    expect(adminRole).toBeDefined();
    expect(opsItRole).toBeDefined();
    expect(readOnlyRole).toBeDefined();

    // Admin: zero rule rows (system short-circuit)
    const [{ adminCount }] = await ctx.db
      .select({ adminCount: count() })
      .from(rolePermissions)
      .where(rolePermissions.roleId.equals(adminRole!.id));

    expect(adminCount).toBe(0);

    // Ops-it: ≥1 rule row
    const [{ opsItCount }] = await ctx.db
      .select({ opsItCount: count() })
      .from(rolePermissions)
      .where(rolePermissions.roleId.equals(opsItRole!.id));

    expect(opsItCount).toBeGreaterThan(0);

    // Read-only: ≥1 rule row
    const [{ readOnlyCount }] = await ctx.db
      .select({ readOnlyCount: count() })
      .from(rolePermissions)
      .where(rolePermissions.roleId.equals(readOnlyRole!.id));

    expect(readOnlyCount).toBeGreaterThan(0);
  });

  it("every pre-existing user has a user_roles row matching their legacy user.role text", async () => {
    // Fails because the `user_roles` table doesn't exist until Plan 10-02.
    // Migration 0051 backfill must create user_roles rows for all pre-existing users.
    const { userRoles, roles } = await import("@/db/schema");
    const { eq, and, inArray } = await import("drizzle-orm");

    const preExistingUserIds = [
      preExistingAdminId,
      preExistingMemberId,
      preExistingViewerId,
    ];

    const existingRoles = await ctx.db
      .select()
      .from(userRoles)
      .where(inArray(userRoles.userId, preExistingUserIds));

    // Each pre-existing user must have exactly 1 user_roles row
    expect(existingRoles).toHaveLength(3);

    // Verify each user's role maps correctly
    const adminUserRole = existingRoles.find(
      (ur: { userId: string }) => ur.userId === preExistingAdminId,
    );
    const memberUserRole = existingRoles.find(
      (ur: { userId: string }) => ur.userId === preExistingMemberId,
    );
    const viewerUserRole = existingRoles.find(
      (ur: { userId: string }) => ur.userId === preExistingViewerId,
    );

    expect(adminUserRole).toBeDefined();
    expect(memberUserRole).toBeDefined();
    expect(viewerUserRole).toBeDefined();

    // Verify the role_id references the correct seed role
    const [adminRole] = await ctx.db
      .select()
      .from(roles)
      .where(eq(roles.id, adminUserRole!.roleId));

    expect(adminRole.kind).toBe("system"); // admin is kind=system

    const [memberRole] = await ctx.db
      .select()
      .from(roles)
      .where(eq(roles.id, memberUserRole!.roleId));

    expect(memberRole.name).toBe("ops-it"); // member maps to ops-it tier
  });

  it("zero userScopes rows have null role_id after backfill", async () => {
    // Fails because role_id column on userScopes doesn't exist until Plan 10-02.
    // Migration 0051 backfill must populate role_id for all pre-existing scope rows.
    const { userScopes: userScopesTable } = await import("@/db/schema");

    const [{ nullCount }] = await ctx.db
      .select({ nullCount: count() })
      .from(userScopesTable)
      .where(isNull(userScopesTable.roleId));

    expect(nullCount).toBe(0);
  });
});
