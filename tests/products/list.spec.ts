import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@products products list renders with header, table-or-empty, and add button", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/products");

  // PageHeader title (h1)
  await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();

  // Primary action (Add product button)
  await expect(page.getByRole("button", { name: /add product/i }).first()).toBeVisible();

  // Either the table renders OR the empty state renders
  const table = page.getByRole("table");
  const emptyState = page.getByText(/no products yet/i);
  await expect
    .poll(
      async () =>
        (await table.isVisible().catch(() => false)) ||
        (await emptyState.isVisible().catch(() => false)),
      { timeout: 5000 },
    )
    .toBe(true);
});

test("@products products list dark-mode toggle does not throw", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await signInAsAdmin(page);
  await page.goto("/products");
  await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();

  // Toggle dark mode by adding/removing the `dark` class on <html>.
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
  });
  await page.waitForTimeout(200);

  // Header still renders after class flips.
  await expect(page.getByRole("heading", { name: "Products", level: 1 })).toBeVisible();

  // No uncaught errors triggered BY the dark-mode toggle itself.
  const fatal = consoleErrors.filter(
    (e) =>
      !/favicon|ResizeObserver loop/i.test(e) &&
      !/Hydration failed because/i.test(e) &&
      !/Failed to fetch/i.test(e) &&
      !/Can't perform a React state update/i.test(e),
  );
  expect(fatal).toEqual([]);
});
