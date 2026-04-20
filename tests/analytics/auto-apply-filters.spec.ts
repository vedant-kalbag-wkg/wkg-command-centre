import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Task #9: Analytics filters auto-apply on change; "Apply Filters" button is gone.
 *
 * Assumptions:
 *   - /analytics/portfolio renders <AnalyticsFilterBar />.
 *   - "Locations" dimension is available in dimension options for the seeded DB.
 *     If no locations are seeded we still assert the no-apply-button invariant,
 *     and fall back to the Maturity filter (static options) for the URL check.
 *   - URL param for selected locations is `hotels` (see filtersToSearchParams).
 */
test.describe("Analytics filters auto-apply", () => {
  test("no Apply Filters button is rendered", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    // Wait for filter bar to render
    await expect(
      page.getByRole("button", { name: "Maturity", exact: true }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /apply filters/i }),
    ).toHaveCount(0);
  });

  test("toggling a filter auto-applies to the URL", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    // Maturity options are static (from MATURITY_BUCKETS), so this is the most
    // reliable dimension to exercise without DB seeding assumptions.
    await page.getByRole("button", { name: "Maturity", exact: true }).click();

    // Pick the first maturity option
    const firstOption = page.getByRole("option").first();
    await expect(firstOption).toBeVisible();
    await firstOption.click();

    // Close the popover so the URL replace has had a chance to fire
    await page.keyboard.press("Escape");

    // Debounce is 150ms — give it some slack
    await page.waitForFunction(
      () => new URLSearchParams(window.location.search).has("maturity"),
      undefined,
      { timeout: 2000 },
    );

    expect(page.url()).toContain("maturity=");
  });
});
