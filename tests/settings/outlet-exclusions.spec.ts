import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@settings outlet-exclusions renders PageHeader with title", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/outlet-exclusions");

  await expect(
    page.getByRole("heading", { name: "Outlet Exclusions", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
