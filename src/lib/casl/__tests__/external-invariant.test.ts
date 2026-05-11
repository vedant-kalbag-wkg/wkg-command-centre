/**
 * Wave 0 RED scaffold — external-invariant.test.ts
 *
 * Tests that applyExternalUserInvariant strips sensitive fields for external users
 * unconditionally, even when explicit can() rules grant those fields.
 * These tests FAIL at module-load time until Plan 10-03 creates the modules.
 * Do NOT make these pass in this plan — Wave 2 is the GREEN bar.
 */
import { describe, it, expect } from "vitest";
import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import { applyExternalUserInvariant } from "@/lib/casl/external-invariant";
import { type AppAbility, type Subject, type Action } from "@/lib/casl/ability";

/** Sensitive fields that external users MUST NEVER access regardless of rules. */
const ALWAYS_SENSITIVE_FIELDS = [
  "bankingDetails",
  "contractValue",
  "contractTerms",
  "contractDocuments",
  "keyContactName",
  "keyContactEmail",
  "financeContact",
  "maintenanceFee",
] as const;

/** Build ability for an external user who has been explicitly granted access to ALL fields. */
function buildExternalAbilityWithExplicitAllFields(): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  // Explicitly allow ALL fields — invariant must override this
  can("read", "Location", [
    "bankingDetails",
    "contractValue",
    "contractTerms",
    "contractDocuments",
    "keyContactName",
    "keyContactEmail",
    "financeContact",
    "maintenanceFee",
    "address",
    "id",
    "name",
  ]);
  return build();
}

describe("applyExternalUserInvariant", () => {
  it("external user: cannot read bankingDetails even with explicit allow rule", () => {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    can("read", "Location", ["bankingDetails", "address"]);
    applyExternalUserInvariant({ can, cannot } as unknown as AbilityBuilder<AppAbility>, "external");
    const ability = build();
    expect(
      ability.can("read", { __caslSubjectType__: "Location" } as unknown as Subject, "bankingDetails"),
    ).toBe(false);
  });

  it.each(ALWAYS_SENSITIVE_FIELDS)(
    "external user: cannot read sensitive field '%s' after applyExternalUserInvariant",
    (field) => {
      const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
      // Grant the field explicitly
      can("read", "Location", [field]);
      applyExternalUserInvariant({ can, cannot } as unknown as AbilityBuilder<AppAbility>, "external");
      const ability = build();
      expect(
        ability.can("read", { __caslSubjectType__: "Location" } as unknown as Subject, field),
        `Field '${field}' must be blocked for external users`,
      ).toBe(false);
    },
  );

  it("internal user: NOT affected by applyExternalUserInvariant — sensitive fields still readable", () => {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    can("read", "Location", ["bankingDetails", "contractValue"]);
    // Applying invariant for internal — must be a no-op
    applyExternalUserInvariant({ can, cannot } as unknown as AbilityBuilder<AppAbility>, "internal");
    const ability = build();
    expect(
      ability.can("read", { __caslSubjectType__: "Location" } as unknown as Subject, "bankingDetails"),
    ).toBe(true);
  });

  it("system user: NOT affected by applyExternalUserInvariant", () => {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    can("read", "Location", ["bankingDetails"]);
    applyExternalUserInvariant({ can, cannot } as unknown as AbilityBuilder<AppAbility>, "system");
    const ability = build();
    expect(
      ability.can("read", { __caslSubjectType__: "Location" } as unknown as Subject, "bankingDetails"),
    ).toBe(true);
  });

  it("null userType: treated as external — invariant applies", () => {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    can("read", "Location", ["bankingDetails", "address"]);
    applyExternalUserInvariant({ can, cannot } as unknown as AbilityBuilder<AppAbility>, null);
    const ability = build();
    expect(
      ability.can("read", { __caslSubjectType__: "Location" } as unknown as Subject, "bankingDetails"),
    ).toBe(false);
    // always-safe fields must not be blocked
    expect(
      ability.can("read", { __caslSubjectType__: "Location" } as unknown as Subject, "address"),
    ).toBe(true);
  });

  it("always-safe fields ('address', 'id', 'name') remain readable for external users after invariant", () => {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    can("read", "Location"); // broad allow, then invariant strips specific fields
    applyExternalUserInvariant({ can, cannot } as unknown as AbilityBuilder<AppAbility>, "external");
    const ability = build();
    // Non-sensitive fields must NOT be blocked by the invariant
    expect(
      ability.can("read", { __caslSubjectType__: "Location" } as unknown as Subject, "address"),
    ).toBe(true);
    expect(
      ability.can("read", { __caslSubjectType__: "Location" } as unknown as Subject, "id"),
    ).toBe(true);
  });
});
