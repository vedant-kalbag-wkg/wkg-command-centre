import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../auth/setup";

test.describe("Admin change user role", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/users");
    await page.waitForLoadState("networkidle");
  });

  test("admin can change a user's role", async ({ page }) => {
    // Find a non-admin user row — look for the actions dropdown
    const userRows = page.locator("tr").filter({ hasText: "@" });
    const rowCount = await userRows.count();

    // Skip if there is only the admin user (no other users to change role for)
    if (rowCount <= 1) {
      test.skip(true, "Need at least 2 users to test role change — invite a user first");
      return;
    }

    // Find first non-admin row with an actions button
    const targetRow = userRows.nth(1);
    const actionsButton = targetRow.getByRole("button", { name: "Actions" });
    await actionsButton.click();

    // Click "Change role" from dropdown
    await page.getByText("Change role").click();

    // Verify confirmation dialog
    await expect(
      page.getByRole("heading", { name: "Change role" })
    ).toBeVisible();
    await expect(
      page.getByText("permissions immediately")
    ).toBeVisible();

    // Select a new role and confirm
    await page.getByRole("button", { name: "Change role" }).last().click();

    // Verify toast with role updated message
    await expect(
      page.getByText("role updated to")
    ).toBeVisible({ timeout: 10000 });
  });
});
