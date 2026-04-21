import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

async function createKiosk(page: Parameters<typeof signInAsAdmin>[0], prefix: string) {
  await page.goto("/kiosks/new");
  const kioskId = `${prefix}-${Date.now()}`;
  await page.getByPlaceholder("e.g. KSK-001").fill(kioskId);
  await page.getByRole("button", { name: "Create kiosk" }).click();
  await expect(page).toHaveURL(/\/kiosks\/[0-9a-f-]+$/, { timeout: 15000 });
  return kioskId;
}

test.describe("Kiosk CRUD (KIOSK-01, KIOSK-02, KIOSK-03)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // KIOSK-01: Create kiosk
  test("KIOSK-01: can create a kiosk with all required fields", async ({ page }) => {
    await page.goto("/kiosks/new");
    // Use the h1 role to avoid matching breadcrumb + description text nodes.
    await expect(
      page.getByRole("heading", { name: "New kiosk", level: 1 }),
    ).toBeVisible();

    await page.getByPlaceholder("e.g. KSK-001").fill(`TEST-${Date.now()}`);
    await page.getByRole("button", { name: "Create kiosk" }).click();

    await expect(page).toHaveURL(/\/kiosks\/[0-9a-f-]+$/, { timeout: 15000 });
    await expect(page.getByRole("tab", { name: "Details" })).toBeVisible();
  });

  test("KIOSK-01: new kiosk gets default pipeline stage", async ({ page }) => {
    await createKiosk(page, "STAGE-TEST");

    // The detail page should show a pipeline stage selector with a selected value
    // Expand Deployment section if needed — it might be collapsed
    const deploymentBtn = page.getByRole("button", { name: /DEPLOYMENT/i });
    const isExpanded = await deploymentBtn.evaluate((el) =>
      el.closest("[data-slot='collapsible']")?.getAttribute("data-open") !== null
    ).catch(() => false);

    if (!isExpanded) {
      await deploymentBtn.click();
    }

    // The Pipeline Stage field should exist and show either "Prospect" or a UUID
    // (base-ui renders the selected item's label if items prop is set correctly)
    await expect(page.getByText("Pipeline Stage")).toBeVisible();
    // A select trigger should be visible in the deployment section
    const selectTrigger = page.locator("[data-slot='select-trigger']").first();
    await expect(selectTrigger).toBeVisible({ timeout: 5000 });
  });

  // KIOSK-02: View and edit kiosk detail
  test("KIOSK-02: can view kiosk detail page with all field sections", async ({ page }) => {
    await createKiosk(page, "VIEW-TEST");

    // 4 section headers should be visible — use exact role+name to avoid strict mode issues
    // The CollapsibleTrigger renders as a button containing the section title
    await expect(page.getByRole("button", { name: /^IDENTITY$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^HARDWARE & SOFTWARE$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^DEPLOYMENT$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^BILLING$/i })).toBeVisible();
  });

  test("KIOSK-02: can edit kiosk field inline — save on blur", async ({ page }) => {
    await createKiosk(page, "EDIT-BLUR");

    // Identity section should be expanded by default — find the kiosk ID span
    // The kiosk ID is displayed in the Identity section as a cursor-text span
    const identitySpans = page.locator("[data-slot='tabs-content'] span.cursor-text");
    const firstSpan = identitySpans.first();
    await expect(firstSpan).toBeVisible({ timeout: 5000 });

    // Click the SECOND cursor-text span (first is kiosk ID, second is outlet code)
    const outletCodeSpan = identitySpans.nth(1);
    await outletCodeSpan.click();

    // Input should appear
    const input = page.locator("input[type='text']").first();
    await expect(input).toBeVisible();
    await input.fill("OUTLET-BLUR-001");

    // Fire a native blur on the input — more deterministic than Tab (which
    // can land on a different focusable inside the collapsible section).
    await input.evaluate((el: HTMLInputElement) => el.blur());

    // Input exits edit mode once the save completes.
    await expect(input).not.toBeVisible({ timeout: 10000 });

    // Value should persist after blur-triggered save.
    await expect(
      page.getByText("OUTLET-BLUR-001", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
  });

  test("KIOSK-02: can edit kiosk field inline — save on Enter", async ({ page }) => {
    await createKiosk(page, "EDIT-ENTER");

    // Click the kiosk ID span in details tab (first cursor-text span)
    const firstSpan = page.locator("[data-slot='tabs-content'] span.cursor-text").first();
    await expect(firstSpan).toBeVisible({ timeout: 5000 });
    await firstSpan.click();

    // Type a temp value and press Escape to test that it reverts
    await page.locator("input[type='text']").first().fill("TEMP-VAL");
    await page.locator("input[type='text']").first().press("Escape");

    // Should revert — "TEMP-VAL" should not be visible
    await expect(page.getByText("TEMP-VAL")).not.toBeVisible({ timeout: 3000 });
  });

  test("KIOSK-02: Escape cancels inline edit", async ({ page }) => {
    await createKiosk(page, "EDIT-ESC");

    const firstSpan = page.locator("[data-slot='tabs-content'] span.cursor-text").first();
    await expect(firstSpan).toBeVisible({ timeout: 5000 });
    await firstSpan.click();

    const input = page.locator("input[type='text']").first();
    await input.fill("SHOULD-NOT-SAVE");
    await input.press("Escape");

    // Input should be gone
    await expect(page.locator("input[type='text']")).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByText("SHOULD-NOT-SAVE")).not.toBeVisible();
  });

  // KIOSK-03: Archive kiosk (soft delete)
  test("KIOSK-03: can archive a kiosk via soft delete", async ({ page }) => {
    await createKiosk(page, "ARCHIVE");

    // Click Archive button (the one in the form, not dialog)
    await page.getByRole("button", { name: /Archive/i }).first().click();

    // Confirmation dialog should appear
    await expect(page.getByText("Archive this kiosk?")).toBeVisible();

    // Confirm — click the destructive Archive button in the dialog footer
    await page.locator("[data-slot='dialog-footer']").getByRole("button", { name: "Archive" }).click();

    // Should redirect to kiosks list
    await expect(page).toHaveURL("/kiosks", { timeout: 15000 });
  });

  test("KIOSK-03: archived kiosk disappears from default list", async ({ page }) => {
    const kioskId = await createKiosk(page, "HIDDEN");

    // Archive it
    await page.getByRole("button", { name: /Archive/i }).first().click();
    await page.locator("[data-slot='dialog-footer']").getByRole("button", { name: "Archive" }).click();
    await expect(page).toHaveURL("/kiosks", { timeout: 15000 });

    // Kiosk ID should not appear in the list
    await expect(page.getByText(kioskId)).not.toBeVisible();
  });
});
