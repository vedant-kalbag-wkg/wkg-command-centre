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

test("@analytics/hotel-groups dropdown renders and selection reveals analytics panel", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/hotel-groups");

  await expect(
    page.getByRole("heading", { name: "Hotel Groups", level: 1 }),
  ).toBeVisible();

  // Dropdown trigger should be rendered (labelled "Select a hotel group").
  const trigger = page.getByLabel("Select a hotel group");
  await expect(trigger).toBeVisible({ timeout: 15_000 });

  // Nothing is pre-selected — picking the first option should reveal the
  // analytics sections ("Group Metrics", "Hotels in Group", "Daily Trends").
  await trigger.click();
  const firstOption = page.getByRole("option").first();
  await expect(firstOption).toBeVisible();
  await firstOption.click();

  await expect(
    page.getByRole("button", { name: /Group Metrics/ }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.getByRole("button", { name: /Hotels in Group/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Daily Trends/ }),
  ).toBeVisible();
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
