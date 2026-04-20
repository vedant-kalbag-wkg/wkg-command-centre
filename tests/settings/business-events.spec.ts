import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@settings business-events renders PageHeader with title", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/business-events");

  await expect(
    page.getByRole("heading", { name: "Business Events", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
