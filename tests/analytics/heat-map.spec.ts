import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@analytics/heat-map renders PageHeader with title", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/heat-map");

  await expect(
    page.getByRole("heading", { name: "Performance Heat Map", level: 1 }),
  ).toBeVisible();
});

test("@analytics/heat-map page does not throw", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/analytics/heat-map");

  // PageHeader should be visible to confirm the route rendered.
  await expect(
    page.getByRole("heading", { name: "Performance Heat Map", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("@analytics/heat-map dark-mode toggle does not throw", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/heat-map");

  await expect(
    page.getByRole("heading", { name: "Performance Heat Map", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Performance Heat Map", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Performance Heat Map", level: 1 }),
  ).toBeVisible();
});
