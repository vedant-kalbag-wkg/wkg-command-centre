/**
 * Wave 0 RED scaffold — ability.test.ts
 *
 * Tests the public API of @/lib/casl/ability (buildAbility).
 * These tests FAIL at module-load time until Plan 10-03 creates the module.
 * Do NOT make these pass in this plan — Wave 2 is the GREEN bar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
// @ts-expect-error — Wave 0 RED: @/lib/casl/ability does not exist until Plan 10-03
import { buildAbility, type AppAbility, type Subject, type Action } from "@/lib/casl/ability";

describe("buildAbility", () => {
  it("system userType short-circuit: can manage all", async () => {
    // A user row with userType='system' must bypass all role checks
    const ability = await buildAbility("user-system-001");
    expect(ability.can("manage", "all")).toBe(true);
  });

  it("admin role: manage all regardless of scope rows (system role bypass)", async () => {
    // A user assigned the seeded system Admin role gets manage all
    const ability = await buildAbility("user-admin-001");
    expect(ability.can("manage", "all")).toBe(true);
  });

  it("read-only role: cannot update Location", async () => {
    // A user assigned only the seeded read-only role cannot update any Location
    const ability = await buildAbility("user-readonly-001");
    expect(ability.can("update", "Location")).toBe(false);
  });

  it("react.cache memoisation: same userId returns same ability reference within request", async () => {
    // buildAbility wraps the DB query in react.cache — calling twice in same context
    // must return the same object reference and only hit the DB once.
    const dbSpy = vi.fn();
    // If module exports an injectable db, spy on it; otherwise verify via call count assertion
    // The memoisation contract: two calls with the same userId in the same request lifecycle
    // must return the strictly equal reference.
    const ability1 = await buildAbility("user-admin-001");
    const ability2 = await buildAbility("user-admin-001");
    expect(ability1).toBe(ability2);
  });

  it("ops-it tier role: can read Location", async () => {
    const ability = await buildAbility("user-ops-it-001");
    expect(ability.can("read", "Location")).toBe(true);
  });

  it("ops-it tier role: cannot delete Location", async () => {
    const ability = await buildAbility("user-ops-it-001");
    expect(ability.can("delete", "Location")).toBe(false);
  });
});
