import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../auth/setup";

test.describe("Admin manage user scopes", () => {
  test.describe.configure({ retries: 1 });

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/users");
    await page.waitForLoadState("networkidle");
  });

  async function openManageScopesForFirstNonAdminRow(page: import("@playwright/test").Page) {
    const userRows = page.locator("tr").filter({ hasText: "@" });
    const rowCount = await userRows.count();
    if (rowCount <= 1) {
      test.skip(true, "Need at least 2 users to test manage scopes — invite a user first");
      return null;
    }

    const targetRow = userRows.nth(1);
    const actionsButton = targetRow.getByRole("button", { name: "Actions" });
    await actionsButton.click();
    await page.getByRole("menuitem", { name: "Manage scopes" }).click();
    await expect(
      page.getByRole("heading", { name: "Manage scopes" })
    ).toBeVisible();
    return targetRow;
  }

  test("admin can open Manage scopes dialog from a user row", async ({ page }) => {
    const row = await openManageScopesForFirstNonAdminRow(page);
    if (!row) return;

    // Either there are existing scope rows OR we see the empty state
    const emptyState = page.getByText("No scopes yet");
    const dimensionTypeHeader = page.getByRole("columnheader", {
      name: "Dimension type",
    });
    await expect(emptyState.or(dimensionTypeHeader)).toBeVisible();
  });

  test("admin can add a scope", async ({ page }) => {
    const row = await openManageScopesForFirstNonAdminRow(page);
    if (!row) return;

    const uniqueId = `e2e-add-${Date.now()}`;
    await page.getByLabel("Dimension ID").fill(uniqueId);
    await page.getByRole("button", { name: "Add" }).click();

    await expect(page.getByText("Scope added")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(uniqueId)).toBeVisible({ timeout: 5000 });
  });

  test("admin can remove a scope", async ({ page }) => {
    const row = await openManageScopesForFirstNonAdminRow(page);
    if (!row) return;

    // Add a scope first so we can remove it without tripping the
    // external-user invariant on whatever rows already exist.
    const uniqueId = `e2e-remove-${Date.now()}`;
    await page.getByLabel("Dimension ID").fill(uniqueId);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Scope added")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(uniqueId)).toBeVisible({ timeout: 5000 });

    // Now remove the scope we just added
    const removeButton = page.getByRole("button", {
      name: new RegExp(`Remove scope .*:${uniqueId}`),
    });
    await removeButton.click();

    await expect(page.getByText("Scope removed")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(uniqueId)).not.toBeVisible();
  });
});
