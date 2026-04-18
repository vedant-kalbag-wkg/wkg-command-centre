import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Maturity Analysis", () => {
  test("page loads and renders title", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/maturity");

    await expect(
      page.getByRole("heading", { name: "Maturity Analysis" }),
    ).toBeVisible();
    await expect(
      page.getByText("Understand how kiosk revenue evolves after installation"),
    ).toBeVisible();
  });

  test("renders all 4 sections", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/maturity");

    await expect(
      page.getByText("Revenue by Maturity Bucket"),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Revenue Ramp Curve")).toBeVisible();
    await expect(page.getByText("Install Month Cohorts")).toBeVisible();
    await expect(page.getByText("Plateau Detection")).toBeVisible();
  });

  test("shows maturity bucket content or empty state", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/maturity");

    // The bucket section either shows KPI cards with labels or an empty-state
    // message when no data is available for the current filters.
    await expect(
      page.getByText(/0-30 Days|No maturity data for selected filters/i),
    ).toBeVisible({ timeout: 15000 });
  });
});
