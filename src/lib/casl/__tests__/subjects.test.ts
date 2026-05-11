/**
 * Wave 0 RED scaffold — subjects.test.ts
 *
 * Tests the SUBJECT_TABLES registry and assertValidSubject guard.
 * These tests FAIL at module-load time until Plan 10-03 creates the modules.
 * Do NOT make these pass in this plan — Wave 2 is the GREEN bar.
 */
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { SUBJECT_TABLES, assertValidSubject } from "@/lib/casl/subjects";
import { type Subject } from "@/lib/casl/ability";

/** Every Subject literal declared in the AppAbility type. */
const KNOWN_SUBJECTS: Subject[] = [
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

describe("SUBJECT_TABLES registry", () => {
  it("every Subject literal has an entry in SUBJECT_TABLES", () => {
    for (const subject of KNOWN_SUBJECTS) {
      expect(
        Object.prototype.hasOwnProperty.call(SUBJECT_TABLES, subject),
        `SUBJECT_TABLES must have an entry for Subject '${subject}'`,
      ).toBe(true);
    }
  });

  it("every SUBJECT_TABLES entry resolves to a Drizzle PgTable with at least 1 column", () => {
    for (const subject of KNOWN_SUBJECTS) {
      const table = SUBJECT_TABLES[subject as keyof typeof SUBJECT_TABLES];
      expect(table, `SUBJECT_TABLES['${subject}'] must not be undefined`).toBeDefined();
      const cols = getTableColumns(table);
      const colCount = Object.keys(cols).length;
      expect(
        colCount,
        `SUBJECT_TABLES['${subject}'] must have at least 1 column via getTableColumns`,
      ).toBeGreaterThan(0);
    }
  });

  it("assertValidSubject throws for an unknown subject string", () => {
    expect(() => assertValidSubject("NotASubject")).toThrow();
    expect(() => assertValidSubject("")).toThrow();
    // Casing variants must also throw — subjects are case-sensitive
    expect(() => assertValidSubject("location")).toThrow();
    expect(() => assertValidSubject("LOCATION")).toThrow();
  });
});
