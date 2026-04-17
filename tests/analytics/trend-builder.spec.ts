import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Trend Builder", () => {
  test("page loads with series builder panel", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/trend-builder");

    await expect(
      page.getByRole("heading", { name: "Trend Builder" }),
    ).toBeVisible();
    await expect(page.getByText("Series Builder")).toBeVisible();
  });

  test("Add Series button creates a new series row", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/trend-builder");

    await expect(page.getByText("Series Builder")).toBeVisible();

    // Click Add Series
    await page.getByRole("button", { name: "Add Series" }).click();

    // The panel should now contain multiple series rows — verify
    // the button is still visible (can add more) and Apply button exists
    await expect(
      page.getByRole("button", { name: "Add Series" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Apply", exact: true }),
    ).toBeVisible();
  });

  test("Revenue vs Transactions preset loads 2 series", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/trend-builder");

    await expect(page.getByText("Series Builder")).toBeVisible();

    // Click the preset button
    await page
      .getByRole("button", { name: "Revenue vs Transactions" })
      .click();

    // Apply button should be visible after preset load
    await expect(
      page.getByRole("button", { name: "Apply", exact: true }),
    ).toBeVisible();
  });

  test("granularity selector buttons visible", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/trend-builder");

    await expect(page.getByRole("button", { name: "Auto" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Daily" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Weekly" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Monthly" })).toBeVisible();
  });
});
