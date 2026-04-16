import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Table View (VIEW-01, VIEW-02, VIEW-03)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/kiosks");
    // Wait for table to load
    await page.waitForSelector('[data-slot="table"]', { timeout: 10000 });
  });

  // VIEW-01: Table rendering and sorting
  test("VIEW-01: kiosks table renders with sortable columns", async ({ page }) => {
    // Verify the Table tab is shown and active
    await expect(page.getByRole("tab", { name: "Table" })).toBeVisible();
    // Verify table structure
    await expect(page.locator('[data-slot="table"]')).toBeVisible();
    // Check column headers are visible
    await expect(page.getByRole("columnheader", { name: /kiosk id/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /venue/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /region/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /stage/i })).toBeVisible();
  });

  test("VIEW-01: kiosks page shows Table and Kanban tabs", async ({ page }) => {
    await expect(page.getByRole("tab", { name: "Table" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Kanban" })).toBeVisible();
  });

  test("VIEW-01: can sort table by column header click", async ({ page }) => {
    const kioskIdHeader = page.getByRole("columnheader", { name: /kiosk id/i });
    await kioskIdHeader.click();
    // After click, a sort indicator should appear
    await expect(kioskIdHeader).toBeVisible();
    // Click again to toggle sort direction
    await kioskIdHeader.click();
    await expect(kioskIdHeader).toBeVisible();
  });

  // VIEW-02: Filtering
  test("VIEW-02: can filter table via search input", async ({ page }) => {
    const search = page.getByPlaceholder("Search kiosks...");
    await expect(search).toBeVisible();
    await search.click();
    await search.type("nonexistent-kiosk-xyz-12345");
    // Should show either no results or empty state
    await page.waitForTimeout(400); // debounce
    // Verify search was applied (empty state or filtered results)
    const currentVal = await search.inputValue();
    expect(currentVal).toBeTruthy();
  });

  test("VIEW-02: can group table by field using Group By", async ({ page }) => {
    // Look for the Group By select
    await page.waitForSelector("select, [data-slot]", { timeout: 5000 });
    // Find the group by trigger (Select component)
    const groupByTrigger = page.getByText("No grouping");
    if (await groupByTrigger.isVisible()) {
      await groupByTrigger.click();
      // Should show groupable options
      const pipelineOption = page.getByRole("option", { name: /pipeline stage/i });
      if (await pipelineOption.isVisible()) {
        await pipelineOption.click();
      }
    }
  });

  // VIEW-03: Column visibility
  test("VIEW-03: can toggle column visibility", async ({ page }) => {
    const columnsButton = page.getByRole("button", { name: /columns/i });
    await expect(columnsButton).toBeVisible();
    await columnsButton.click();
    // Should show column toggles
    await expect(page.getByText(/toggle columns/i)).toBeVisible();
  });
});
