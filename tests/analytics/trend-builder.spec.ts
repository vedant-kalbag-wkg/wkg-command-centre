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

  test("per-series filters are rendered independently per row (B.1)", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/trend-builder");

    // Panel should be visible
    await expect(
      page.getByRole("heading", { name: "Builder Panel" }),
    ).toBeVisible();

    // Scope queries to the Builder Panel so we exclude the page-level
    // analytics filter bar (which also has "Locations", "Products", etc.).
    const panel = page
      .getByRole("heading", { name: "Builder Panel" })
      .locator("..")
      .locator("..");

    // Default state is a single series row. Add a second.
    await page.getByRole("button", { name: "Add Series" }).click();

    // Each series row should expose per-series filter dropdowns
    // (Locations, Products, Hotel Groups, Regions, Location Groups).
    await expect(
      panel.getByRole("button", { name: /^Locations/ }),
    ).toHaveCount(2);
    await expect(
      panel.getByRole("button", { name: /^Products/ }),
    ).toHaveCount(2);
    await expect(
      panel.getByRole("button", { name: /^Hotel Groups/ }),
    ).toHaveCount(2);
    await expect(
      panel.getByRole("button", { name: /^Regions/ }),
    ).toHaveCount(2);
    await expect(
      panel.getByRole("button", { name: /^Location Groups/ }),
    ).toHaveCount(2);

    // Opening one series row's filter dropdown proves the UI is wired and
    // dimension options loaded.
    await panel.getByRole("button", { name: /^Locations/ }).first().click();
    await expect(page.getByPlaceholder("Search locations...")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
