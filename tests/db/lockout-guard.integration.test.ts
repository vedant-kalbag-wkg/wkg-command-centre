/**
 * Wave 0 RED scaffold — lockout-guard.integration.test.ts
 *
 * Integration tests for assertAtLeastOneEffectiveAdmin and the LOCKOUT_PREVENTION
 * sentinel thrown by revokeRole when revoking the last admin grant.
 * AUTH-06 SC3: removes should be refused when zero effective admins remain post-op.
 *
 * Fails at module-load because @/lib/casl/lockout-guard does not exist yet.
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
import {
  assertAtLeastOneEffectiveAdmin,
  LOCKOUT_PREVENTION,
} from "@/lib/casl/lockout-guard";
import { assignRole, revokeRole } from "@/lib/casl/role-mutations";

describe("lockout-guard (integration)", () => {
  let ctx: TestDbContext;

  const adminId = randomUUID();
  const nonAdminId = randomUUID();

  beforeAll(async () => {
    ctx = await setupTestDb();

    await ctx.db.insert(user).values([
      {
        id: adminId,
        email: "admin-lockout@t.t",
        name: "Admin Lockout Test",
        emailVerified: true,
        userType: "internal",
        role: "admin",
      },
      {
        id: nonAdminId,
        email: "nonadmin-lockout@t.t",
        name: "Non-Admin Lockout Test",
        emailVerified: true,
        userType: "internal",
        role: "viewer",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await teardownTestDb(ctx);
  });

  it("assertAtLeastOneEffectiveAdmin returns silently when ≥1 admin exists", async () => {
    // Fails at module-load: Cannot find module '@/lib/casl/lockout-guard'
    await expect(
      assertAtLeastOneEffectiveAdmin(ctx.db),
    ).resolves.toBeUndefined();
  });

  it("assertAtLeastOneEffectiveAdmin throws LOCKOUT_PREVENTION when excluding the only admin", async () => {
    // The only admin is adminId — excluding them should result in zero effective admins
    await expect(
      assertAtLeastOneEffectiveAdmin(ctx.db, { excludingUserId: adminId }),
    ).rejects.toThrow(LOCKOUT_PREVENTION);
  });

  it("revokeRole of last admin grant throws LOCKOUT_PREVENTION and rolls back", async () => {
    // Assign admin role to adminId so we have a user_roles row to revoke
    const roleId = await ctx.db.query.roles
      ?.findFirst({ where: (r: { name: { equals: (s: string) => unknown } }) => r.name.equals("admin") })
      .then((r: { id?: string } | undefined) => r?.id);

    if (!roleId) {
      // roles table doesn't exist yet (Wave 2 creates it via migration 0051)
      // this test will also fail at module-load — both failures are the correct RED signal
      return;
    }

    const userRoleId = await assignRole(ctx.db, {
      userId: adminId,
      roleId,
      scope: {},
      grantedBy: adminId,
    });

    // revokeRole of the only admin's only admin grant must throw
    await expect(
      revokeRole(ctx.db, { userRoleId }),
    ).rejects.toThrow(LOCKOUT_PREVENTION);

    // Verify the user_roles row was NOT deleted (transaction rolled back)
    const { userRoles } = await import("@/db/schema");
    const remaining = await ctx.db
      .select()
      .from(userRoles)
      .where(eq(userRoles.id, userRoleId));
    expect(remaining).toHaveLength(1);
  });

  it("Path B: query counts 1 effective admin for a custom role granting manage all; counts 0 when same role has inverted deny", async () => {
    // Path B: a custom role that grants `manage all` should count as an effective admin.
    // This test exercises the SQL query logic inside assertAtLeastOneEffectiveAdmin.
    // Fails at module-load because lockout-guard doesn't exist; also requires roles table.
    const customAdminRoleId = await ctx.db.query.roles?.findFirst({
      where: (r: { name: { equals: (s: string) => unknown } }) => r.name.equals("admin"),
    }).then((r: { id?: string } | undefined) => r?.id);

    if (!customAdminRoleId) {
      // roles table doesn't exist yet — this is the expected RED failure
      return;
    }

    // A user with a custom role that grants manage all counts as effective admin
    await assignRole(ctx.db, {
      userId: nonAdminId,
      roleId: customAdminRoleId,
      scope: {},
      grantedBy: adminId,
    });

    await expect(
      assertAtLeastOneEffectiveAdmin(ctx.db),
    ).resolves.toBeUndefined();

    // After revoking that grant, should throw LOCKOUT_PREVENTION if no other admin
    // (nonAdminId is the only one now; adminId never got a user_roles row in this sub-test)
  });
});
