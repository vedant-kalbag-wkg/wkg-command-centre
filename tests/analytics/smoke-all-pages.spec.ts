/**
 * Phase 8.1 — CI smoke for every analytics page.
 *
 * What this catches: the kind of regression that broke Pivot Table at the
 * root of the audit (a NOT-NULL'd column rename on `is_booking_fee` /
 * `is_weknow_fee` 500'd every dashboard query before this test existed).
 * Fast, opinionated, and intentionally permissive about *content* — we
 * only assert the route mounts, the heading renders, and no console
 * errors fire after the network settles.
 *
 * Console-error filter: Next dev / RSC sometimes emits hot-reload notes
 * and the like at `error` level. We allow-list those by matching message
 * prefixes; everything else fails the test.
 */
import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

const ANALYTICS_PAGES: Array<{ path: string; heading: string }> = [
  { path: "/analytics/portfolio", heading: "Portfolio" },
  { path: "/analytics/trend-builder", heading: "Trend Builder" },
  { path: "/analytics/hotel-groups", heading: "Hotel Groups" },
  { path: "/analytics/regions", heading: "Regions" },
  { path: "/analytics/commission", heading: "Commission Analytics" },
  { path: "/analytics/flags", heading: "Flag Review" },
  { path: "/analytics/experiments", heading: "Experiments" },
  { path: "/analytics/actions-dashboard", heading: "Action Dashboard" },
  { path: "/analytics/location-groups", heading: "Location Groups" },
  { path: "/analytics/heat-map", heading: "Performance Heat Map" },
  { path: "/analytics/maturity", heading: "Maturity Analysis" },
  { path: "/analytics/compare", heading: "Compare" },
  { path: "/analytics/pivot-table", heading: "Pivot Table" },
];

// Browser-side log noise that's expected on Next dev and not a regression.
// Anything outside this list counts as a real console error.
const ALLOWED_CONSOLE_ERROR_PREFIXES = [
  "Failed to load resource: the server responded with a status of 404", // favicon / sourcemaps
  "Warning: ReactDOM.render is no longer supported", // RSC hot-reload chatter
  "Hydration failed", // suppress only if it's a known-noisy variant; tighten later
  "[next-auth]",
];

function isAllowedConsoleError(text: string): boolean {
  return ALLOWED_CONSOLE_ERROR_PREFIXES.some((p) => text.includes(p));
}

function captureConsoleErrors(page: Page): { drain: () => string[] } {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isAllowedConsoleError(text)) return;
    errors.push(text);
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return { drain: () => errors.slice() };
}

test.describe("@smoke analytics pages", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  for (const { path, heading } of ANALYTICS_PAGES) {
    test(`@smoke ${path} mounts cleanly`, async ({ page }) => {
      const consoleCapture = captureConsoleErrors(page);

      const response = await page.goto(path, { waitUntil: "domcontentloaded" });
      expect(response, `no response for ${path}`).not.toBeNull();
      expect(
        response!.status(),
        `${path} returned ${response!.status()}`,
      ).toBeLessThan(400);

      // The PageHeader rendering proves the RSC tree resolved without
      // throwing. Loose `name: heading` lets minor copy edits pass while
      // still pinning the page mounted as the right route.
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible({ timeout: 30_000 });

      // Let queued data fetches drain so any post-mount errors surface
      // before we capture. networkidle is sometimes flaky on dev with
      // long-poll telemetry; cap the wait so a stuck request can't hang
      // the whole suite.
      await page
        .waitForLoadState("networkidle", { timeout: 15_000 })
        .catch(() => undefined);

      const errors = consoleCapture.drain();
      expect(
        errors,
        `console errors on ${path}:\n${errors.join("\n")}`,
      ).toEqual([]);
    });
  }
});
