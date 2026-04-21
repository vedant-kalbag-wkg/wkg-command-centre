import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Analytics Filter Enhancements", () => {
  test("maturity filter appears in filter bar", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    await expect(
      page.getByRole("button", { name: "Maturity", exact: true }),
    ).toBeVisible();
  });

  test("portfolio shows MoM/YoY toggle", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio?from=2025-01-01&to=2025-12-31");

    await expect(
      page.getByRole("button", { name: "MoM" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "YoY" }),
    ).toBeVisible();
  });

  test("trend builder shows rolling average selector", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/trend-builder");

    await expect(page.getByRole("button", { name: "Raw" })).toBeVisible();
    await expect(page.getByRole("button", { name: "7d Avg" })).toBeVisible();
    await expect(page.getByRole("button", { name: "30d Avg" })).toBeVisible();
  });

  test("trend builder shows YoY overlay toggle", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/trend-builder");

    await expect(
      page.getByRole("switch", { name: "YoY Overlay" }),
    ).toBeVisible();
  });

  test("heat map shows traffic light status column when data is present", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/heat-map?from=2025-01-01&to=2025-12-31");

    // Wait for page to settle — performance table only renders column headers
    // when there is data. If no data, an empty state message appears instead.
    const statusColumn = page.getByRole("columnheader", { name: "Status" });
    const emptyState = page.getByText(/no .* data available/i);
    // The page shows "Top 20 Performers" and "Bottom 20 Performers" ChartCards.
    const performanceHeading = page.getByText("Top 20 Performers").first();

    await expect(performanceHeading).toBeVisible({ timeout: 15000 });

    // Assert either status column is visible (data present) or empty state shows
    await expect(statusColumn.or(emptyState).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("portfolio outlet tiers shows maturity column", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio?from=2025-01-01&to=2025-12-31");

    await expect(
      page.getByRole("columnheader", { name: "Maturity" }).first(),
    ).toBeVisible({ timeout: 15000 });
  });
});
