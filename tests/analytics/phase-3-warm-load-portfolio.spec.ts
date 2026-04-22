import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("@analytics/portfolio Phase 3 warm-load", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("second load with same filters surfaces KPI data within 2000ms (warm cache)", async ({ page }) => {
    // First load: prime the per-day caches.
    await page.goto("/analytics/portfolio");
    // Wait for the KPI strip to resolve (outside skeleton). The label "Revenue"
    // is rendered by <StatCard> once summary data lands.
    await expect(page.getByText(/revenue/i).first()).toBeVisible({ timeout: 20000 });

    // Second load: should hit the cache for every cached island.
    const t0 = Date.now();
    await page.goto("/analytics/portfolio");
    await expect(page.getByText(/revenue/i).first()).toBeVisible({ timeout: 2000 });
    const dt = Date.now() - t0;
    // Generous bound; perf-measure will drive the tighter warm p95 ≤ 300ms gate
    // (which measures server TTFB rather than end-to-end browser render).
    expect(dt).toBeLessThan(2000);
  });

  test("same filters produce deterministic island order (no layout thrash between loads)", async ({
    page,
  }) => {
    await page.goto("/analytics/portfolio");
    await expect(page.getByText(/revenue/i).first()).toBeVisible({ timeout: 20000 });

    const captureOrder = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-slot='card-title']"))
          .map((el) => el.textContent?.trim() ?? ""),
      );

    const first = await captureOrder();

    await page.reload();
    await expect(page.getByText(/revenue/i).first()).toBeVisible({ timeout: 5000 });
    const second = await captureOrder();

    expect(second).toEqual(first);
  });
});
