import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@settings/users renders PageHeader with title", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/users");

  await expect(
    page.getByRole("heading", { name: "Users", level: 1 })
  ).toBeVisible();

  // Preserve B'.1: the Invite user action remains reachable from this page.
  // (On branches where the Create user dialog is also present, both buttons
  // should coexist. This spec only asserts the Invite action is reachable.)
  await expect(
    page.getByRole("button", { name: /invite user/i })
  ).toBeVisible();

  expect(errors).toEqual([]);
});
