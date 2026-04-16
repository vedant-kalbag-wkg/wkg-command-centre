import { test, expect } from "@playwright/test";

test.describe("Password reset flow", () => {
  test("reset password form renders with email input", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(
      page.getByRole("heading", { name: "Reset your password" })
    ).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send reset link" })
    ).toBeVisible();
    await expect(page.getByText("Back to sign in")).toBeVisible();
  });

  test("shows confirmation message after submitting email", async ({
    page,
  }) => {
    await page.goto("/reset-password");
    await page.getByLabel("Email address").fill("admin@weknow.co");
    await page.getByRole("button", { name: "Send reset link" }).click();

    // Should show success confirmation (even if email delivery fails,
    // Better Auth returns success to prevent email enumeration)
    await expect(page.getByText("Check your inbox")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText("admin@weknow.co")).toBeVisible();
  });

  test("set-password page renders with password fields", async ({ page }) => {
    // Navigate to set-password page (normally reached via email link with token)
    await page.goto("/set-password?token=test-token");
    await expect(page.getByText("Set your password")).toBeVisible();
    await expect(page.getByLabel("New password")).toBeVisible();
    await expect(page.getByLabel("Confirm password")).toBeVisible();
    await expect(page.getByText("At least 8 characters")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Set password" })
    ).toBeVisible();
  });
});
