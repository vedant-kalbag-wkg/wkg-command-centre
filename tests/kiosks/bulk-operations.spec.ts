import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Bulk Operations (BULK-01, BULK-02)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // BULK-01: Bulk toolbar appears when rows are selected
  test("BULK-01: selecting rows shows bulk toolbar", async ({ page }) => {
    await page.goto("/kiosks");
    // Wait for table to load
    await page.waitForSelector("table", { timeout: 10000 });

    // Check if there are any rows to select
    const checkboxes = page.locator("td").getByRole("checkbox");
    const count = await checkboxes.count();
    if (count === 0) {
      test.skip();
      return;
    }

    // Toolbar should not be visible initially
    const toolbar = page.locator("text=selected").first();

    // Select first row
    await checkboxes.first().check();

    // Bulk toolbar should slide up and show count
    await expect(toolbar).toBeVisible({ timeout: 3000 });
    await expect(page.locator("text=1 selected")).toBeVisible();
  });

  test("BULK-01: can bulk archive selected records", async ({ page }) => {
    await page.goto("/kiosks");
    await page.waitForSelector("table", { timeout: 10000 });

    const checkboxes = page.locator("td").getByRole("checkbox");
    const count = await checkboxes.count();
    if (count === 0) {
      test.skip();
      return;
    }

    // Select a row
    await checkboxes.first().check();
    await expect(page.locator("text=1 selected")).toBeVisible({ timeout: 3000 });

    // Click Archive button in the toolbar
    await page.locator("text=Archive").last().click();

    // Should show confirmation dialog with "Archive 1 records?"
    await expect(page.locator("text=Archive 1 records?")).toBeVisible({ timeout: 3000 });

    // Cancel to avoid actually archiving
    await page.getByRole("button", { name: "Cancel" }).last().click();
    await expect(page.locator("text=Archive 1 records?")).not.toBeVisible();
  });

  // BULK-02: Export CSV
  test("BULK-02: toolbar has Export CSV button", async ({ page }) => {
    await page.goto("/kiosks");
    await page.waitForSelector("table", { timeout: 10000 });

    const checkboxes = page.locator("td").getByRole("checkbox");
    const count = await checkboxes.count();
    if (count === 0) {
      test.skip();
      return;
    }

    // Select a row to show the bulk toolbar
    await checkboxes.first().check();
    await expect(page.locator("text=1 selected")).toBeVisible({ timeout: 3000 });

    // Export CSV button should be visible in the bulk toolbar
    const exportBtn = page.locator("[aria-hidden=false]").locator("text=Export CSV");
    await expect(exportBtn).toBeVisible({ timeout: 3000 });
  });

  test("BULK-02: view toolbar Export CSV is enabled", async ({ page }) => {
    await page.goto("/kiosks");
    await page.waitForSelector("table", { timeout: 10000 });

    // The Export CSV button in the view toolbar should be enabled (not disabled)
    // It's the first Export CSV button (in toolbar, not bulk bar)
    const exportBtn = page.getByRole("button", { name: "Export CSV" }).first();
    await expect(exportBtn).toBeEnabled({ timeout: 5000 });
  });
});
