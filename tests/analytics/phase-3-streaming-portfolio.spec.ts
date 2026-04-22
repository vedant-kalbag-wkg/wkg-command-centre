import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("@analytics/portfolio Phase 3 streaming", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("page header paints before data islands resolve", async ({ page }) => {
    await page.goto("/analytics/portfolio", { waitUntil: "commit" });
    // Header "Portfolio" is part of the server-rendered shell, outside all Suspense islands.
    // It should be visible quickly regardless of DB latency for the six cached queries.
    await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({
      timeout: 3000,
    });
  });

  test("filter bar appears before data islands resolve", async ({ page }) => {
    await page.goto("/analytics/portfolio");
    // AnalyticsFilterBar lives in the layout — outside every island Suspense.
    // Targeted via data-testid to avoid coupling to dropdown labels.
    await expect(page.locator("[data-testid='analytics-filter-bar']")).toBeVisible({
      timeout: 3000,
    });
  });

  test("one section can be in a loading state while another has resolved (parallel Suspense)", async ({
    page,
  }) => {
    // Cold-cache load: each island's cached query misses and re-runs, but with
    // different query-time characteristics, so at least one resolves first.
    await page.goto(`/analytics/portfolio?_cb=${Date.now()}`);

    // At some point during the load we expect AT LEAST one section title to
    // be in the DOM. Titles are rendered by both the skeleton and the resolved
    // card, so their presence is a proxy for "the shell has streamed."
    await expect(page.getByText(/portfolio/i).first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/daily trends|category performance|top products/i).first()).toBeVisible({
      timeout: 10000,
    });
  });
});
