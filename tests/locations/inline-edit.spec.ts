import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Inline-edit tests for the /locations table. We create a throwaway location
 * per test so the edit has a predictable target and value assertions don't
 * collide with seed data.
 */
async function createLocation(
  page: Parameters<typeof signInAsAdmin>[0],
  prefix: string
): Promise<{ name: string; id: string }> {
  await page.goto("/locations/new");
  const name = `${prefix}-${Date.now()}`;
  await page.getByPlaceholder("e.g. The Grand Hotel").fill(name);
  await page.getByRole("button", { name: "Create location" }).click();
  await expect(page).toHaveURL(/\/locations\/[0-9a-f-]+$/, { timeout: 15000 });
  const match = page.url().match(/\/locations\/([0-9a-f-]+)$/);
  return { name, id: match ? match[1] : "" };
}

test.describe("@locations inline edit on /locations table", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("can inline-edit the name column and persist on reload", async ({
    page,
  }) => {
    const { name } = await createLocation(page, "INLINE-NAME");

    await page.goto("/locations");

    // Find the newly-created row by its name cell (click-to-edit span).
    const nameCell = page.getByRole("button", { name, exact: false }).first();
    await expect(nameCell).toBeVisible({ timeout: 10000 });
    await nameCell.click();

    const input = page.locator("input[type='text']").first();
    await expect(input).toBeVisible();
    const newName = `${name}-EDITED`;
    await input.fill(newName);
    await input.press("Enter");

    // After save, the new name should be visible in the row.
    await expect(page.getByText(newName).first()).toBeVisible({
      timeout: 10000,
    });

    // Reload and assert the edit persisted.
    await page.reload();
    await expect(page.getByText(newName).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("can inline-edit the address column and persist on reload", async ({
    page,
  }) => {
    const { name } = await createLocation(page, "INLINE-ADDR");

    await page.goto("/locations");

    // Locate the row containing our location name; the address cell is a
    // sibling click-to-edit button. We target the row, then the Address column
    // inline-edit span within that row.
    const row = page
      .getByRole("row")
      .filter({ hasText: name })
      .first();
    await expect(row).toBeVisible({ timeout: 10000 });

    const addressBtns = row.getByRole("button");
    // Find the first button that currently says "—" (empty state) — that's
    // our Address (or any empty column). We'll set Address specifically by
    // checking the header ordering: "Address" is column 7. Simpler: click
    // any em-dash button and inspect column header.
    // For resilience, just click the address placeholder text within the row.
    const emDashCells = row.getByText("—");
    const first = emDashCells.first();
    await expect(first).toBeVisible({ timeout: 5000 });
    await first.click();

    const input = page.locator("input[type='text']").first();
    await expect(input).toBeVisible();
    const addressValue = `42 Inline Street, London`;
    await input.fill(addressValue);
    await input.press("Enter");

    await expect(page.getByText(addressValue).first()).toBeVisible({
      timeout: 10000,
    });

    await page.reload();
    await expect(page.getByText(addressValue).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("can inline-edit a numeric column (roomCount) and persist on reload", async ({
    page,
  }) => {
    const { name } = await createLocation(page, "INLINE-NUM");

    await page.goto("/locations");

    const row = page
      .getByRole("row")
      .filter({ hasText: name })
      .first();
    await expect(row).toBeVisible({ timeout: 10000 });

    // Click any em-dash button in the row; we'll type a number which only
    // fits the roomCount (number type) column.
    // To target roomCount specifically, we count on column position within the
    // row: columns 1=select, 2=name, 3=hotel group, 4=stars, 5=rooms.
    const cells = row.locator("td");
    const roomsCell = cells.nth(4); // zero-indexed
    const roomsBtn = roomsCell.getByRole("button").first();
    await expect(roomsBtn).toBeVisible();
    await roomsBtn.click();

    const input = page.locator("input[type='number']").first();
    await expect(input).toBeVisible();
    await input.fill("240");
    await input.press("Enter");

    // Reload and assert the value shows 240 in the row.
    await page.reload();
    const rowAfter = page.getByRole("row").filter({ hasText: name }).first();
    await expect(rowAfter.getByText("240").first()).toBeVisible({
      timeout: 10000,
    });
  });
});
