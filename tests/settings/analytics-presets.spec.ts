import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@settings analytics-presets renders PageHeader with title", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/analytics-presets");

  await expect(
    page.getByRole("heading", { name: "Analytics Presets", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
