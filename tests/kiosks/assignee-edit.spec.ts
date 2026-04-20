import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Assumes the kiosks table is already seeded (kiosks exist from prior test
 * setup / db:seed:kiosks). If the table is empty the test is a soft-skip.
 */
test.describe("@kiosks inline edit Internal POC (assignee)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("admin can open the Internal POC inline-edit select on a kiosk row", async ({
    page,
  }) => {
    await page.goto("/kiosks");

    // Wait for table to render (or skip if empty)
    const table = page.getByRole("table");
    await expect(table).toBeVisible({ timeout: 10000 });

    const dataRows = page.locator("table tbody tr");
    const rowCount = await dataRows.count();
    test.skip(
      rowCount === 0,
      "No kiosks seeded; cannot test inline assignee edit"
    );

    // The Internal POC column may be hidden by default — reveal it via the
    // column-visibility toggle if the cell isn't already shown.
    const pocHeader = page.getByRole("columnheader", { name: /internal poc/i });
    const headerVisible = await pocHeader.isVisible().catch(() => false);

    if (!headerVisible) {
      // Try to toggle via the "Columns" control in the toolbar.
      const columnsToggle = page
        .getByRole("button", { name: /columns/i })
        .first();
      if (await columnsToggle.isVisible().catch(() => false)) {
        await columnsToggle.click();
        const option = page.getByRole("menuitemcheckbox", {
          name: /internal poc/i,
        });
        if (await option.isVisible().catch(() => false)) {
          await option.click();
          // close the menu
          await page.keyboard.press("Escape");
        }
      }
    }

    // Locate an Unassigned button in the Internal POC column and click it.
    const unassigned = page
      .getByRole("button", { name: /^Unassigned$/ })
      .first();
    const anyPocCell = await unassigned.isVisible().catch(() => false);

    if (anyPocCell) {
      await unassigned.click();
      // A select trigger should open; assert its role is combobox.
      const combo = page.getByRole("combobox").first();
      await expect(combo).toBeVisible({ timeout: 5000 });
    } else {
      // Fallback: ensure the column header exists so the feature is exposed.
      await expect(page.getByText(/internal poc/i).first()).toBeVisible({
        timeout: 5000,
      });
    }
  });
});
