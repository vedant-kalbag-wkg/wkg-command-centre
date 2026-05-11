/**
 * Wave 0 RED scaffold — seed.test.ts
 *
 * REGRESSION BAR: Every assertion from src/lib/rbac.test.ts is ported 1:1.
 * The new approach replaces `redactSensitiveFields(data, userCtx)` with:
 *   buildSeededAbility(role, userType) → AppAbility
 *   readableFields(ability, "Location") → string[]
 *   pickFields(sampleLocation, fields) → partial object
 *
 * These tests FAIL at module-load time until Plan 10-03 creates @/lib/casl/seed.
 * Do NOT make these pass in this plan — Wave 2 is the GREEN bar.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — Wave 0 RED: @/lib/casl/fields does not exist until Plan 10-03
import { readableFields } from "@/lib/casl/fields";
// @ts-expect-error — Wave 0 RED: @/lib/casl/seed does not exist until Plan 10-03
import { buildSeededAbility } from "@/lib/casl/seed";

// ---------------------------------------------------------------------------
// Fixtures — mirrors src/lib/rbac.test.ts exactly
// ---------------------------------------------------------------------------

const sampleLocation = {
  id: "loc-1",
  name: "Test Hotel",
  // Always-sensitive (banking + contract)
  bankingDetails: { accountNumber: "12345678", sortCode: "11-22-33" },
  contractValue: "50000",
  contractTerms: "Net 30",
  contractDocuments: [{ fileName: "x.pdf", s3Key: "k", uploadedAt: "n" }],
  // External-only sensitive (contacts + maintenance)
  keyContactName: "Jane Doe",
  keyContactEmail: "jane@example.com",
  financeContact: "finance@example.com",
  maintenanceFee: "500",
  // Always-safe
  address: "1 Main St",
  starRating: 4,
};

type UserType = "internal" | "external";
type Role = "admin" | "member" | "viewer" | null;

/** Pick only the keys included in the readable fields; null-out excluded keys. */
function pickFields(
  obj: Record<string, unknown>,
  allowedFields: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    result[key] = allowedFields.includes(key) ? obj[key] : null;
  }
  return result;
}

/** Legacy-shape helper to mirror the old redactSensitiveFields return type for comparison. */
function legacyRedact(
  obj: typeof sampleLocation,
  ctx: { userType: UserType; role: Role },
): Record<string, unknown> {
  // This is the expected behaviour encoded inline — NOT importing rbac.ts.
  // The output must match what buildSeededAbility + readableFields produces.
  const isInternal = ctx.userType === "internal";
  const canSeeBankingContract = isInternal && (ctx.role === "admin" || ctx.role === "member");
  const canSeeExternalOnly = isInternal; // external users never see contacts/maintenance

  const result: Record<string, unknown> = { ...obj };
  if (!canSeeBankingContract) {
    result.bankingDetails = null;
    result.contractValue = null;
    result.contractTerms = null;
    result.contractDocuments = null;
  }
  if (!canSeeExternalOnly) {
    result.keyContactName = null;
    result.keyContactEmail = null;
    result.financeContact = null;
    result.maintenanceFee = null;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tests — ported 1:1 from src/lib/rbac.test.ts
// ---------------------------------------------------------------------------

describe("buildSeededAbility + readableFields (regression bar against rbac.test.ts)", () => {
  // --- canAccessSensitiveFields equivalent (via ability) ---

  it("internal admin: can read all fields including sensitive", () => {
    const ability = buildSeededAbility("admin", "internal");
    const fields = readableFields(ability, "Location");
    expect(fields).toContain("bankingDetails");
    expect(fields).toContain("contractValue");
    expect(fields).toContain("keyContactName");
    expect(fields).toContain("maintenanceFee");
  });

  it("internal member: can read all fields including sensitive", () => {
    const ability = buildSeededAbility("member", "internal");
    const fields = readableFields(ability, "Location");
    expect(fields).toContain("bankingDetails");
    expect(fields).toContain("financeContact");
  });

  it("internal viewer: cannot read banking/contract fields", () => {
    const ability = buildSeededAbility("viewer", "internal");
    const fields = readableFields(ability, "Location");
    expect(fields).not.toContain("bankingDetails");
    expect(fields).not.toContain("contractValue");
    expect(fields).not.toContain("contractTerms");
    expect(fields).not.toContain("contractDocuments");
  });

  it("internal viewer: can still read contact/maintenance fields", () => {
    const ability = buildSeededAbility("viewer", "internal");
    const fields = readableFields(ability, "Location");
    expect(fields).toContain("keyContactName");
    expect(fields).toContain("keyContactEmail");
    expect(fields).toContain("financeContact");
    expect(fields).toContain("maintenanceFee");
  });

  it("external admin: invariant — cannot read any sensitive fields", () => {
    const ability = buildSeededAbility("admin", "external");
    const fields = readableFields(ability, "Location");
    expect(fields).not.toContain("bankingDetails");
    expect(fields).not.toContain("contractValue");
    expect(fields).not.toContain("keyContactName");
    expect(fields).not.toContain("maintenanceFee");
  });

  it("external member: invariant — cannot read any sensitive fields", () => {
    const ability = buildSeededAbility("member", "external");
    const fields = readableFields(ability, "Location");
    expect(fields).not.toContain("bankingDetails");
    expect(fields).not.toContain("contractValue");
    expect(fields).not.toContain("keyContactName");
    expect(fields).not.toContain("maintenanceFee");
  });

  it("external viewer: invariant — cannot read any sensitive fields", () => {
    const ability = buildSeededAbility("viewer", "external");
    const fields = readableFields(ability, "Location");
    expect(fields).not.toContain("bankingDetails");
    expect(fields).not.toContain("contractValue");
    expect(fields).not.toContain("keyContactName");
    expect(fields).not.toContain("financeContact");
    expect(fields).not.toContain("maintenanceFee");
  });

  it("external null role: invariant still applies — all sensitive fields absent", () => {
    const ability = buildSeededAbility(null, "external");
    const fields = readableFields(ability, "Location");
    expect(fields).not.toContain("bankingDetails");
    expect(fields).not.toContain("contractValue");
    expect(fields).not.toContain("keyContactName");
    expect(fields).not.toContain("maintenanceFee");
  });

  // --- redactSensitiveFields equivalent (via pickFields) ---

  it("internal admin: pickFields = no redaction (matches legacy output)", () => {
    const ability = buildSeededAbility("admin", "internal");
    const fields = readableFields(ability, "Location");
    const result = pickFields(sampleLocation as Record<string, unknown>, fields);
    const expected = legacyRedact(sampleLocation, { userType: "internal", role: "admin" });
    expect(result.bankingDetails).not.toBeNull();
    expect(result.contractValue).toBe("50000");
    expect(result.keyContactName).toBe("Jane Doe");
    expect(result.maintenanceFee).toBe("500");
    expect(result).toEqual(expected);
  });

  it("internal member: pickFields = no redaction (matches legacy output)", () => {
    const ability = buildSeededAbility("member", "internal");
    const fields = readableFields(ability, "Location");
    const result = pickFields(sampleLocation as Record<string, unknown>, fields);
    const expected = legacyRedact(sampleLocation, { userType: "internal", role: "member" });
    expect(result.bankingDetails).not.toBeNull();
    expect(result.financeContact).toBe("finance@example.com");
    expect(result).toEqual(expected);
  });

  it("internal viewer: banking+contract redacted, contacts+maintenance kept (matches legacy output)", () => {
    const ability = buildSeededAbility("viewer", "internal");
    const fields = readableFields(ability, "Location");
    const result = pickFields(sampleLocation as Record<string, unknown>, fields);
    const expected = legacyRedact(sampleLocation, { userType: "internal", role: "viewer" });
    expect(result.bankingDetails).toBeNull();
    expect(result.contractValue).toBeNull();
    expect(result.contractTerms).toBeNull();
    expect(result.contractDocuments).toBeNull();
    expect(result.keyContactName).toBe("Jane Doe");
    expect(result.keyContactEmail).toBe("jane@example.com");
    expect(result.financeContact).toBe("finance@example.com");
    expect(result.maintenanceFee).toBe("500");
    expect(result.address).toBe("1 Main St");
    expect(result.starRating).toBe(4);
    expect(result).toEqual(expected);
  });

  it("external admin: all sensitive fields redacted (matches legacy output)", () => {
    const ability = buildSeededAbility("admin", "external");
    const fields = readableFields(ability, "Location");
    const result = pickFields(sampleLocation as Record<string, unknown>, fields);
    const expected = legacyRedact(sampleLocation, { userType: "external", role: "admin" });
    expect(result.bankingDetails).toBeNull();
    expect(result.contractValue).toBeNull();
    expect(result.contractTerms).toBeNull();
    expect(result.contractDocuments).toBeNull();
    expect(result.keyContactName).toBeNull();
    expect(result.keyContactEmail).toBeNull();
    expect(result.financeContact).toBeNull();
    expect(result.maintenanceFee).toBeNull();
    expect(result.address).toBe("1 Main St");
    expect(result.starRating).toBe(4);
    expect(result).toEqual(expected);
  });

  it("external member: all sensitive fields redacted (matches legacy output)", () => {
    const ability = buildSeededAbility("member", "external");
    const fields = readableFields(ability, "Location");
    const result = pickFields(sampleLocation as Record<string, unknown>, fields);
    const expected = legacyRedact(sampleLocation, { userType: "external", role: "member" });
    expect(result.bankingDetails).toBeNull();
    expect(result.contractValue).toBeNull();
    expect(result.keyContactName).toBeNull();
    expect(result.maintenanceFee).toBeNull();
    expect(result).toEqual(expected);
  });

  it("external viewer: all sensitive fields redacted (matches legacy output)", () => {
    const ability = buildSeededAbility("viewer", "external");
    const fields = readableFields(ability, "Location");
    const result = pickFields(sampleLocation as Record<string, unknown>, fields);
    const expected = legacyRedact(sampleLocation, { userType: "external", role: "viewer" });
    expect(result.bankingDetails).toBeNull();
    expect(result.contractValue).toBeNull();
    expect(result.keyContactName).toBeNull();
    expect(result.financeContact).toBeNull();
    expect(result.maintenanceFee).toBeNull();
    expect(result).toEqual(expected);
  });

  it("external null role: invariant still redacts all sensitive (matches legacy output)", () => {
    const ability = buildSeededAbility(null, "external");
    const fields = readableFields(ability, "Location");
    const result = pickFields(sampleLocation as Record<string, unknown>, fields);
    const expected = legacyRedact(sampleLocation, { userType: "external", role: null });
    expect(result.bankingDetails).toBeNull();
    expect(result.contractValue).toBeNull();
    expect(result.keyContactName).toBeNull();
    expect(result.maintenanceFee).toBeNull();
    expect(result).toEqual(expected);
  });

  it("sparse input: pickFields on object missing sensitive keys returns object unchanged", () => {
    const sparse = { id: "x", name: "Sparse" } as unknown as typeof sampleLocation;
    const ability = buildSeededAbility("admin", "external");
    const fields = readableFields(ability, "Location");
    const result = pickFields(sparse as unknown as Record<string, unknown>, fields);
    // sparse has no sensitive keys — nothing to null out
    expect(result.id).toBe("x");
    expect(result.name).toBe("Sparse");
  });

  it("always-safe fields preserved regardless of role", () => {
    for (const [role, userType] of [
      ["admin", "internal"] as const,
      ["viewer", "internal"] as const,
      ["viewer", "external"] as const,
    ]) {
      const ability = buildSeededAbility(role, userType);
      const fields = readableFields(ability, "Location");
      const result = pickFields(sampleLocation as Record<string, unknown>, fields);
      expect(result.address).toBe("1 Main St");
      expect(result.starRating).toBe(4);
    }
  });
});
