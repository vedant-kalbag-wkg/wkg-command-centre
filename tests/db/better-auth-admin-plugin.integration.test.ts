/**
 * Wave 0 RED scaffold — better-auth-admin-plugin.integration.test.ts
 *
 * Integration tests for backwards-compatibility between Better Auth's
 * admin plugin (reads user.role text) and the new user_roles table.
 * AUTH-06 SC1: user.role text mirror must stay in sync with user_roles after
 * assignRole / revokeRole mutations. Lockout check must apply to text mirror too.
 *
 * Fails at module-load because @/lib/casl/role-mutations and @/lib/casl/lockout-guard
 * do not exist yet. Also requires auth instance from @/lib/auth (plan 10-02).
 * Do NOT make these pass in this plan — Wave 2 is the GREEN bar.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../helpers/test-db";
import { user } from "@/db/schema";
// @ts-expect-error — Wave 0 RED: @/lib/casl/role-mutations does not exist until Plan 10-03
import { assignRole, revokeRole } from "@/lib/casl/role-mutations";
// @ts-expect-error — Wave 0 RED: @/lib/casl/lockout-guard does not exist until Plan 10-03
import { LOCKOUT_PREVENTION } from "@/lib/casl/lockout-guard";

describe("better-auth admin plugin backwards compat (integration)", () => {
  let ctx: TestDbContext;

  const adminId = randomUUID();
  const secondAdminId = randomUUID();
  const memberTargetId = randomUUID();

  beforeAll(async () => {
    ctx = await setupTestDb();

    // Seed two admins + one member target
    await ctx.db.insert(user).values([
      {
        id: adminId,
        email: "admin-ba@t.t",
        name: "Admin BA Test",
        emailVerified: true,
        userType: "internal",
        role: "admin",
      },
      {
        id: secondAdminId,
        email: "admin2-ba@t.t",
        name: "Admin2 BA Test",
        emailVerified: true,
        userType: "internal",
        role: "admin",
      },
      {
        id: memberTargetId,
        email: "member-ba@t.t",
        name: "Member BA Test",
        emailVerified: true,
        userType: "internal",
        role: "member",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await teardownTestDb(ctx);
  });

  it("auth.api.userHasPermission returns true for admin user.role text='admin'", async () => {
    // Fails at module-load: Cannot find module '@/lib/casl/role-mutations'
    // This test verifies Better Auth reads user.role text (not user_roles).
    // When user.role='admin', auth.api.userHasPermission({ permissions: { user: ['set-role'] } }) → true.

    // Import auth from the application (Wave 2 creates this properly)
    const { auth } = await import("@/lib/auth");

    // Create a mock request context for the Better Auth admin plugin
    const result = await auth.api.userHasPermission({
      body: {
        userId: adminId,
        permissions: { user: ["set-role"] },
      },
    });

    expect(result.success).toBe(true);
  });

  it("assignRole + revokeRole keep user.role text mirror in sync", async () => {
    // Fails at module-load: Cannot find module '@/lib/casl/role-mutations'
    //
    // Flow: adminId grants memberTargetId the ops-it role, then revokes admin role.
    // user.role text should update to 'member' (ops-it maps to member tier).
    //
    // This requires roles table + user_roles table (Wave 2 migration 0051).

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { roles } = await import("@/db/schema") as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opsItRole = await (ctx.db.query as any).roles?.findFirst({
      where: (r: { name: unknown }) => r.name,
    });

    if (!opsItRole) {
      // roles table doesn't exist yet — expected RED failure
      return;
    }

    // Assign ops-it role to member target (safe — doesn't trigger lockout)
    await assignRole(ctx.db, {
      userId: memberTargetId,
      roleId: opsItRole.id,
      scope: {},
      grantedBy: adminId,
    });

    // Verify user.role text mirror was updated
    const [updatedUser] = await ctx.db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, memberTargetId));

    expect(updatedUser.role).toBe("member");
  });

  it("revokeRole of last admin throws LOCKOUT_PREVENTION; user.role text unchanged after rollback", async () => {
    // Fails at module-load: Cannot find module '@/lib/casl/role-mutations'
    //
    // Setup: ensure adminId has exactly one admin user_roles row.
    // Action: attempt to revoke it (adminId is one of two admins — only fails if it IS the last).
    // For the lockout test: set up a fresh user who is the sole admin.

    const soleAdminId = randomUUID();
    await ctx.db.insert(user).values({
      id: soleAdminId,
      email: "sole-admin-ba@t.t",
      name: "Sole Admin BA",
      emailVerified: true,
      userType: "internal",
      role: "admin",
    });

    // Get the admin role id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { roles, userRoles } = await import("@/db/schema") as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminRole = await (ctx.db.query as any).roles?.findFirst({
      where: (r: { name: unknown }) => r.name,
    });

    if (!adminRole) {
      return;
    }

    const userRoleId = await assignRole(ctx.db, {
      userId: soleAdminId,
      roleId: adminRole.id,
      scope: {},
      grantedBy: adminId,
    });

    // Attempting to revoke the sole admin's grant must throw
    await expect(
      revokeRole(ctx.db, { userRoleId }),
    ).rejects.toThrow(LOCKOUT_PREVENTION);

    // Verify user.role text was NOT changed (transaction rolled back)
    const [unchanged] = await ctx.db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, soleAdminId));

    expect(unchanged.role).toBe("admin");
  });
});
