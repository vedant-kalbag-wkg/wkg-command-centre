import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@analytics/hotel-groups renders PageHeader with title", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/hotel-groups");

  await expect(
    page.getByRole("heading", { name: "Hotel Groups", level: 1 }),
  ).toBeVisible();
});

test("@analytics/hotel-groups page does not throw", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/analytics/hotel-groups");

  await expect(
    page.getByRole("heading", { name: "Hotel Groups", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("@analytics/hotel-groups dark-mode toggle does not throw", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/hotel-groups");

  await expect(
    page.getByRole("heading", { name: "Hotel Groups", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Hotel Groups", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Hotel Groups", level: 1 }),
  ).toBeVisible();
});
