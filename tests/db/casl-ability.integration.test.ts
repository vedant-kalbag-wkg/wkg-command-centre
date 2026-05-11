/**
 * Wave 0 RED scaffold — casl-ability.integration.test.ts
 *
 * Integration tests for buildAbility against a real testcontainers DB.
 * Verifies:
 *   - admin user → manage all
 *   - ops-it user with scoped userScopes (region) → scope conditions applied
 *   - viewer user → cannot update Location
 *
 * These tests FAIL because @/lib/casl/ability does not exist yet.
 * Do NOT make these pass in this plan — Wave 2 (Plan 10-03) is the GREEN bar.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from "../helpers/test-db";
import { user, userScopes } from "@/db/schema";
import { buildAbility } from "@/lib/casl/ability";

describe("buildAbility (integration)", () => {
  let ctx: TestDbContext;

  const adminId = randomUUID();
  const opsItUserId = randomUUID();
  const viewerId = randomUUID();

  beforeAll(async () => {
    ctx = await setupTestDb();

    // Seed minimal user rows — roles will be assigned via user_roles after Plan 10-02
    // creates the roles + role_permissions tables. For now, the table inserts confirm
    // the DB schema is accessible; buildAbility call will fail with missing-module error.
    await ctx.db.insert(user).values([
      {
        id: adminId,
        email: "admin-casl@t.t",
        name: "Admin CASL Test",
        emailVerified: true,
        userType: "internal",
        role: "admin",
      },
      {
        id: opsItUserId,
        email: "ops-it-casl@t.t",
        name: "Ops-IT CASL Test",
        emailVerified: true,
        userType: "internal",
        role: "member",
      },
      {
        id: viewerId,
        email: "viewer-casl@t.t",
        name: "Viewer CASL Test",
        emailVerified: true,
        userType: "internal",
        role: "viewer",
      },
    ]);
  }, 120_000);

  afterAll(async () => {
    await teardownTestDb(ctx);
  });

  it("admin user: buildAbility returns ability with manage all", async () => {
    // Fails at module-load time: Cannot find module '@/lib/casl/ability'
    const ability = await buildAbility(adminId);
    expect(ability.can("manage", "all")).toBe(true);
  });

  it("ops-it user with region scope: can read Location in scope, cannot read outside scope", async () => {
    const ability = await buildAbility(opsItUserId);
    // Within scope — should be allowed
    expect(
      ability.can("read", { __caslSubjectType__: "Location", regionId: "south-west" } as unknown as "Location"),
    ).toBe(true);
    // Outside scope — should be denied
    expect(
      ability.can("read", { __caslSubjectType__: "Location", regionId: "north" } as unknown as "Location"),
    ).toBe(false);
  });

  it("viewer user: cannot update Location", async () => {
    const ability = await buildAbility(viewerId);
    expect(ability.can("update", "Location")).toBe(false);
  });
});
