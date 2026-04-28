/**
 * Phase 6 plan 06-05 — outlet-tier cutoffs editable from /settings/thresholds.
 *
 * Two specs:
 *   1. Happy path: fill the form, save, reload, assert persistence;
 *      then restore defaults so the test does not leak 85/55/25 to other
 *      specs that rely on the canonical 80/50/20 cutoffs.
 *   2. Validation: top <= mid is rejected and the error message surfaces.
 */
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@thresholds outlet-tier form saves three values and persists across reload", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/settings/thresholds");

  await expect(
    page.getByRole("heading", { name: "Performance Thresholds", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Outlet Tier Cutoffs")).toBeVisible();

  await page.getByLabel(/top cutoff/i).fill("85");
  await page.getByLabel(/mid cutoff/i).fill("55");
  await page.getByLabel(/bottom cutoff/i).fill("25");
  await page
    .getByRole("button", { name: /save outlet tier thresholds/i })
    .click();

  await expect(
    page.getByText(
      /outlet tier thresholds saved successfully|saved successfully/i,
    ),
  ).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByLabel(/top cutoff/i)).toHaveValue("85");
  await expect(page.getByLabel(/mid cutoff/i)).toHaveValue("55");
  await expect(page.getByLabel(/bottom cutoff/i)).toHaveValue("25");

  // Restore defaults so subsequent specs see the canonical 80/50/20 cutoffs.
  await page.getByLabel(/top cutoff/i).fill("80");
  await page.getByLabel(/mid cutoff/i).fill("50");
  await page.getByLabel(/bottom cutoff/i).fill("20");
  await page
    .getByRole("button", { name: /save outlet tier thresholds/i })
    .click();
  await expect(
    page.getByText(
      /outlet tier thresholds saved successfully|saved successfully/i,
    ),
  ).toBeVisible({ timeout: 10_000 });
});

test("@thresholds outlet-tier validation rejects top <= mid with descriptive error", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/settings/thresholds");

  await page.getByLabel(/top cutoff/i).fill("40");
  await page.getByLabel(/mid cutoff/i).fill("50");
  await page.getByLabel(/bottom cutoff/i).fill("20");
  await page
    .getByRole("button", { name: /save outlet tier thresholds/i })
    .click();

  await expect(page.getByText(/top > mid > bottom/i)).toBeVisible({
    timeout: 10_000,
  });
});
