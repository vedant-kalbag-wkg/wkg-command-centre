import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@products row click navigates to product detail", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/products");

  await expect(
    page.getByRole("heading", { name: "Products", level: 1 }),
  ).toBeVisible();

  // Skip if the empty state is showing (no product data seeded).
  if (await page.getByText(/no products yet/i).isVisible().catch(() => false)) {
    test.skip(true, "No products seeded");
  }

  const firstRow = page.getByRole("table").locator("tbody tr").first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();

  await expect(page).toHaveURL(/\/products\/[^/]+$/);
});

test("@products edit action navigates to detail without stale toast", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/products");

  if (await page.getByText(/no products yet/i).isVisible().catch(() => false)) {
    test.skip(true, "No products seeded");
  }

  const editButton = page
    .getByRole("button", { name: /edit product/i })
    .first();
  await expect(editButton).toBeVisible();
  await editButton.click();

  await expect(page).toHaveURL(/\/products\/[^/]+$/);
  await expect(page.getByText(/coming soon/i)).toHaveCount(0);
});
