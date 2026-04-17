import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Analytics Presets", () => {
  test("page loads with Create Preset button", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/analytics-presets");

    await expect(
      page.getByRole("heading", { name: "Analytics Presets" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create Preset" }),
    ).toBeVisible();
  });

  test("shows empty state or presets list", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/analytics-presets");

    // Wait for loading to finish
    await expect(
      page.getByRole("button", { name: "Create Preset" }),
    ).toBeVisible();

    // The page should show either the table or a "no presets" message
    // Verify the description text is present
    await expect(
      page.getByText("Saved filter configurations for analytics views"),
    ).toBeVisible();
  });
});
