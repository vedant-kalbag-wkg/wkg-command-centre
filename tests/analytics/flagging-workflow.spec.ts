import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Performance Flagging & Actions Workflow", () => {
  test("heat map shows performance rankings section", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/heat-map?from=2025-01-01&to=2025-12-31");
    // The heat map should show "Top 20 Performers" and "Bottom 20 Performers"
    // ChartCards. Both render whether or not data is present.
    await expect(page.getByText("Top 20 Performers").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Bottom 20 Performers").first()).toBeVisible();
  });

  test("portfolio shows category performance section", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio?from=2025-01-01&to=2025-12-31");
    // Portfolio page renders the "Category Performance" ChartCard. There is
    // no explicit "Summary" section heading on this page; the KPI strip
    // (Revenue, Transactions, …) is the summary surface.
    await expect(
      page.getByRole("heading", { name: "Portfolio", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Category Performance")).toBeVisible();
  });

  test("action dashboard new action dialog opens", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/actions-dashboard");
    // Click "New Action" button
    await page.getByRole("button", { name: /New Action/ }).click();
    // Dialog should open with "Create Action Item" title
    await expect(
      page.getByRole("heading", { name: "Create Action Item" }),
    ).toBeVisible();
    // Should have form fields: Title textbox and Action Type label
    await expect(page.getByLabel("Title")).toBeVisible();
    await expect(page.getByText("Action Type")).toBeVisible();
  });

  test("action dashboard type filter works", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/actions-dashboard");
    // The type filter combobox should be visible next to the status buttons
    await expect(page.locator("main select, main [role='combobox']").first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("settings page shows data quality and thresholds cards", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/settings");
    // Admin should see Data Quality and Performance Thresholds cards
    await expect(page.getByText("Data Quality")).toBeVisible();
    await expect(page.getByText("Performance Thresholds")).toBeVisible();
  });

  test("sidebar shows all new analytics nav items", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");
    // Verify sidebar has the new nav items from Phase 3-4
    // These are in the sidebar menu
    const sidebar = page.locator("[data-slot='sidebar']").first();
    await expect(sidebar.getByText("Maturity")).toBeVisible();
    await expect(sidebar.getByText("Experiments")).toBeVisible();
    await expect(sidebar.getByText("Compare")).toBeVisible();
    await expect(sidebar.getByText("Commission")).toBeVisible();
    await expect(sidebar.getByText("Actions")).toBeVisible();
  });
});
