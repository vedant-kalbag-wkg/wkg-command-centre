import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock out deps that require env / network before importing the module.
vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => [{ name: "Test Hotel" }]) })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    })),
  },
}));

const mockSession = {
  user: { id: "u1", name: "Admin", role: "admin", userType: "internal" },
};

const requireRole = vi.fn(async () => mockSession);

vi.mock("@/lib/rbac", () => ({
  requireRole: () => requireRole(),
  redactSensitiveFields: (x: unknown) => x,
}));

vi.mock("@/lib/audit", () => ({
  writeAuditLog: vi.fn(async () => undefined),
}));

// AWS SDK is imported at top of actions.ts — stub it so the import succeeds in
// a vitest node env with no AWS env vars set.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {},
  PutObjectCommand: class {},
}));
vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async () => "https://example.com/signed",
}));

import { updateLocationField } from "./actions";

describe("updateLocationField", () => {
  beforeEach(() => {
    requireRole.mockClear();
    requireRole.mockImplementation(async () => mockSession);
  });

  it("rejects an unknown field", async () => {
    const result = await updateLocationField("loc-1", "notARealField", "x");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/Invalid field/i);
    }
  });

  it("rejects attempts to write system columns", async () => {
    for (const field of ["id", "createdAt", "updatedAt", "archivedAt"]) {
      const result = await updateLocationField("loc-1", field, "x");
      expect("error" in result).toBe(true);
    }
  });

  it("rejects the bankingDetails JSON field through this action", async () => {
    // Banking goes through updateBankingDetails, not the generic field update.
    const result = await updateLocationField(
      "loc-1",
      "bankingDetails",
      '{"accountNumber":"123"}'
    );
    expect("error" in result).toBe(true);
  });

  it("accepts whitelisted fields (name, status, internalPocId)", async () => {
    const okFields: Array<[string, string | null]> = [
      ["name", "New Name"],
      ["status", "active"],
      ["internalPocId", "user-123"],
      ["internalPocId", null],
      ["roomCount", "120"],
      ["starRating", "5"],
      ["address", "1 High St"],
      ["region", "EMEA"],
      ["locationGroup", "Flagship"],
    ];
    for (const [field, value] of okFields) {
      const result = await updateLocationField("loc-1", field, value);
      expect("success" in result && result.success === true).toBe(true);
    }
  });

  it("rejects callers that requireRole rejects (non-admin/non-member)", async () => {
    requireRole.mockImplementationOnce(async () => {
      throw new Error("Forbidden");
    });
    const result = await updateLocationField("loc-1", "name", "x");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toMatch(/Forbidden/i);
    }
  });
});
