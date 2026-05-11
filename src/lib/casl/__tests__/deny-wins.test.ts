/**
 * Wave 0 RED scaffold — deny-wins.test.ts
 *
 * Tests that explicit `cannot` (inverted) rules win over `can` rules when
 * building a union ability across multiple roles.
 * These tests FAIL at module-load time until Plan 10-03 creates the modules.
 * Do NOT make these pass in this plan — Wave 2 is the GREEN bar.
 */
import { describe, it, expect } from "vitest";
import { AbilityBuilder, createMongoAbility } from "@casl/ability";
// @ts-expect-error — Wave 0 RED: @/lib/casl/ability does not exist until Plan 10-03
import { type AppAbility, type Subject, type Action } from "@/lib/casl/ability";

/**
 * Build a union ability merging two independent role rule-sets, mirroring
 * the Pattern the real buildAbility uses for multi-role users.
 * Inverted rules (cannot) have higher priority than allow rules in CASL's
 * MongoAbility implementation.
 */
function buildUnionAbility(
  configureRoleA: (can: AbilityBuilder<AppAbility>["can"], cannot: AbilityBuilder<AppAbility>["cannot"]) => void,
  configureRoleB: (can: AbilityBuilder<AppAbility>["can"], cannot: AbilityBuilder<AppAbility>["cannot"]) => void,
): AppAbility {
  // Build each role's rules independently, then merge into a single ability.
  // Both `can` and `cannot` calls from both roles go into one builder so the
  // MongoAbility engine's standard rule-priority semantics apply.
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  configureRoleA(can, cannot);
  configureRoleB(can, cannot);
  return build();
}

describe("deny-wins: explicit cannot overrides can in rule union", () => {
  it("role A grants update on Kiosk; role B denies update on outletCode → union allows most fields but denies outletCode", () => {
    const ability = buildUnionAbility(
      // Role A: broad update on all Kiosk fields
      (can) => {
        can("update", "Kiosk");
      },
      // Role B: explicitly deny outletCode
      (_can, cannot) => {
        cannot("update", "Kiosk", ["outletCode"]);
      },
    );

    // Non-denied field must still be allowed by the union
    expect(
      ability.can("update", { __caslSubjectType__: "Kiosk" } as unknown as Subject, "name"),
      "name should be updatable because role A grants update on all Kiosk fields",
    ).toBe(true);

    // Denied field must be blocked even though role A broadly allows it
    expect(
      ability.can("update", { __caslSubjectType__: "Kiosk" } as unknown as Subject, "outletCode"),
      "outletCode must be denied — deny-wins",
    ).toBe(false);
  });

  it("deny-wins applies across (user, role) pairs: separate role builders merged produce same deny result", () => {
    // Simulate two separate roles being merged — as would happen when a single
    // user has both roles assigned (e.g., member + custom restricted role).
    const { can: canA, cannot: _cannotA, build: buildA } = new AbilityBuilder<AppAbility>(createMongoAbility);
    const { can: _canB, cannot: cannotB, build: buildB } = new AbilityBuilder<AppAbility>(createMongoAbility);

    canA("update", "Kiosk", ["name", "address", "outletCode"]);
    cannotB("update", "Kiosk", ["outletCode"]);

    // Merge by re-building a single ability with all rules from both roles.
    const merged = buildUnionAbility(
      (can) => {
        can("update", "Kiosk", ["name", "address", "outletCode"]);
      },
      (_can, cannot) => {
        cannot("update", "Kiosk", ["outletCode"]);
      },
    );

    // name and address must be allowed (only role A touches them)
    expect(
      merged.can("update", { __caslSubjectType__: "Kiosk" } as unknown as Subject, "name"),
    ).toBe(true);
    expect(
      merged.can("update", { __caslSubjectType__: "Kiosk" } as unknown as Subject, "address"),
    ).toBe(true);

    // outletCode denied in role B wins over allow in role A
    expect(
      merged.can("update", { __caslSubjectType__: "Kiosk" } as unknown as Subject, "outletCode"),
      "deny from role B must win over allow from role A",
    ).toBe(false);
  });
});
