/**
 * Phase 6 plan 06-05 — URL-param threshold overrides (CONTEXT D-09).
 *
 * `?redMax=200&greenMin=800` shifts the heat-map traffic-light cutoffs for
 * the current view only — the saved appSettings values are not mutated.
 * The page renders a `data-testid="threshold-legend"` element showing the
 * effective values, which is the assertion surface for both specs.
 */
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@heat-map ?redMax=200&greenMin=800 URL params shift the threshold legend", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/heat-map?redMax=200&greenMin=800");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const legend = page.getByTestId("threshold-legend");
  await expect(legend).toBeVisible({ timeout: 15_000 });
  await expect(legend).toContainText(/Red:\s*≤200/);
  await expect(legend).toContainText(/Green:\s*≥800/);
  await expect(legend).toContainText(/URL override active/i);
});

test("@heat-map without URL params reads saved default thresholds", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/heat-map");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const legend = page.getByTestId("threshold-legend");
  await expect(legend).toBeVisible({ timeout: 15_000 });
  // No URL override marker when the page is loaded without overrides.
  await expect(legend).not.toContainText(/URL override active/i);
  // Tier defaults from /settings/thresholds (canonical 80/50/20) come through.
  await expect(legend).toContainText(/Tiers:\s*80\/50\/20/);
});
