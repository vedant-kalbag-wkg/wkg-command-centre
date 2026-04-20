import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Weight editor on /analytics/heat-map — verifies bar redraw, Apply disable
 * on invalid sum, the red banner, and Reset-to-default behaviour.
 */

const METRIC_KEYS = [
  "revenue",
  "transactions",
  "revenuePerRoom",
  "txnPerKiosk",
  "basketValue",
] as const;

async function clearPersistedWeights(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("heatmap-weights");
    } catch {
      /* ignore */
    }
  });
}

test.describe("@analytics/heat-map weight editor", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/heat-map");
    await clearPersistedWeights(page);
    // Reload so the store re-hydrates to defaults.
    await page.goto("/analytics/heat-map");
    await expect(
      page.getByRole("heading", { name: "Performance Heat Map", level: 1 }),
    ).toBeVisible();
  });

  test("bar redraws when a weight input changes", async ({ page }) => {
    const bar = page.getByTestId("weights-bar");
    await expect(bar).toBeVisible();

    const revenueSegment = page.getByTestId("weights-bar-segment-revenue");
    await expect(revenueSegment).toHaveAttribute("data-weight", "30");

    // Change revenue from 30 → 40 (breaks sum to 110 — bar still draws)
    const revenueInput = page.getByTestId("weights-input-revenue");
    await revenueInput.fill("40");
    // Blur so onChange commits
    await revenueInput.press("Tab");

    await expect(revenueSegment).toHaveAttribute("data-weight", "40");
  });

  test("invalid sum disables Apply and shows the red banner", async ({ page }) => {
    const apply = page.getByTestId("weights-apply");
    // No dirty edits yet — Apply is disabled because isDirty=false.
    await expect(apply).toBeDisabled();

    // Push revenue to 50 → total = 120, sum invalid.
    const revenueInput = page.getByTestId("weights-input-revenue");
    await revenueInput.fill("50");
    await revenueInput.press("Tab");

    await expect(page.getByTestId("weights-error-banner")).toBeVisible();
    await expect(page.getByTestId("weights-error-banner")).toContainText("120%");
    await expect(apply).toBeDisabled();
  });

  test("Reset restores the 30/20/25/15/10 defaults", async ({ page }) => {
    const revenueInput = page.getByTestId("weights-input-revenue");
    await revenueInput.fill("60");
    await revenueInput.press("Tab");

    await expect(page.getByTestId("weights-error-banner")).toBeVisible();

    await page.getByTestId("weights-reset").click();

    // Inputs restored to defaults
    await expect(page.getByTestId("weights-input-revenue")).toHaveValue("30");
    await expect(page.getByTestId("weights-input-transactions")).toHaveValue("20");
    await expect(page.getByTestId("weights-input-revenuePerRoom")).toHaveValue("25");
    await expect(page.getByTestId("weights-input-txnPerKiosk")).toHaveValue("15");
    await expect(page.getByTestId("weights-input-basketValue")).toHaveValue("10");

    // Banner gone, bar segments correct
    await expect(page.getByTestId("weights-error-banner")).toHaveCount(0);
    for (const key of METRIC_KEYS) {
      await expect(page.getByTestId(`weights-bar-segment-${key}`)).toBeVisible();
    }
  });

  test("Apply becomes enabled when sum returns to exactly 100", async ({ page }) => {
    const apply = page.getByTestId("weights-apply");

    // +10 on revenue, -10 on basketValue → still sums to 100.
    await page.getByTestId("weights-input-revenue").fill("40");
    await page.getByTestId("weights-input-revenue").press("Tab");
    await expect(apply).toBeDisabled(); // sum is 110 right now

    await page.getByTestId("weights-input-basketValue").fill("0");
    await page.getByTestId("weights-input-basketValue").press("Tab");

    await expect(page.getByTestId("weights-error-banner")).toHaveCount(0);
    await expect(apply).toBeEnabled();
  });
});
