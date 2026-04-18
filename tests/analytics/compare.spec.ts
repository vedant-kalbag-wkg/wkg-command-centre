import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Entity Comparison", () => {
  test("page loads and renders title", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/compare");

    await expect(
      page.getByRole("heading", { name: "Compare" }),
    ).toBeVisible();
    await expect(
      page.getByText("Side-by-side comparison of locations, hotel groups, or regions"),
    ).toBeVisible();
  });

  test("shows entity type selector with 3 options", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/compare");

    // The entity type label is visible, confirming the selector section rendered
    await expect(page.getByText("Entity type")).toBeVisible({ timeout: 15000 });

    // The selector shows Locations, Hotel Groups, Regions inside the controls
    // section. We scope to the main content area to avoid matching the global
    // filter bar which also has "Locations" / "Hotel Groups" / "Regions" buttons.
    const controls = page.locator(".space-y-4.rounded-lg.border");
    await expect(controls.getByText("Locations", { exact: true })).toBeVisible();
    await expect(controls.getByText("Hotel Groups", { exact: true })).toBeVisible();
    await expect(controls.getByText("Regions", { exact: true })).toBeVisible();
  });

  test("shows compare button", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/compare");

    await expect(
      page.getByRole("button", { name: /Compare/i }),
    ).toBeVisible({ timeout: 15000 });
  });
});
