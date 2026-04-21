import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

async function createLocation(page: Parameters<typeof signInAsAdmin>[0], prefix: string) {
  await page.goto("/locations/new");
  const locationName = `${prefix}-${Date.now()}`;
  await page.getByPlaceholder("e.g. The Grand Hotel").fill(locationName);
  await page.getByRole("button", { name: "Create location" }).click();
  await expect(page).toHaveURL(/\/locations\/[0-9a-f-]+$/, { timeout: 15000 });
  return locationName;
}

test.describe("Location CRUD (LOC-01, LOC-02)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // LOC-01: Create and view location
  test("LOC-01: can create a location with required fields", async ({ page }) => {
    await page.goto("/locations/new");
    await expect(page.getByText("New Location")).toBeVisible();

    await page.getByPlaceholder("e.g. The Grand Hotel").fill(`TEST-LOC-${Date.now()}`);
    await page.getByRole("button", { name: "Create location" }).click();

    await expect(page).toHaveURL(/\/locations\/[0-9a-f-]+$/, { timeout: 15000 });
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible();
  });

  test("LOC-01: can view location detail page with all 4 sections", async ({ page }) => {
    await createLocation(page, "VIEW");

    // 4 section headers should be visible as collapsible buttons
    await expect(page.getByRole("button", { name: /^INFO$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^KEY CONTACTS$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^CONTRACT$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^BANKING$/i })).toBeVisible();
  });

  // LOC-02: Edit and archive location
  test("LOC-02: can edit location field inline", async ({ page }) => {
    await createLocation(page, "EDIT-FIELD");

    // INFO section should be expanded by default — click the Address field (second cursor-text span)
    const inlineSpans = page.locator("[data-slot='tabs-content'] span.cursor-text");
    await expect(inlineSpans.first()).toBeVisible({ timeout: 5000 });

    // Click the second inline span (address)
    const addressSpan = inlineSpans.nth(1);
    await addressSpan.click();

    // Input should appear
    const input = page.locator("input[type='text']").first();
    await expect(input).toBeVisible();
    await input.fill("123 Test Street, London");

    // Native blur is more deterministic than Tab (which may land on another
    // focusable element inside the same section).
    await input.evaluate((el: HTMLInputElement) => el.blur());

    // Input exits edit mode once save completes.
    await expect(input).not.toBeVisible({ timeout: 10000 });

    // Value should persist after save
    await expect(page.getByText("123 Test Street, London")).toBeVisible({
      timeout: 10000,
    });
  });

  test("LOC-02: can archive a location", async ({ page }) => {
    await createLocation(page, "ARCHIVE");

    // Click Archive button
    await page.getByRole("button", { name: /Archive/i }).first().click();

    // Confirmation dialog should appear
    await expect(page.getByText("Archive this location?")).toBeVisible();

    // Confirm archive
    await page.locator("[data-slot='dialog-footer']").getByRole("button", { name: "Archive" }).click();

    // Should redirect to locations list
    await expect(page).toHaveURL("/locations", { timeout: 15000 });
  });

  test("LOC-02: archived location disappears from default list", async ({ page }) => {
    const locationName = await createLocation(page, "HIDDEN");

    // Archive it
    await page.getByRole("button", { name: /Archive/i }).first().click();
    await page.locator("[data-slot='dialog-footer']").getByRole("button", { name: "Archive" }).click();
    await expect(page).toHaveURL("/locations", { timeout: 15000 });

    // Location name should not appear in the list
    await expect(page.getByText(locationName)).not.toBeVisible();
  });
});
