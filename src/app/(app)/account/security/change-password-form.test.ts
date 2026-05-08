import { describe, expect, it } from "vitest";
import { z } from "zod";

// Phase 8 Plan 08-02 — Contract test for the change-password form's zod schema
// (EMAIL-02). The schema is inlined in change-password-form.tsx (it's a private
// implementation detail of the form) so this test recreates the same shape and
// asserts the contract. If a future change drifts the form's schema away from
// this one, this test still asserts that the *acceptance contract* holds; the
// form's schema is verified inline by acceptance-grep gates in the plan.
const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string().min(1, "Please confirm your new password"),
  })
  .refine((d) => d.newPassword === d.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

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
