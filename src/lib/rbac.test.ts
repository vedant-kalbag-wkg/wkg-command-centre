import { describe, it, expect } from "vitest";
import {
  canAccessSensitiveFields,
  redactSensitiveFields,
  type UserCtx,
} from "./rbac";

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

const internalAdmin: UserCtx = { userType: "internal", role: "admin" };
const internalMember: UserCtx = { userType: "internal", role: "member" };
const internalViewer: UserCtx = { userType: "internal", role: "viewer" };
const externalAdmin: UserCtx = { userType: "external", role: "admin" };
const externalMember: UserCtx = { userType: "external", role: "member" };
const externalViewer: UserCtx = { userType: "external", role: "viewer" };
const externalNullRole: UserCtx = { userType: "external", role: null };

describe("canAccessSensitiveFields", () => {
  it("returns true for internal admin", () => {
    expect(canAccessSensitiveFields(internalAdmin)).toBe(true);
  });

  it("returns true for internal member", () => {
    expect(canAccessSensitiveFields(internalMember)).toBe(true);
  });

  it("returns false for internal viewer", () => {
    expect(canAccessSensitiveFields(internalViewer)).toBe(false);
  });

  it("returns false for internal user with null role", () => {
    expect(
      canAccessSensitiveFields({ userType: "internal", role: null })
    ).toBe(false);
  });

  it("returns false for external admin (invariant: external never sees sensitive)", () => {
    expect(canAccessSensitiveFields(externalAdmin)).toBe(false);
  });

  it("returns false for external member", () => {
    expect(canAccessSensitiveFields(externalMember)).toBe(false);
  });

  it("returns false for external viewer", () => {
    expect(canAccessSensitiveFields(externalViewer)).toBe(false);
  });

  it("returns false for external user with null role", () => {
    expect(canAccessSensitiveFields(externalNullRole)).toBe(false);
  });
});

describe("redactSensitiveFields", () => {
  it("internal admin: no redaction", () => {
    const result = redactSensitiveFields(sampleLocation, internalAdmin);
    expect(result).toEqual(sampleLocation);
    expect(result.bankingDetails).not.toBeNull();
    expect(result.contractValue).toBe("50000");
    expect(result.keyContactName).toBe("Jane Doe");
    expect(result.maintenanceFee).toBe("500");
  });

  it("internal member: no redaction", () => {
    const result = redactSensitiveFields(sampleLocation, internalMember);
    expect(result).toEqual(sampleLocation);
    expect(result.bankingDetails).not.toBeNull();
    expect(result.financeContact).toBe("finance@example.com");
  });

  it("internal viewer: banking + contract redacted, contacts + maintenance kept", () => {
    const result = redactSensitiveFields(sampleLocation, internalViewer);
    expect(result.bankingDetails).toBeNull();
    expect(result.contractValue).toBeNull();
    expect(result.contractTerms).toBeNull();
    expect(result.contractDocuments).toBeNull();
    // Contacts + maintenance preserved for internal viewer
    expect(result.keyContactName).toBe("Jane Doe");
    expect(result.keyContactEmail).toBe("jane@example.com");
    expect(result.financeContact).toBe("finance@example.com");
    expect(result.maintenanceFee).toBe("500");
    // Always-safe fields preserved
    expect(result.address).toBe("1 Main St");
    expect(result.starRating).toBe(4);
  });

  it("external admin: banking + contract + contacts + maintenance all redacted", () => {
    const result = redactSensitiveFields(sampleLocation, externalAdmin);
    expect(result.bankingDetails).toBeNull();
    expect(result.contractValue).toBeNull();
    expect(result.contractTerms).toBeNull();
    expect(result.contractDocuments).toBeNull();
    expect(result.keyContactName).toBeNull();
    expect(result.keyContactEmail).toBeNull();
    expect(result.financeContact).toBeNull();
    expect(result.maintenanceFee).toBeNull();
    // Always-safe fields preserved
    expect(result.address).toBe("1 Main St");
    expect(result.starRating).toBe(4);
  });

  it("external member: banking + contract + contacts + maintenance all redacted", () => {
    const result = redactSensitiveFields(sampleLocation, externalMember);
    expect(result.bankingDetails).toBeNull();
    expect(result.contractValue).toBeNull();
    expect(result.keyContactName).toBeNull();
    expect(result.maintenanceFee).toBeNull();
  });

  it("external viewer: banking + contract + contacts + maintenance all redacted", () => {
    const result = redactSensitiveFields(sampleLocation, externalViewer);
    expect(result.bankingDetails).toBeNull();
    expect(result.contractValue).toBeNull();
    expect(result.keyContactName).toBeNull();
    expect(result.financeContact).toBeNull();
    expect(result.maintenanceFee).toBeNull();
  });

  it("external user with null role: still redacts everything (invariant)", () => {
    const result = redactSensitiveFields(sampleLocation, externalNullRole);
    expect(result.bankingDetails).toBeNull();
    expect(result.contractValue).toBeNull();
    expect(result.keyContactName).toBeNull();
    expect(result.maintenanceFee).toBeNull();
  });

  it("does not mutate the input object", () => {
    const original = { ...sampleLocation };
    redactSensitiveFields(sampleLocation, externalAdmin);
    expect(sampleLocation).toEqual(original);
  });

  it("returns a new object, not the same reference, when redacting", () => {
    const result = redactSensitiveFields(sampleLocation, internalViewer);
    expect(result).not.toBe(sampleLocation);
  });

  it("returns the original reference when no redaction is needed", () => {
    const result = redactSensitiveFields(sampleLocation, internalAdmin);
    expect(result).toBe(sampleLocation);
  });

  it("ignores keys that are absent from the input", () => {
    const sparse = { id: "x", name: "Sparse" };
    const result = redactSensitiveFields(sparse, externalAdmin);
    expect(result).toEqual(sparse);
  });
});
