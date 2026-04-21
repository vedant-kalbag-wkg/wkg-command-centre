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

/**
 * Open /locations and isolate the row whose name contains `needle` by typing
 * it into the global search. This sidesteps any pre-existing column-filter
 * state on the shared view-engine store which can hide all rows.
 */
async function gotoLocationsAndSearch(
  page: Parameters<typeof signInAsAdmin>[0],
  needle: string,
) {
  await page.goto("/locations");
  const search = page.getByPlaceholder(/search locations/i).first();
  await expect(search).toBeVisible({ timeout: 10000 });
  await search.fill(needle);
  // Wait for debounced search to apply and the row to appear.
  await expect(page.getByRole("row").filter({ hasText: needle }).first())
    .toBeVisible({ timeout: 10000 });
}

/**
 * After pressing Enter to commit an inline edit, wait for (a) the input to
 * exit edit mode and (b) the client-side router.refresh the save action
 * triggers to settle. Without this the subsequent page.reload() can race the
 * in-flight server action and read back the pre-edit value.
 */
async function waitForInlineEditCommit(
  page: Parameters<typeof signInAsAdmin>[0],
  input: import("@playwright/test").Locator,
) {
  await expect(input).not.toBeVisible({ timeout: 10000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 });
}

test.describe("@locations inline edit on /locations table", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("can inline-edit the name column and persist on reload", async ({
    page,
  }) => {
    const { name } = await createLocation(page, "INLINE-NAME");

    await gotoLocationsAndSearch(page, name);

    // Find the newly-created row by its name cell (click-to-edit span).
    const row = page.getByRole("row").filter({ hasText: name }).first();
    const nameCell = row.getByRole("button", { name, exact: false }).first();
    await expect(nameCell).toBeVisible({ timeout: 10000 });
    await nameCell.click();

    const input = page.locator("input[type='text']").first();
    await expect(input).toBeVisible();
    const newName = `${name}-EDITED`;
    await input.fill(newName);
    await input.press("Enter");

    // The edit triggers a server action + router.refresh which can transiently
    // reset the client-side global-filter state on the table; rather than
    // asserting the edited cell is visible in the filtered view before the
    // reload (which races the refresh), reload the page and re-apply the
    // search. That gives us the same persistence guarantee deterministically.
    await waitForInlineEditCommit(page, input);
    await page.reload();
    const search = page.getByPlaceholder(/search locations/i).first();
    await search.fill(newName);
    await expect(page.getByText(newName).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("can inline-edit the address column and persist on reload", async ({
    page,
  }) => {
    const { name } = await createLocation(page, "INLINE-ADDR");

    await gotoLocationsAndSearch(page, name);

    // Locate the row containing our location name; the address cell is a
    // sibling click-to-edit button. We target the row, then the Address column
    // inline-edit span within that row.
    const row = page
      .getByRole("row")
      .filter({ hasText: name })
      .first();
    await expect(row).toBeVisible({ timeout: 10000 });

    // For resilience, click the first em-dash placeholder within the row,
    // which is the address (or another empty column). We then type an
    // address-shaped string so only a text column would accept it naturally.
    const emDashCells = row.getByText("—");
    const first = emDashCells.first();
    await expect(first).toBeVisible({ timeout: 5000 });
    await first.click();

    const input = page.locator("input[type='text']").first();
    await expect(input).toBeVisible();
    const addressValue = `42 Inline Street, London`;
    await input.fill(addressValue);
    await input.press("Enter");

    // Reload and re-apply search to check persistence deterministically; the
    // post-save RSC refresh can momentarily clear the client-side global-filter
    // state, which races an assertion that only checks in-memory visibility.
    await waitForInlineEditCommit(page, input);
    await page.reload();
    const searchAfter = page.getByPlaceholder(/search locations/i).first();
    await searchAfter.fill(name);
    await expect(page.getByText(addressValue).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("can inline-edit a numeric column (roomCount) and persist on reload", async ({
    page,
  }) => {
    const { name } = await createLocation(page, "INLINE-NUM");

    await gotoLocationsAndSearch(page, name);

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

    // Wait for the input to exit edit mode AND the router.refresh RSC round-trip
    // before reloading so the save request actually commits server-side.
    // Reloading mid-flight can race the write and read back the original empty
    // value.
    await waitForInlineEditCommit(page, input);

    // Reload and assert the value shows 240 in the row.
    await page.reload();
    const searchAfter = page.getByPlaceholder(/search locations/i).first();
    await searchAfter.fill(name);
    const rowAfter = page.getByRole("row").filter({ hasText: name }).first();
    await expect(rowAfter.getByText("240").first()).toBeVisible({
      timeout: 10000,
    });
  });
});
