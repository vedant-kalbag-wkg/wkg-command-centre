import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Pivot Table", () => {
  test("page loads with field list and drop zones", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/pivot-table");

    await expect(
      page.getByRole("heading", { name: "Pivot Table" }),
    ).toBeVisible();

    // The field list panel has a "Fields" heading
    await expect(page.getByRole("heading", { name: "Fields" })).toBeVisible();

    // Empty state instruction text
    await expect(
      page.getByText("Drag fields into the zones above"),
    ).toBeVisible();
  });

  test("dimension fields listed", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/pivot-table");

    // Scope to the field list panel (the sticky card with "Fields" heading)
    const fieldPanel = page.locator(".sticky").filter({ hasText: "Fields" });
    await expect(fieldPanel).toBeVisible();

    await expect(fieldPanel.getByText("Dimensions")).toBeVisible();

    // Check key dimension field chips within the panel
    await expect(fieldPanel.getByText("Product", { exact: true })).toBeVisible();
    await expect(fieldPanel.getByText("Hotel", { exact: true })).toBeVisible();
    await expect(fieldPanel.getByText("Region", { exact: true })).toBeVisible();
    await expect(fieldPanel.getByText("Hotel Group", { exact: true })).toBeVisible();
    await expect(fieldPanel.getByText("Location Group", { exact: true })).toBeVisible();
    await expect(fieldPanel.getByText("Outlet Code")).toBeVisible();
    await expect(fieldPanel.getByText("Month")).toBeVisible();
    await expect(fieldPanel.getByText("Year")).toBeVisible();
    await expect(fieldPanel.getByText("Hour")).toBeVisible();
  });

  test("metric fields listed", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/pivot-table");

    const fieldPanel = page.locator(".sticky").filter({ hasText: "Fields" });
    await expect(fieldPanel).toBeVisible();

    await expect(fieldPanel.getByText("Metrics")).toBeVisible();

    // Check metric field chips within the panel
    await expect(fieldPanel.getByText("Revenue")).toBeVisible();
    await expect(fieldPanel.getByText("Quantity")).toBeVisible();
    await expect(fieldPanel.getByText("Booking Fee")).toBeVisible();
  });

  test("Run Pivot button exists", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/pivot-table");

    await expect(
      page.getByRole("button", { name: "Run Pivot" }),
    ).toBeVisible();
  });

  test("MoM / YoY toggle buttons exist", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/pivot-table");

    await expect(page.getByRole("button", { name: "MoM" })).toBeVisible();
    await expect(page.getByRole("button", { name: "YoY" })).toBeVisible();
  });

  test("Clear button exists", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/pivot-table");

    await expect(page.getByRole("button", { name: "Clear" })).toBeVisible();
  });
});
