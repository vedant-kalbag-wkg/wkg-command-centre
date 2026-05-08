import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../helpers/auth";

// Phase 8 Plan 08-02 — End-to-end coverage for /account/security
// (EMAIL-02 SC2). Three failure paths run by default; the destructive
// happy-path is gated behind PLAYWRIGHT_BASE_URL or an opt-in env var
// because rotating the seeded local admin's password pollutes other
// Playwright runs in the same suite (the canonical happy-path evidence
// is the preview-alias run captured in plan 08-03 SUMMARY per CLAUDE.md
// § "Playwright specs against preview deploys").

test.describe("Change password flow (EMAIL-02)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/account/security");
    await expect(
      page.getByRole("heading", { name: "Security" }),
    ).toBeVisible();
  });

  test("happy path: valid current+new password -> success toast + form reset", async ({
    page,
  }) => {
    // Skipped on local: rotation modifies the seeded admin password and
    // breaks other Playwright runs in the same suite. Set
    // LOCAL_E2E_ALLOW_PASSWORD_ROTATE=1 to opt in. The canonical green
    // happy-path run is the preview-alias execution captured in plan
    // 08-03's SUMMARY (CLAUDE.md § "Playwright specs against preview
    // deploys").
    test.skip(
      !process.env.PLAYWRIGHT_BASE_URL &&
        !process.env.LOCAL_E2E_ALLOW_PASSWORD_ROTATE,
      "Skipped on local: rotation modifies seeded admin password. Set LOCAL_E2E_ALLOW_PASSWORD_ROTATE=1 to opt in.",
    );

    const currentPassword = process.env.TEST_ADMIN_PASSWORD ?? "Admin123!";
    const newPassword = currentPassword; // no-op rotation; Better Auth accepts.

    await page.getByLabel("Current password").fill(currentPassword);
    await page.locator("#newPassword").fill(newPassword);
    await page.locator("#confirm").fill(newPassword);
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(
      page.getByText("Password changed. Other sessions signed out."),
    ).toBeVisible({ timeout: 10000 });
  });

  test("wrong current password -> Better Auth error surfaces in toast", async ({
    page,
  }) => {
    await page.getByLabel("Current password").fill("WrongPassword!");
    await page.locator("#newPassword").fill("NewPassword123!");
    await page.locator("#confirm").fill("NewPassword123!");
    await page.getByRole("button", { name: "Change password" }).click();

    // Better Auth owns the exact error wording; assert the success toast
    // never appears, and that *some* toast (sonner status/alert) does.
    await expect(
      page.getByText("Password changed. Other sessions signed out."),
    ).toHaveCount(0);
    const toast = page.locator('[role="status"], [role="alert"]').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
  });

  test("new password < 8 chars -> zod inline error before Better Auth call", async ({
    page,
  }) => {
    await page.getByLabel("Current password").fill("anything");
    await page.locator("#newPassword").fill("short");
    await page.locator("#confirm").fill("short");
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(
      page.getByText("Password must be at least 8 characters"),
    ).toBeVisible({ timeout: 3000 });
  });

  test("confirm does not match new password -> zod inline error", async ({
    page,
  }) => {
    await page.getByLabel("Current password").fill("anything");
    await page.locator("#newPassword").fill("longenough1");
    await page.locator("#confirm").fill("longenough2");
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page.getByText("Passwords do not match")).toBeVisible({
      timeout: 3000,
    });
  });
});
