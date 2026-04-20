import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@settings/audit-log renders PageHeader with title", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/settings/audit-log");

  await expect(
    page.getByRole("heading", { name: "Audit Log", level: 1 }),
  ).toBeVisible();
});

test("@settings/audit-log page does not throw", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/audit-log");

  await expect(
    page.getByRole("heading", { name: "Audit Log", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("@settings/audit-log dark-mode toggle does not throw", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/settings/audit-log");

  await expect(
    page.getByRole("heading", { name: "Audit Log", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Audit Log", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Audit Log", level: 1 }),
  ).toBeVisible();
});
