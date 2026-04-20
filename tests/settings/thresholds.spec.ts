import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@settings/thresholds renders PageHeader with title", async ({
  page,
}) => {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/thresholds");

  await expect(
    page.getByRole("heading", { name: "Performance Thresholds", level: 1 })
  ).toBeVisible();

  expect(errors).toEqual([]);
});
