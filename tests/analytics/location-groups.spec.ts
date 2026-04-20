import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@analytics/location-groups renders PageHeader with title", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/location-groups");

  await expect(
    page.getByRole("heading", { name: "Location Groups", level: 1 }),
  ).toBeVisible();
});

test("@analytics/location-groups page does not throw", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/analytics/location-groups");

  await expect(
    page.getByRole("heading", { name: "Location Groups", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("@analytics/location-groups multi-select trigger renders and opens", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/location-groups");

  await expect(
    page.getByRole("heading", { name: "Location Groups", level: 1 }),
  ).toBeVisible();

  // Multi-select trigger button (not a base-ui combobox anymore).
  const trigger = page
    .getByRole("button", { name: /Select location group/i })
    .first();
  await expect(trigger).toBeVisible();

  // Opening the dropdown should surface at least one option
  await trigger.click();
  const firstOption = page.getByRole("option").first();
  await expect(firstOption).toBeVisible();
  await firstOption.click();
  await page.keyboard.press("Escape");

  // Trigger remains visible (no crash)
  await expect(trigger).toBeVisible();
});

test("@analytics/location-groups dark-mode toggle does not throw", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/location-groups");

  await expect(
    page.getByRole("heading", { name: "Location Groups", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Location Groups", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Location Groups", level: 1 }),
  ).toBeVisible();
});
