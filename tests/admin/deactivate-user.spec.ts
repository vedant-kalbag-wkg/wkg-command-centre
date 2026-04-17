import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../auth/setup";

test.describe("Admin deactivate user", () => {
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/users");
    await page.waitForLoadState("networkidle");
  });

  test("admin can deactivate a user", async ({ page }) => {
    // Find an active non-admin user row (one that shows "Active" status)
    const activeRows = page.locator("tr").filter({ hasText: "Active" }).filter({ hasNot: page.locator("text=admin@weknow.co") });
    const activeCount = await activeRows.count();

    if (activeCount === 0) {
      test.skip(true, "Need at least 1 active non-admin user to test deactivation — invite a user first");
      return;
    }

    // Click actions on the first active non-admin row
    const targetRow = activeRows.first();
    const actionsButton = targetRow.getByRole("button", { name: "Actions" });
    await actionsButton.click();

    // Click "Deactivate" from dropdown
    await page.getByText("Deactivate").first().click();

    // Verify confirmation dialog
    await expect(
      page.getByRole("heading", { name: "Deactivate user" })
    ).toBeVisible();
    await expect(
      page.getByText("audit history will be preserved")
    ).toBeVisible();

    // Click the destructive "Deactivate user" button to confirm
    await page.getByRole("button", { name: "Deactivate user" }).click();

    // Verify toast
    await expect(
      page.getByText("has been deactivated")
    ).toBeVisible({ timeout: 10000 });

    // Verify at least one Inactive badge is visible
    await expect(
      page.getByText("Inactive").first()
    ).toBeVisible({ timeout: 5000 });
  });
});
