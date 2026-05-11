/**
 * Wave 0 RED scaffold — custom-role.integration.test.ts
 *
 * Integration test for the custom-role creation → assignment → ability roundtrip.
 * AUTH-07 SC4: admin creates a custom role with explicit rules, assigns it to a
 * target user with a scope, then buildAbility returns those exact rules + conditions.
 *
 * Fails at module-load because @/lib/casl/* and role CRUD helpers don't exist yet.
 * Do NOT make these pass in this plan — Wave 2 is the GREEN bar.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../helpers/test-db";
import { user } from "@/db/schema";
import { buildAbility } from "@/lib/casl/ability";
// @ts-expect-error — Wave 0 RED: @/lib/casl/role-mutations does not exist until Plan 10-03
import { createRole, assignRole } from "@/lib/casl/role-mutations";

describe("custom role roundtrip (integration)", () => {
  let ctx: TestDbContext;

  const adminId = randomUUID();
  const targetUserId = randomUUID();

  beforeAll(async () => {
    ctx = await setupTestDb();

    await ctx.db.insert(user).values([
      {
        id: adminId,
        email: "admin-custom@t.t",
        name: "Admin Custom Test",
        emailVerified: true,
        userType: "internal",
        role: "admin",
      },
      {
        id: targetUserId,
        email: "target-custom@t.t",
        name: "Target Custom Test",
        emailVerified: true,
        userType: "internal",
        role: "viewer",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await teardownTestDb(ctx);
  });

  it("create custom role → assign to user → buildAbility reflects the explicit rules", async () => {
    // Fails at module-load: Cannot find module '@/lib/casl/ability' or '@/lib/casl/role-mutations'
    const roleId = await createRole(ctx.db, {
      displayName: "Custom Kiosk Reader",
      description: "Can only read Kiosk",
      rules: [{ action: "read", subject: "Kiosk" }],
    });

    await assignRole(ctx.db, {
      userId: targetUserId,
      roleId,
      scope: { regionId: "south-west" },
      grantedBy: adminId,
    });

    const ability = await buildAbility(targetUserId);
    expect(ability.can("read", "Kiosk")).toBe(true);
    expect(ability.can("update", "Kiosk")).toBe(false);
    expect(ability.can("read", "Location")).toBe(false);
  });
});
