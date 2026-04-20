import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@analytics/regions renders PageHeader with title", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/regions");

  await expect(
    page.getByRole("heading", { name: "Regions", level: 1 }),
  ).toBeVisible();
});

test("@analytics/regions page does not throw", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/analytics/regions");

  await expect(
    page.getByRole("heading", { name: "Regions", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("@analytics/regions shows EmptyState prompt when no region is selected", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/regions");

  await expect(
    page.getByRole("heading", { name: "Regions", level: 1 }),
  ).toBeVisible();

  // No region is selected on mount — the EmptyState prompt should be visible.
  await expect(
    page.getByText("Select a region to see its performance metrics."),
  ).toBeVisible();
});

test("@analytics/regions dark-mode toggle does not throw", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/regions");

  await expect(
    page.getByRole("heading", { name: "Regions", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Regions", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Regions", level: 1 }),
  ).toBeVisible();
});
