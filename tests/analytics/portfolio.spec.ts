import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Portfolio Overview", () => {
  test("page loads and renders title", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    await expect(
      page.getByRole("heading", { name: "Portfolio Overview" }),
    ).toBeVisible();
    await expect(
      page.getByText("Comprehensive view of sales performance"),
    ).toBeVisible();
  });

  test("with date range 2025, shows revenue data", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio?from=2025-01-01&to=2025-12-31");

    // Wait for data to load — currency values should appear
    await expect(page.getByText("£").first()).toBeVisible({ timeout: 15000 });
  });

  test("all 6 sections render", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio?from=2025-01-01&to=2025-12-31");

    await expect(page.getByText("Summary")).toBeVisible();
    await expect(page.getByText("Category Performance")).toBeVisible();
    await expect(page.getByText("Top Products")).toBeVisible();
    await expect(page.getByText("Daily Trends")).toBeVisible();
    await expect(page.getByText("Hourly Distribution")).toBeVisible();
    await expect(page.getByText("Outlet Tiers")).toBeVisible();
  });

  test("filter bar shows 5 dimension filter buttons", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    // The filter bar renders multi-select trigger buttons for each dimension.
    // Use exact match to avoid collisions with section headings (e.g. "Top Products").
    await expect(
      page.getByRole("button", { name: "Locations", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Products", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Hotel Groups", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Regions", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Location Groups", exact: true }),
    ).toBeVisible();
  });
});
