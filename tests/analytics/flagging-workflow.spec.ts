import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Performance Flagging & Actions Workflow", () => {
  test("heat map shows performance rankings section", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/heat-map?from=2025-01-01&to=2025-12-31");
    // The heat map should show the Performance Rankings section
    // Even without data, the section and tabs render
    await expect(page.getByText("Performance Rankings")).toBeVisible({
      timeout: 15000,
    });
    // The tabs should be visible
    await expect(page.getByRole("tab", { name: "Top 20" })).toBeVisible();
  });

  test("portfolio shows category performance section", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio?from=2025-01-01&to=2025-12-31");
    // Portfolio page should show Summary and Category Performance sections
    await expect(page.getByText("Summary")).toBeVisible({ timeout: 15000 });
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
