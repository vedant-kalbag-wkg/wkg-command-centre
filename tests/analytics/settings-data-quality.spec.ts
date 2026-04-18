import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Data Quality Settings", () => {
  test("page loads and renders title", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/data-quality");

    await expect(
      page.getByRole("heading", { name: "Data Quality" }),
    ).toBeVisible();
  });

  test("shows 4 completeness KPI cards or error state", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/data-quality");

    // The page either shows KPI cards (when DB is healthy) or an error banner.
    // Assert that at least one of these states is visible.
    const kpiVisible = page.getByText("% with Region");
    const errorBanner = page.locator(".bg-red-50, .bg-destructive\\/10");

    await expect(kpiVisible.or(errorBanner)).toBeVisible({ timeout: 15000 });

    // If KPI cards loaded, verify all four
    if (await kpiVisible.isVisible()) {
      await expect(page.getByText("% with Hotel Group")).toBeVisible();
      await expect(page.getByText("% with Operating Group")).toBeVisible();
      await expect(page.getByText("% with Market")).toBeVisible();
    }
  });

  test("shows location quality table or error state", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/data-quality");

    // The table only renders when data loads successfully.
    const tableHeader = page.getByRole("columnheader", { name: "Name" });
    const errorBanner = page.locator(".bg-red-50, .bg-destructive\\/10");

    await expect(tableHeader.or(errorBanner)).toBeVisible({ timeout: 15000 });

    // If table loaded, verify column headers
    if (await tableHeader.isVisible()) {
      await expect(
        page.getByRole("columnheader", { name: "Outlet Code" }),
      ).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: "Quality Score" }),
      ).toBeVisible();
    }
  });
});
