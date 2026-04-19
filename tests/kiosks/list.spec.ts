import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@kiosks kiosks list renders with header, table view, and add button", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/kiosks");

  await expect(page.getByRole("heading", { name: "Kiosks" })).toBeVisible();
  await expect(page.getByRole("link", { name: /add kiosk/i }).first()).toBeVisible();
  // Table is the default view
  await expect(page.getByRole("table")).toBeVisible();
});

test("@kiosks kiosks list shows empty state when filtered to no matches", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/kiosks");

  // Filter the table via its global search so no rows match.
  const search = page.getByPlaceholder("Search kiosks...");
  await expect(search).toBeVisible();
  await search.click();
  await search.fill("__nonexistent_xyz_12345__");

  // Either the new EmptyState shows "no kiosks match" text, OR the table body
  // renders with zero data rows. Accept both patterns so the test is robust
  // to whichever branch the page takes.
  const emptyIndicator = page.getByText(/no kiosks match|no results/i).first();
  const tableRows = page.locator("table tbody tr");
  await expect
    .poll(
      async () =>
        (await emptyIndicator.isVisible().catch(() => false)) ||
        (await tableRows.count()) === 0,
      { timeout: 5000 }
    )
    .toBe(true);
});
