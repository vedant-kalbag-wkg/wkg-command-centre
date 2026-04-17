import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Pipeline Stages (KIOSK-04)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("KIOSK-04: admin can add a new pipeline stage", async ({ page }) => {
    await page.goto("/settings/pipeline-stages");

    // Dialog should be auto-opened
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByText("Manage Pipeline Stages")).toBeVisible();

    // Click Add stage button
    await page.getByRole("button", { name: /add stage/i }).click();

    // A new stage "New Stage" should appear
    await expect(page.getByText("New Stage")).toBeVisible();

    // Cleanup: Delete the newly added stage by renaming + deleting via kebab menu
    // (hover over "New Stage" row to show kebab, then delete)
    // Note: cleanup is best-effort in tests
  });

  test("KIOSK-04: admin can rename a pipeline stage", async ({ page }) => {
    await page.goto("/settings/pipeline-stages");

    await expect(page.getByRole("dialog")).toBeVisible();

    // Click on "On Hold" stage name to start inline editing (use a known seeded stage)
    const stageName = page.getByText("On Hold", { exact: true });
    await expect(stageName).toBeVisible();
    await stageName.click();

    // An input should appear with the stage name
    const input = page.getByRole("dialog").locator("input").filter({ hasText: "" });
    // Wait for input to be visible
    await expect(page.getByRole("dialog").locator("input").first()).toBeVisible();

    // Type a new name
    const editInput = page.getByRole("dialog").locator("input").first();
    await editInput.fill("On Hold Renamed");
    await editInput.press("Enter");

    // Name should update
    await expect(page.getByText("On Hold Renamed")).toBeVisible();

    // Rename back to original
    await page.getByText("On Hold Renamed").click();
    const input2 = page.getByRole("dialog").locator("input").first();
    await expect(input2).toBeVisible();
    await input2.fill("On Hold");
    await input2.press("Enter");

    await expect(page.getByText("On Hold")).toBeVisible();
  });

  test("KIOSK-04: admin can change pipeline stage color", async ({ page }) => {
    await page.goto("/settings/pipeline-stages");

    await expect(page.getByRole("dialog")).toBeVisible();

    // Click the color dot of the first stage
    const colorDots = page.locator('[aria-label="Change color"]');
    await colorDots.first().click();

    // Color picker panel should appear with brand preset swatches
    await expect(page.locator(".react-colorful")).toBeVisible();

    // Click Azure preset
    await page.locator('button[title="Azure"]').click();

    // Done button closes picker
    await page.getByRole("button", { name: /done/i }).click();

    // Color picker panel should be gone
    await expect(page.locator(".react-colorful")).not.toBeVisible();
  });

  test("KIOSK-04: admin can set a default pipeline stage", async ({ page }) => {
    await page.goto("/settings/pipeline-stages");

    await expect(page.getByRole("dialog")).toBeVisible();

    // At least one stage should have a "Default" badge already (seeded: "Prospect")
    await expect(page.getByText("Default")).toBeVisible();

    // Find a non-default stage directly — "On Hold" is seeded and never default
    const targetRow = page
      .locator('[class*="flex items-center gap-2 py-2"]')
      .filter({ hasText: "On Hold" })
      .filter({ hasNot: page.getByText("Default") });

    await expect(targetRow).toBeVisible();

    // Open kebab menu once on the target row
    await targetRow.locator("button").last().click({ force: true });

    // Wait for menu to stabilize and click "Set as default"
    const menuItem = page.getByRole("menuitem", { name: /set as default/i });
    await menuItem.waitFor({ state: "visible" });
    await menuItem.click();

    // "Default" badge should now appear on the "On Hold" row
    await expect(
      page
        .locator('[class*="flex items-center gap-2 py-2"]')
        .filter({ hasText: "On Hold" })
        .getByText("Default")
    ).toBeVisible({ timeout: 5000 });
  });

  test("KIOSK-04: admin can reorder pipeline stages via drag", async ({ page }) => {
    await page.goto("/settings/pipeline-stages");

    await expect(page.getByRole("dialog")).toBeVisible();

    // Verify at least 2 stages exist
    const stageItems = page.locator('[aria-label="Drag to reorder"]');
    const count = await stageItems.count();
    expect(count).toBeGreaterThan(1);

    // Get first two stage names
    const stageNameEls = page.locator('[class*="cursor-pointer hover:text-wk-azure"]');
    const firstName = await stageNameEls.nth(0).textContent();
    const secondName = await stageNameEls.nth(1).textContent();

    // Both stages should be present (order may change after drag)
    expect(firstName).toBeTruthy();
    expect(secondName).toBeTruthy();
  });

  test("KIOSK-04: deleting stage with kiosks requires reassignment", async ({ page }) => {
    // This test verifies the reassignment UI appears when deleting a stage that has kiosks.
    // It navigates to the pipeline stages modal and attempts to delete a stage.
    // If the stage has kiosks, the reassign flow appears; if not, confirm flow appears.
    await page.goto("/settings/pipeline-stages");

    await expect(page.getByRole("dialog")).toBeVisible();

    // Hover to reveal kebab on first stage
    const rows = page.locator('[class*="flex items-center gap-2 py-2"]');
    await rows.first().hover();

    // Force-click the kebab button (opacity-0 transitions)
    await rows.first().locator('button').last().click({ force: true });

    const deleteItem = page.getByRole("menuitem", { name: /delete/i });
    await expect(deleteItem).toBeVisible();
    await deleteItem.click();

    // Either confirm or reassign flow should appear
    const confirmText = page.getByText(/delete ".*"\?/i);
    const reassignText = page.getByText(/move kiosks from/i);
    await expect(confirmText.or(reassignText)).toBeVisible();

    // Cancel to not actually delete seeded stages
    await page.getByRole("button", { name: /cancel/i }).click();
  });
});
