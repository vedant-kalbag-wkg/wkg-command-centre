import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("@analytics/portfolio Phase 3 warm-load", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("second load with same filters surfaces KPI data quickly (warm cache sanity)", async ({ page }) => {
    // First load: prime the per-day caches.
    await page.goto("/analytics/portfolio");
    // Wait for the KPI strip to resolve (outside skeleton).
    await expect(page.getByText(/revenue/i).first()).toBeVisible({ timeout: 20000 });

    // Second load: cache should be warm. This measures end-to-end browser
    // render (nav → hydrate → island resolve → first paint of "Revenue"), not
    // server TTFB. The BLOCKING perf gate is warm p95 ≤ 300ms measured via
    // scripts/perf-measure.ts (server `server-timing: fn;dur`), which is the
    // authoritative number. This test is a sanity check that the cache path
    // functions end-to-end; the 4000ms bound is padded for CI/remote preview
    // network variance.
    const t0 = Date.now();
    await page.goto("/analytics/portfolio");
    await expect(page.getByText(/revenue/i).first()).toBeVisible({ timeout: 4000 });
    const dt = Date.now() - t0;
    expect(dt).toBeLessThan(4000);
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
