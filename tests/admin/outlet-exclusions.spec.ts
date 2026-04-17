import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Outlet Exclusions", () => {
  test("page loads with exclusion form", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/outlet-exclusions");

    await expect(
      page.getByRole("heading", { name: "Outlet Exclusions" }),
    ).toBeVisible();
    await expect(page.getByText("Add Exclusion Rule")).toBeVisible();
    await expect(
      page.getByText("Exclude outlet codes from analytics calculations"),
    ).toBeVisible();
  });

  test("form has pattern type selector and Test Pattern button", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/outlet-exclusions");

    await expect(page.getByText("Pattern Type")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Test Pattern" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add Exclusion" }),
    ).toBeVisible();
  });
});
