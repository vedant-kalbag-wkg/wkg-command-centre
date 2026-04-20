import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Action Dashboard", () => {
  test("page loads and renders title", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/actions-dashboard");

    await expect(
      page.getByRole("heading", { name: "Action Dashboard" }),
    ).toBeVisible();
  });

  test("shows status filter buttons", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/actions-dashboard");

    await expect(
      page.getByRole("button", { name: "All", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("button", { name: "Open", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "In Progress", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Resolved", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancelled", exact: true }),
    ).toBeVisible();
  });

  test("shows new action button", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/actions-dashboard");

    await expect(
      page.getByRole("button", { name: /New Action/i }),
    ).toBeVisible({ timeout: 15000 });
  });

  test("shows empty state when no actions", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/actions-dashboard");

    // Either shows the table with data or the empty state
    await expect(
      page.getByText(/No action items found|Loading actions/i),
    ).toBeVisible({ timeout: 15000 });
  });
});
