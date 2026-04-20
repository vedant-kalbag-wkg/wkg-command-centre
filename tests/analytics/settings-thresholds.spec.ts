import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Performance Thresholds Settings", () => {
  test("page loads and renders title", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/thresholds");

    await expect(
      page.getByRole("heading", { name: "Performance Thresholds" }),
    ).toBeVisible();
  });

  test("shows red max and green min inputs", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/thresholds");

    // Wait for form to load (inputs appear after threshold fetch)
    await expect(page.getByLabel(/Red Max/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByLabel(/Green Min/)).toBeVisible();

    // Both should be number inputs
    await expect(page.getByLabel(/Red Max/)).toHaveAttribute("type", "number");
    await expect(page.getByLabel(/Green Min/)).toHaveAttribute(
      "type",
      "number",
    );
  });

  test("shows save button", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/thresholds");

    await expect(
      page.getByRole("button", { name: /Save Thresholds/ }),
    ).toBeVisible({ timeout: 15000 });
  });
});
