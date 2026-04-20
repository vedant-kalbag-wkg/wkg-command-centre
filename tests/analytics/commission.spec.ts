import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Commission Dashboard", () => {
  test("page loads and renders title", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/commission");

    await expect(
      page.getByRole("heading", { name: "Commission Analytics" }),
    ).toBeVisible();
    await expect(
      page.getByText("Commission performance across locations and products"),
    ).toBeVisible();
  });

  test("renders KPI cards", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/commission");

    await expect(
      page.getByText("Total Commission"),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("Commissionable Revenue")).toBeVisible();
    await expect(page.getByText("Average Rate")).toBeVisible();
    await expect(page.getByText("Records with Commission")).toBeVisible();
  });

  test("renders section accordions", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/commission");

    await expect(page.getByText("By Location")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("By Product")).toBeVisible();
    await expect(page.getByText("Monthly Trend")).toBeVisible();
  });
});
