/**
 * Phase 7 Plan 07-04 Task 3 — same-name guardrail banner + admin/health
 * Playwright spec.
 *
 * Two of the three tests assert against UAT-branch state — banner visible
 * when `PLAYWRIGHT_EXPECT_DUPES=1`, hidden otherwise. The third test
 * (admin/health page renders) is unconditional — both pages should render
 * regardless of whether the DB has dupes seeded.
 *
 * Run live (per CLAUDE.md "Playwright specs against preview deploys"):
 *
 *   PLAYWRIGHT_BASE_URL=https://wkg-command-centre-git-<branch>-...vercel.app \
 *   TEST_ADMIN_EMAIL='<admin>' TEST_ADMIN_PASSWORD='<pwd>' \
 *   PLAYWRIGHT_EXPECT_DUPES=0 \
 *     npx playwright test tests/locations/same-name-banner.spec.ts
 *
 * `--list` MUST parse cleanly even without the env vars — that's the gate
 * for this plan's CI; the live run is gated to Plan E.
 */

import { expect, test } from "@playwright/test";

import { signInAsAdmin } from "../helpers/auth";

test.describe("Same-name guardrail banner (DATA-03)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("@locations @phase-7 banner appears when same-name groups exist", async ({
    page,
  }) => {
    test.skip(
      process.env.PLAYWRIGHT_EXPECT_DUPES !== "1",
      "Requires UAT branch with at least one seeded same-name group; gated by PLAYWRIGHT_EXPECT_DUPES=1",
    );
    await page.goto("/locations");
    await expect(
      page.getByText("Duplicate location names detected"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View duplicates" }),
    ).toBeVisible();
  });

  test("@locations @phase-7 banner hidden when no same-name groups", async ({
    page,
  }) => {
    test.skip(
      process.env.PLAYWRIGHT_EXPECT_DUPES === "1",
      "This branch is seeded with dupes; skipped in clean-mode assertion",
    );
    await page.goto("/locations");
    await expect(
      page.getByText("Duplicate location names detected"),
    ).not.toBeVisible();
  });

  test("@admin @phase-7 admin/health page renders both status cards", async ({
    page,
  }) => {
    await page.goto("/admin/health");
    await expect(
      page.getByRole("heading", { name: "System Health" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Duplicate location names" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Unmatched kiosks" }),
    ).toBeVisible();
  });
});
