// Phase 9.1 Plan 09.1-01 Task 3 — RED-stage Playwright spec for D-10
// (analytics currency renderer dispatch). Drives FX-03 visual contract:
//   - Single-currency cohort → revenue cell renders the native symbol
//     (e.g. EUR → €) via `formatRevenueForKiosk`.
//   - Multi-currency cohort → revenue cell renders £ (GBP fallback).
// Wave 4 plan 09.1-07 Tasks 1-2 wire the dispatcher; Wave 5 plan 09.1-08
// Task 5 runs this spec against the preview alias to declare done.
//
// Analog: tests/admin/performance-alerts.spec.ts (signInAsAdmin shape)
// + tests/analytics/regions.spec.ts (cell-text matcher pattern). The
// renderer dispatch is `pickRevenueDisplay(row)` per RESEARCH.md
// § "Pattern 4: Dual-emit + auto-pick renderer".

import { expect, test } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("@fx analytics currency renderer dispatch (D-10)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("single-currency cohort renders the native symbol (EUR-only region → €)", async ({ page }) => {
    // Precondition (Wave 5 operator-driven seed): a region exists where
    // every kiosk is EUR-only — `COUNT(DISTINCT currency) = 1` in the
    // dual-emit query. The renderer's `pickRevenueDisplay` reads the
    // `currency` resolver field, sees a single value, and formats with
    // `formatRevenueForKiosk(amount, "EUR")` → "€<amount>".
    //
    // Specific URL TBD by Wave 4 (which region is EUR-only depends on
    // the seed dataset on the preview branch). For now we navigate to
    // the regions index and assert that AT LEAST ONE row in the table
    // renders a € symbol — the multi-currency rows still render £, so
    // both must be present in the same view.
    await page.goto("/analytics/regions");
    await expect(page.locator("table").getByText(/€\s?[\d,]+/)).toHaveCount(1, {
      // Wave 4 may emit multiple € rows depending on regional split — relax
      // upward in the GREEN PR once the seed shape is locked. Expressed as
      // toHaveCount(1) here to fail RED loudly until the dispatcher exists.
      timeout: 10_000,
    });
  });

  test("multi-currency aggregate cohort renders the GBP symbol (£)", async ({ page }) => {
    // Precondition: an "All regions" or "All hotel groups" view that
    // aggregates across currencies. `COUNT(DISTINCT currency) > 1` →
    // renderer falls back to GBP via `formatCurrency(amount_gbp)`.
    //
    // The portfolio view is the canonical multi-currency aggregate.
    await page.goto("/analytics/portfolio");
    await expect(page.locator("table, [role=table]").getByText(/£\s?[\d,]+/).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
