import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Experiments", () => {
  test("page loads and renders title", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/experiments");

    await expect(
      page.getByRole("heading", { name: "Experiments" }),
    ).toBeVisible();
  });

  test("shows create cohort button", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/experiments");

    await expect(
      page.getByRole("button", { name: /Create/i }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("empty state shows prompt to create cohort", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/experiments");

    // Either shows the "Select or create a cohort" prompt or "No cohorts yet"
    await expect(
      page.getByText(/select or create a cohort|no cohorts yet/i),
    ).toBeVisible({ timeout: 15000 });
  });
});
