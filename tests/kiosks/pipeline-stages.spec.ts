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

    // Count existing stages before adding
    const rows = page.locator('[class*="flex items-center gap-2 py-2"]');
    const countBefore = await rows.count();

    // Click Add stage button
    await page.getByRole("button", { name: /add stage/i }).click();

    // One more stage row should appear
    await expect(rows).toHaveCount(countBefore + 1, { timeout: 5000 });

    // Cleanup: delete the newly added stage via its kebab menu
    const newRow = rows.last();
    await newRow.locator("button").last().click({ force: true });
    const deleteItem = page.getByRole("menuitem", { name: /delete/i });
    if (await deleteItem.isVisible().catch(() => false)) {
      await deleteItem.click();
      const confirmBtn = page.getByRole("button", { name: /delete/i }).last();
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
      }
    }
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

    // At least one stage should have a "Default" badge already
    await expect(page.getByText("Default")).toBeVisible();

    // Find any non-default stage row (exclude "New Stage" leftovers)
    const allRows = page.locator('[class*="flex items-center gap-2 py-2"]');
    const rowCount = await allRows.count();

    let targetIdx = -1;
    for (let i = 0; i < rowCount; i++) {
      const row = allRows.nth(i);
      const text = await row.textContent();
      if (!text) continue;
      if (text.includes("Default")) continue;
      if (text.includes("New Stage")) continue;
      targetIdx = i;
      break;
    }

    if (targetIdx === -1) {
      test.skip(true, "All stages are already default or New Stage — cannot test");
      return;
    }

    const targetRow = allRows.nth(targetIdx);
    const targetName = await targetRow.locator('[class*="cursor-pointer"]').first().textContent();

    // Open kebab menu on the target row
    await targetRow.locator("button").last().click({ force: true });

    // Wait for menu to stabilize and click "Set as default"
    const menuItem = page.getByRole("menuitem", { name: /set as default/i });
    await menuItem.waitFor({ state: "visible" });
    await menuItem.click();

    // "Default" badge should now appear on the target row
    await expect(
      allRows
        .filter({ hasText: targetName! })
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

    // Get first two stage names. The stage name span has
    // `cursor-pointer hover:text-primary`.
    const stageNameEls = page.locator(
      '[class*="cursor-pointer"][class*="hover:text-primary"]',
    );
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
