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

test.describe("Location Kiosks Tab (LOC-05)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("LOC-05: kiosks tab shows empty state when none assigned", async ({ page }) => {
    await createLocation(page, "KIOSK-EMPTY");

    // Click Kiosks tab
    await page.getByRole("tab", { name: "Kiosks" }).click();

    // Should show empty state message
    await expect(page.getByText("No kiosks assigned")).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText("Kiosks assigned to this location will appear here.")
    ).toBeVisible();
  });

  test("LOC-05: kiosks tab shows assigned kiosks", async ({ page }) => {
    // Create a location and get its URL
    await page.goto("/locations/new");
    const locationName = `KIOSK-TAB-${Date.now()}`;
    await page.getByPlaceholder("e.g. The Grand Hotel").fill(locationName);
    await page.getByRole("button", { name: "Create location" }).click();
    await expect(page).toHaveURL(/\/locations\/[0-9a-f-]+$/, { timeout: 15000 });
    const locationUrl = page.url();

    // Create a kiosk and assign it to this location
    await page.goto("/kiosks/new");
    const kioskDisplayId = `TAB-KIOSK-${Date.now()}`;
    await page.getByPlaceholder("e.g. KSK-001").fill(kioskDisplayId);
    await page.getByRole("button", { name: "Create kiosk" }).click();
    await expect(page).toHaveURL(/\/kiosks\/[0-9a-f-]+$/, { timeout: 15000 });

    // Assign the kiosk to the location via Assign venue dialog
    await page.getByRole("button", { name: /Assign venue/i }).click();
    await page.getByPlaceholder("Search locations…").fill(locationName);
    await page.getByText(locationName).click();
    await page.getByRole("button", { name: "Assign venue" }).click();

    // Wait for the assign action to complete (toast confirms DB write)
    await expect(page.getByText("Kiosk assigned")).toBeVisible({ timeout: 10000 });

    // Navigate back to location and check Kiosks tab
    await page.goto(locationUrl);
    await page.getByRole("tab", { name: "Kiosks" }).click();

    // Kiosk should appear in the tab
    await expect(page.getByRole("link", { name: kioskDisplayId })).toBeVisible({ timeout: 8000 });
  });
});
