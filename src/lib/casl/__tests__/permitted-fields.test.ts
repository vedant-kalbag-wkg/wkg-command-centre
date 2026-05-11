/**
 * Wave 0 RED scaffold — permitted-fields.test.ts
 *
 * Tests permittedFieldsOf + readableFields contract.
 * These tests FAIL at module-load time until Plan 10-03 creates the modules.
 * Do NOT make these pass in this plan — Wave 2 is the GREEN bar.
 */
import { describe, it, expect } from "vitest";
import { AbilityBuilder, createMongoAbility } from "@casl/ability";
// @ts-expect-error — Wave 0 RED: @/lib/casl/fields does not exist until Plan 10-03
import { readableFields, fieldsOfSubject } from "@/lib/casl/fields";
// @ts-expect-error — Wave 0 RED: @/lib/casl/ability does not exist until Plan 10-03
import { type AppAbility, type Subject, type Action } from "@/lib/casl/ability";

/** Build a minimal ability without touching the DB. */
function buildTestAbility(
  configure: (can: AbilityBuilder<AppAbility>["can"], cannot: AbilityBuilder<AppAbility>["cannot"]) => void,
): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  configure(can, cannot);
  return build();
}

describe("readableFields", () => {
  it("no can('read', 'Location') rule → returns empty array (multiplicative zero)", () => {
    const ability = buildTestAbility((_can, _cannot) => {
      // Deliberately add no rules for Location
    });
    const fields = readableFields(ability, "Location");
    expect(fields).toEqual([]);
  });

  it("can('read', 'Location') with undefined fields → returns ALL columns from SUBJECT_TABLES", () => {
    const ability = buildTestAbility((can) => {
      // No field restriction — means all fields
      can("read", "Location");
    });
    const fields = readableFields(ability, "Location");
    // Must include at minimum the always-safe fields + the schema-defined columns
    expect(fields.length).toBeGreaterThan(0);
    expect(fields).toContain("id");
    expect(fields).toContain("name");
  });

  it("can('read', 'Location') + cannot('read', 'Location', ['bankingDetails']) → all columns minus bankingDetails", () => {
    const ability = buildTestAbility((can, cannot) => {
      can("read", "Location");
      cannot("read", "Location", ["bankingDetails"]);
    });
    const fields = readableFields(ability, "Location");
    expect(fields).not.toContain("bankingDetails");
    // Other fields must still be present
    expect(fields).toContain("id");
    expect(fields).toContain("name");
  });

  it("cannot('read', 'Location', ['contractValue', 'contractTerms']) removes those fields", () => {
    const ability = buildTestAbility((can, cannot) => {
      can("read", "Location");
      cannot("read", "Location", ["contractValue", "contractTerms"]);
    });
    const fields = readableFields(ability, "Location");
    expect(fields).not.toContain("contractValue");
    expect(fields).not.toContain("contractTerms");
  });

  it("field-level can overrides subject-level cannot for specific fields", () => {
    // Explicit allow on a single field still survives subject-wide deny
    const ability = buildTestAbility((can, cannot) => {
      cannot("read", "Location");
      can("read", "Location", ["address"]);
    });
    const fields = readableFields(ability, "Location");
    expect(fields).toContain("address");
    expect(fields).not.toContain("bankingDetails");
  });
});

describe("fieldsOfSubject", () => {
  it("returns a non-empty list of column names for every known Subject", () => {
    const knownSubjects: Subject[] = [
      "Location",
      "Kiosk",
      "User",
      "AuditLog",
      "Analytics",
      "RolePermission",
      "EmailLog",
      "LocationProduct",
      "Role",
    ];
    for (const subject of knownSubjects) {
      const cols = fieldsOfSubject(subject);
      expect(cols.length, `Subject '${subject}' must have at least 1 column`).toBeGreaterThan(0);
    }
  });

  it("returns an array of strings (not symbols or objects)", () => {
    const cols = fieldsOfSubject("Location");
    for (const col of cols) {
      expect(typeof col).toBe("string");
    }
  });
});
