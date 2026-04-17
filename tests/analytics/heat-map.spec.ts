import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Performance Heat Map", () => {
  test("page loads with score legend", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/heat-map");

    await expect(
      page.getByRole("heading", { name: "Performance Heat Map" }),
    ).toBeVisible();
    await expect(page.getByText("Score Weights")).toBeVisible();
  });

  test("with date range 2025, shows hotel performance data", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/heat-map?from=2025-01-01&to=2025-12-31");

    // Wait for performance data to load — "Top 20 Performers" text appears
    await expect(page.getByText("Top 20 Performers")).toBeVisible({
      timeout: 15000,
    });
  });

  test("Top 20 / Bottom 20 / All tabs work", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/heat-map?from=2025-01-01&to=2025-12-31");

    // All three tab triggers should be visible
    await expect(page.getByRole("tab", { name: "Top 20" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Bottom 20" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "All" })).toBeVisible();

    // Click Bottom 20 tab
    await page.getByRole("tab", { name: "Bottom 20" }).click();
    await expect(page.getByText("Bottom 20 Performers")).toBeVisible({
      timeout: 10000,
    });

    // Click All tab
    await page.getByRole("tab", { name: "All" }).click();
    await expect(page.getByText("All Hotels")).toBeVisible({
      timeout: 10000,
    });
  });

  test("table has expected columns", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/heat-map?from=2025-01-01&to=2025-12-31");

    // Wait for table to render
    await expect(page.getByText("Top 20 Performers")).toBeVisible({
      timeout: 15000,
    });

    // Check column headers
    await expect(
      page.getByRole("columnheader", { name: "Rank" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Hotel" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Revenue" }),
    ).toBeVisible();
  });
});
