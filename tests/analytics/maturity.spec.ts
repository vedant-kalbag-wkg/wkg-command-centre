import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@analytics/maturity renders PageHeader with title", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/maturity");

  await expect(
    page.getByRole("heading", { name: "Maturity Analysis", level: 1 }),
  ).toBeVisible();
});

test("@analytics/maturity page does not throw", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/analytics/maturity");

  await expect(
    page.getByRole("heading", { name: "Maturity Analysis", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("@analytics/maturity renders without error banner (buckets use selected end date, not NOW())", async ({
  page,
}) => {
  // Regression guard for the NOW() → filters.dateTo fix in
  // src/lib/analytics/queries/maturity-analysis.ts. Previously every kiosk
  // landed in the 0-30d bucket when the selected date range ended in the
  // past, and the SQL could surface as a red error banner under some setups.
  // This test just ensures the page loads cleanly end-to-end with the default
  // "this month" filter — the unit tests in src/lib/analytics/maturity.test.ts
  // cover the date-math itself.
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/analytics/maturity");

  await expect(
    page.getByRole("heading", { name: "Maturity Analysis", level: 1 }),
  ).toBeVisible();

  // No destructive error banner (role="alert" or .text-destructive container)
  // should appear for a normal load.
  const errorBanner = page.locator("div.text-destructive").first();
  await expect(errorBanner).toHaveCount(0);

  expect(pageErrors).toEqual([]);
});

test("@analytics/maturity dark-mode toggle does not throw", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/maturity");

  await expect(
    page.getByRole("heading", { name: "Maturity Analysis", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Maturity Analysis", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Maturity Analysis", level: 1 }),
  ).toBeVisible();
});
