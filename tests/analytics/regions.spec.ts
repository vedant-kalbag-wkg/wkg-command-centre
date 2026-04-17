import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Regions", () => {
  test("page loads and shows region list", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/regions?from=2025-01-01&to=2025-12-31");

    await expect(
      page.getByRole("heading", { name: "Regions" }),
    ).toBeVisible();
    await expect(
      page.getByText("Performance analysis by geographic region"),
    ).toBeVisible();

    // Wait for regions to load — Region Metrics section appears once a region auto-selects
    await expect(page.getByText("Region Metrics")).toBeVisible({
      timeout: 15000,
    });
  });

  test("clicking a region shows breakdowns", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/regions?from=2025-01-01&to=2025-12-31");

    // Wait for detail sections to render (auto-selects first region)
    await expect(page.getByText("Region Metrics")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Hotel Groups in Region")).toBeVisible();
    await expect(page.getByText("Location Groups in Region")).toBeVisible();
  });
});
