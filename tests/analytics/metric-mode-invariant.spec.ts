/**
 * Phase 8.2 — Metric-mode invariant test. Toggling Sales↔Revenue MUST
 * change at least one rendered number on every dashboard that mounts the
 * shared FilterBar; otherwise the toggle is silently a no-op (which is
 * exactly what NEW-P0-A in the audit caught: Performer Patterns kept
 * showing sales-mode aggregates after the user picked revenue-mode).
 *
 * The toggle lives on the FilterBar (`data-testid="metric-mode-toggle"`).
 * Pages without a FilterBar (Flag Review, Action Dashboard, Experiments,
 * Compare's read-only summary view) are excluded — they don't expose the
 * toggle and have no metric-mode-dependent reading.
 */
import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

// Pages that mount the global FilterBar. Compare is intentionally excluded
// — it has its own self-contained toggle layout and is exercised by
// `compare.spec.ts`.
const TOGGLE_PAGES = [
  { path: "/analytics/portfolio", heading: "Portfolio" },
  { path: "/analytics/trend-builder", heading: "Trend Builder" },
  { path: "/analytics/hotel-groups", heading: "Hotel Groups" },
  { path: "/analytics/regions", heading: "Regions" },
  { path: "/analytics/location-groups", heading: "Location Groups" },
  { path: "/analytics/heat-map", heading: "Performance Heat Map" },
  { path: "/analytics/maturity", heading: "Maturity Analysis" },
  { path: "/analytics/pivot-table", heading: "Pivot Table" },
];

// Returns the ordered list of numeric strings rendered inside the main
// content area. We strip whitespace so two snapshots can be compared
// directly — the first divergence proves the toggle moved the needle.
async function captureNumericText(page: Page): Promise<string[]> {
  const values = await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    const out: string[] = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent?.trim() ?? "";
      // Match anything that contains at least one digit. £1,234.56, 12 %,
      // 0.43, 1k, etc. Numeric formatting is what we're trying to compare;
      // dropping pure-text cells (headings, labels) keeps the diff tight.
      if (/\d/.test(text) && text.length > 0 && text.length < 64) {
        out.push(text);
      }
    }
    return out;
  });
  return values;
}

test.describe("@metric-mode metric-mode toggle invariant", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  for (const { path, heading } of TOGGLE_PAGES) {
    test(`@metric-mode ${path} reacts to Sales↔Revenue toggle`, async ({
      page,
    }) => {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible({ timeout: 30_000 });

      // Allow the initial data fetch to settle so the snapshot reflects
      // post-load numbers, not a loading-state placeholder.
      await page
        .waitForLoadState("networkidle", { timeout: 15_000 })
        .catch(() => undefined);

      const toggle = page.getByTestId("metric-mode-toggle");
      await expect(
        toggle,
        `metric-mode-toggle missing on ${path}`,
      ).toBeVisible();

      const salesButton = toggle.getByRole("button", { name: "Sales" });
      const revenueButton = toggle.getByRole("button", { name: "Revenue" });

      // Force Sales mode first so the snapshot baseline is deterministic
      // regardless of any user-store persisted state.
      await salesButton.click();
      await page
        .waitForLoadState("networkidle", { timeout: 15_000 })
        .catch(() => undefined);
      const salesNumbers = await captureNumericText(page);

      await revenueButton.click();
      await page
        .waitForLoadState("networkidle", { timeout: 15_000 })
        .catch(() => undefined);
      const revenueNumbers = await captureNumericText(page);

      // Sanity floor — if the page renders zero numeric cells in either
      // mode, the test would trivially "pass" by being broken. Either the
      // page is empty (no data loaded — separate problem) or our selector
      // missed; either way fail loud.
      expect(
        salesNumbers.length,
        `no numeric cells captured in Sales mode on ${path}`,
      ).toBeGreaterThan(0);
      expect(
        revenueNumbers.length,
        `no numeric cells captured in Revenue mode on ${path}`,
      ).toBeGreaterThan(0);

      // The bug we're guarding against: identical snapshots after the
      // toggle. Lengths can differ when a chart legend re-renders, so we
      // compare the JSON-serialised arrays for any divergence.
      expect(
        JSON.stringify(salesNumbers) !== JSON.stringify(revenueNumbers),
        `metric-mode toggle on ${path} produced identical numeric output`,
      ).toBe(true);
    });
  }
});
