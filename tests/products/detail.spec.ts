import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@products product detail renders PageHeader with breadcrumb", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/products");

  // Wait for the heading first so we know the page rendered.
  await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();

  // If there are no products, skip — this test requires an existing product.
  const hasEmpty = await page
    .getByText(/no products yet/i)
    .isVisible()
    .catch(() => false);
  test.skip(hasEmpty, "No products seeded — cannot test detail page");

  // Navigate by clicking the first data row in the products table.
  const firstRow = page.locator("table tbody tr").first();
  await expect(firstRow).toBeVisible();

  // Grab the product name from the first cell before navigating so we can
  // assert the PageHeader shows it.
  const firstCell = firstRow.locator("td").first();
  const productName = (await firstCell.textContent())?.trim() ?? "";
  expect(productName.length).toBeGreaterThan(0);

  await firstRow.click();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]+$/, { timeout: 10000 });

  // PageHeader title uses the product name (h1)
  await expect(
    page.getByRole("heading", { name: productName, level: 1 }),
  ).toBeVisible();

  // Breadcrumb back-link to Products list
  await expect(
    page.getByRole("link", { name: /^products$/i }).first(),
  ).toBeVisible();

  // Either the hotels table or the empty state is visible
  const table = page.getByRole("table");
  const emptyState = page.getByText(/no hotels configured/i);
  await expect
    .poll(
      async () =>
        (await table.isVisible().catch(() => false)) ||
        (await emptyState.isVisible().catch(() => false)),
      { timeout: 5000 },
    )
    .toBe(true);
});
