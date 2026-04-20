import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@analytics/commission renders PageHeader with title", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/commission");

  await expect(
    page.getByRole("heading", { name: "Commission Analytics", level: 1 }),
  ).toBeVisible();
});

test("@analytics/commission page does not throw", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/analytics/commission");

  // PageHeader should be visible to confirm the route rendered.
  await expect(
    page.getByRole("heading", { name: "Commission Analytics", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
