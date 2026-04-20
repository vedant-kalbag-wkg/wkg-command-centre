import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@analytics/trend-builder renders PageHeader with title", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/trend-builder");

  await expect(
    page.getByRole("heading", { name: "Trend Builder", level: 1 }),
  ).toBeVisible();
});

test("@analytics/trend-builder page does not throw", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/analytics/trend-builder");

  // PageHeader should be visible to confirm the route rendered.
  await expect(
    page.getByRole("heading", { name: "Trend Builder", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
