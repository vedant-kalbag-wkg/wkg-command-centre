import { describe, expect, it } from "vitest";

// Phase 8 Plan 08-02 — Contract test for the change-password form's zod schema
// (EMAIL-02). Imports THE schema from the form so a future change auto-flows
// here — no chance of drift between the form's runtime validation and the
// behaviour this test asserts.
import { changePasswordSchema as schema } from "./change-password-form";

describe("change-password form schema (EMAIL-02)", () => {
  it("rejects empty currentPassword", () => {
    const r = schema.safeParse({
      currentPassword: "",
      newPassword: "longenough",
      confirm: "longenough",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "currentPassword");
      expect(issue?.message).toBe("Current password is required");
    }
  });

  it("rejects newPassword < 8 chars", () => {
    const r = schema.safeParse({
      currentPassword: "old",
      newPassword: "short",
      confirm: "short",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const issue = r.error.issues.find((i) => i.path[0] === "newPassword");
      expect(issue?.message).toBe("Password must be at least 8 characters");
    }
  });

  it("rejects when confirm does not match newPassword", () => {
    const r = schema.safeParse({
      currentPassword: "old",
      newPassword: "longenough",
      confirm: "different1",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const confirmIssue = r.error.issues.find((i) => i.path[0] === "confirm");
      expect(confirmIssue?.message).toBe("Passwords do not match");
    }
  });

  it("accepts a valid 3-field input", () => {
    const r = schema.safeParse({
      currentPassword: "old",
      newPassword: "longenough",
      confirm: "longenough",
    });
    expect(r.success).toBe(true);
  });
});
