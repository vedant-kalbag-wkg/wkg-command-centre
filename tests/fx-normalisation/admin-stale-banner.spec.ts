// Phase 9.1 Plan 09.1-01 Task 3 — RED-stage Playwright spec for D-16
// (admin stale-rate banner). Drives FX-04 visual contract: when the most
// recent successful BoE fetch (`MAX(exchange_rates.fetched_at)`) is more
// than 24h old, `/admin/performance-alerts` surfaces an inline banner.
// Wave 4 plan 09.1-07 Task 4 wires the banner; Wave 5 plan 09.1-08 Task 5
// runs this spec against the preview alias to declare done (CLAUDE.md
// "Playwright specs against preview deploys" rule — `--list` is not
// sufficient evidence).
//
// Analog: tests/admin/performance-alerts.spec.ts — same `signInAsAdmin`
// + `await page.goto('/admin/performance-alerts')` + role-locator
// shape. The banner placement (D-16) is "inline at top of the page near
// latestRunAt" per RESEARCH.md § "Claude's Discretion".

import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("@fx admin stale-rate banner (D-16)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("banner hidden when the last BoE fetch is < 24h old", async ({ page }) => {
    // Precondition (Wave 4 to wire): the cron has run within the last 24h
    // so MAX(exchange_rates.fetched_at) is fresh. On a fresh preview
    // build, the cron has not yet been triggered for the test branch — so
    // this assertion will need a seed step in plan 09.1-08 Task 5
    // (operator-driven against preview, per CLAUDE.md). For RED, we
    // assert the locator does NOT exist on the rendered page; the actual
    // not-stale-state will hold once the cron runs.
    await page.goto("/admin/performance-alerts");

    // Two phrasings the renderer might pick — match either to keep this
    // resilient to copy iteration during Wave 4.
    await expect(
      page.getByText(/FX rates? are stale|last successful FX fetch/i),
    ).not.toBeVisible();
  });

  test("banner visible when the last BoE fetch is > 24h old", async ({ page }) => {
    // Precondition (Wave 4 plan 09.1-07 Task 4 wires; Wave 5 operator
    // step seeds): backdate `MAX(exchange_rates.fetched_at)` to > 24h
    // ago. For RED, the locator is the assertion target — it should fail
    // until the banner exists. Once Wave 4 ships and Wave 5 seeds the
    // stale row, this passes.
    //
    // Phrasing matches the D-16 spec ("last successful FX fetch ... ago"
    // inline indicator near latestRunAt).
    await page.goto("/admin/performance-alerts");
    await expect(
      page.getByText(/FX rates? are stale|last successful FX fetch.*ago/i),
    ).toBeVisible();
  });
});
