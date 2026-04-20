import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@analytics/actions-dashboard renders PageHeader with title", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/actions-dashboard");

  await expect(
    page.getByRole("heading", { name: "Action Dashboard", level: 1 }),
  ).toBeVisible();
});

test("@analytics/actions-dashboard page does not throw", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/analytics/actions-dashboard");

  await expect(
    page.getByRole("heading", { name: "Action Dashboard", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("@analytics/actions-dashboard dark-mode toggle does not throw", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/actions-dashboard");

  await expect(
    page.getByRole("heading", { name: "Action Dashboard", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Action Dashboard", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Action Dashboard", level: 1 }),
  ).toBeVisible();
});
