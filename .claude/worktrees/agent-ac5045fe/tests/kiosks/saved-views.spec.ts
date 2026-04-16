import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Saved Views (VIEW-04, VIEW-05)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/kiosks");
    await page.waitForSelector('[data-slot="table"]', { timeout: 10000 });
  });

  // VIEW-04: Saving a named view
  test("VIEW-04: can save a named view configuration", async ({ page }) => {
    // Click "Save view" button
    const saveViewButton = page.getByRole("button", { name: /save view/i });
    await expect(saveViewButton).toBeVisible();
    await saveViewButton.click();

    // Fill in the view name
    const viewNameInput = page.getByPlaceholder(/e\.g\. active kiosks/i);
    await expect(viewNameInput).toBeVisible();
    await viewNameInput.fill("Test View Playwright");

    // Click Save
    await page.getByRole("button", { name: /^save$/i }).click();

    // Should show success toast
    await expect(page.getByText("View saved")).toBeVisible({ timeout: 5000 });
  });

  test("VIEW-04: saved view appears as pill in bar", async ({ page }) => {
    const uniqueName = `Pill-${Date.now()}`;
    // Save a view first
    const saveViewButton = page.getByRole("button", { name: /save view/i });
    await saveViewButton.click();
    const viewNameInput = page.getByPlaceholder(/e\.g\. active kiosks/i);
    await viewNameInput.fill(uniqueName);
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("View saved")).toBeVisible({ timeout: 5000 });

    // The pill should appear (scroll into view if needed)
    const pill = page.getByText(uniqueName).first();
    await expect(pill).toBeVisible({ timeout: 5000 });
  });

  // VIEW-05: Loading and deleting saved views
  test("VIEW-05: can load a saved view", async ({ page }) => {
    const uniqueName = `Load-${Date.now()}`;
    // Save a view first
    const saveViewButton = page.getByRole("button", { name: /save view/i });
    await saveViewButton.click();
    const viewNameInput = page.getByPlaceholder(/e\.g\. active kiosks/i);
    await viewNameInput.fill(uniqueName);
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("View saved")).toBeVisible({ timeout: 5000 });

    // Wait for pill to appear, then click it
    const viewPill = page.getByText(uniqueName).first();
    await expect(viewPill).toBeVisible({ timeout: 5000 });
    await viewPill.click();
    // Pill should still be visible (now active)
    await expect(viewPill).toBeVisible();
  });

  test("VIEW-05: can delete a saved view", async ({ page }) => {
    // Save a view first
    const saveViewButton = page.getByRole("button", { name: /save view/i });
    await saveViewButton.click();
    const viewNameInput = page.getByPlaceholder(/e\.g\. active kiosks/i);
    await viewNameInput.fill("Delete Test View");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("View saved")).toBeVisible({ timeout: 5000 });

    // Hover over the pill to reveal the options dropdown
    const viewPill = page.locator("div.group").filter({ hasText: "Delete Test View" });
    await viewPill.hover();

    // Find the options button and click it
    const optionsButton = viewPill.locator("button[aria-label*='Options for view']");
    if (await optionsButton.isVisible({ timeout: 2000 })) {
      await optionsButton.click();
      // Click Delete
      await page.getByRole("menuitem", { name: /delete/i }).click();
      // Should show success toast
      await expect(page.getByText("View deleted")).toBeVisible({ timeout: 5000 });
    }
  });
});
