import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../auth/setup";

test.describe("Admin invite user", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/users");
    // Wait for the Users heading to confirm page loaded (handles Neon cold start retries)
    await page.getByRole("heading", { name: "Users" }).waitFor({ timeout: 15000 }).catch(async () => {
      // Retry on cold start DB error
      await page.reload();
      await page.getByRole("heading", { name: "Users" }).waitFor({ timeout: 15000 });
    });
  });

  test("admin can open invite user dialog", async ({ page }) => {
    // Click the "Invite user" button (wait for it to be visible after page load)
    await page.getByRole("button", { name: "Invite user" }).waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: "Invite user" }).click();

    // Verify dialog opens with correct elements
    await expect(
      page.getByRole("heading", { name: "Invite user" })
    ).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Role")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send invite" })
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel" })
    ).toBeVisible();
  });

  test("admin can invite a new member user", async ({ page }) => {
    const testEmail = `test-member-${Date.now()}@test.com`;

    // Open invite dialog
    await page.getByRole("button", { name: "Invite user" }).click();

    // Fill email
    await page.getByLabel("Email address").fill(testEmail);

    // Select Member role (default)
    // Member should be pre-selected as default

    // Submit
    await page.getByRole("button", { name: "Send invite" }).click();

    // Verify success toast
    await expect(
      page.getByText(`Invite sent to ${testEmail}`)
    ).toBeVisible({ timeout: 10000 });

    // Verify new user appears in the table (use role to avoid matching toast)
    await expect(
      page.getByRole("cell", { name: testEmail })
    ).toBeVisible({ timeout: 5000 });
  });

  test("invite shows error for invalid email", async ({ page }) => {
    // Open invite dialog
    await page.getByRole("button", { name: "Invite user" }).click();

    // Clear email and submit with empty email
    await page.getByLabel("Email address").fill("");
    await page.getByRole("button", { name: "Send invite" }).click();

    // Verify inline validation error appears
    await expect(
      page.getByText("Please enter a valid email address")
    ).toBeVisible({ timeout: 5000 });
  });
});
