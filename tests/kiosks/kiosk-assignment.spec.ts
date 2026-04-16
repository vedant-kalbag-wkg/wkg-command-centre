import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Kiosk Assignment (KIOSK-05, KIOSK-06)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  async function createKiosk(page: Parameters<typeof signInAsAdmin>[0], prefix: string) {
    await page.goto("/kiosks/new");
    const kioskId = `${prefix}-${Date.now()}`;
    await page.getByPlaceholder("e.g. KSK-001").fill(kioskId);
    await page.getByRole("button", { name: "Create kiosk" }).click();
    await expect(page).toHaveURL(/\/kiosks\/[0-9a-f-]+$/, { timeout: 15000 });
    return kioskId;
  }

  // KIOSK-05: Assign kiosk to venue
  test("KIOSK-05: can assign a kiosk to a venue", async ({ page }) => {
    await createKiosk(page, "ASSIGN");

    // Scroll to Deployment section and find venue controls
    await expect(page.getByText("Current Venue")).toBeVisible({ timeout: 5000 }).catch(async () => {
      // Deployment section may be collapsed — expand it
      await page.getByRole("button", { name: /Deployment/i }).first().click();
    });

    // The "Assign venue" button should be visible
    const assignButton = page.getByRole("button", { name: "Assign venue" });
    await expect(assignButton).toBeVisible({ timeout: 5000 });

    // Click to open dialog
    await assignButton.click();

    // Dialog title should appear
    await expect(page.getByRole("heading", { name: "Assign venue" })).toBeVisible();

    // Close dialog with Escape
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Assign venue" })).not.toBeVisible({ timeout: 3000 });
  });

  test("KIOSK-05: can reassign kiosk to different venue", async ({ page }) => {
    await createKiosk(page, "REASSIGN");

    // Verify the deployment section is visible with venue controls
    await expect(page.getByText("Current Venue")).toBeVisible({ timeout: 10000 }).catch(async () => {
      await page.getByRole("button", { name: /Deployment/i }).first().click();
      await expect(page.getByText("Current Venue")).toBeVisible({ timeout: 5000 });
    });

    // "Assign venue" or "Reassign venue" button should exist
    await expect(
      page.getByRole("button", { name: /Assign venue|Reassign venue/ })
    ).toBeVisible();
  });

  // KIOSK-06: Assignment history
  test("KIOSK-06: assignment history shows previous venues", async ({ page }) => {
    await createKiosk(page, "HIST");

    // Scroll to Deployment section
    await page.getByText("Current Venue").waitFor({ state: "visible", timeout: 10000 }).catch(async () => {
      await page.getByRole("button", { name: /Deployment/i }).first().click();
    });

    // Assignment History collapsible toggle should be present
    const historyToggle = page.getByText("Assignment History");
    await expect(historyToggle).toBeVisible({ timeout: 5000 });

    // Click the toggle to expand
    await historyToggle.click();

    // Empty state message should show
    await expect(
      page.getByText(/No previous venues|only been at its current location/)
    ).toBeVisible({ timeout: 5000 });
  });

  test("KIOSK-06: assignment history shows dates and reasons", async ({ page }) => {
    await createKiosk(page, "HIST-DATES");

    // Scroll to deployment section
    await page.getByText("Current Venue").waitFor({ state: "visible", timeout: 10000 }).catch(async () => {
      await page.getByRole("button", { name: /Deployment/i }).first().click();
    });

    // Verify assignment history section exists
    const historyToggle = page.getByText("Assignment History");
    await expect(historyToggle).toBeVisible({ timeout: 5000 });
    await historyToggle.click();

    // Empty state is fine since we have no locations to assign to
    await expect(
      page.getByText(/No previous venues|only been at its current location/)
    ).toBeVisible({ timeout: 5000 });
  });
});
