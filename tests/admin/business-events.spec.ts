import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Business Events", () => {
  test("page loads with Events / Categories tabs", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/business-events");

    await expect(
      page.getByRole("heading", { name: "Business Events" }),
    ).toBeVisible();

    // Wait for loading to finish — tabs should appear
    await expect(page.getByRole("tab", { name: "Events" })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByRole("tab", { name: "Categories" }),
    ).toBeVisible();
  });

  test("events tab shows Create Event button", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/business-events");

    // Wait for loading to finish
    await expect(page.getByRole("tab", { name: "Events" })).toBeVisible({
      timeout: 10000,
    });

    await expect(
      page.getByRole("button", { name: "Create Event" }),
    ).toBeVisible();
    await expect(
      page.getByText("Business events are shown as annotations"),
    ).toBeVisible();
  });

  test("Create Event button opens dialog", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/business-events");

    // Wait for loading to finish
    await expect(
      page.getByRole("button", { name: "Create Event" }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Create Event" }).click();

    // The EventForm dialog should open
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5000 });
  });
});
