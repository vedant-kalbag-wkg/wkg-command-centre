import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@locations new-location page renders with PageHeader", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/locations/new");

  // PageHeader title (h1, not the form field)
  await expect(page.getByRole("heading", { name: "New Location" })).toBeVisible();

  // Create form primary input present
  await expect(page.getByPlaceholder("e.g. The Grand Hotel")).toBeVisible();
});

test("@locations location detail page renders with PageHeader after create", async ({ page }) => {
  await signInAsAdmin(page);

  // Create a fresh location to navigate to detail.
  await page.goto("/locations/new");
  const name = `UI-SWEEP-${Date.now()}`;
  await page.getByPlaceholder("e.g. The Grand Hotel").fill(name);
  await page.getByRole("button", { name: "Create location" }).click();
  await expect(page).toHaveURL(/\/locations\/[0-9a-f-]+$/, { timeout: 15000 });

  // PageHeader title uses the location name
  await expect(page.getByRole("heading", { name })).toBeVisible();

  // Details tab is present (confirms detail form still renders)
  await expect(page.getByRole("tab", { name: "Details" })).toBeVisible();
});
