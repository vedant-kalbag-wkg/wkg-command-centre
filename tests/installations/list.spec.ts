import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@installations installations list renders PageHeader with title and add button", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/installations");

  await expect(
    page.getByRole("heading", { name: "Installations", level: 1 })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /add installation/i }).first()
  ).toBeVisible();
});

test("@installations installations list shows either table rows or empty state", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/installations");

  // Either there is at least one data row OR the EmptyState copy renders.
  const tableRows = page.locator("table tbody tr");
  const emptyCopy = page.getByText(/no installations yet/i).first();

  await expect
    .poll(
      async () =>
        (await tableRows.count()) > 0 ||
        (await emptyCopy.isVisible().catch(() => false)),
      { timeout: 5000 }
    )
    .toBe(true);
});

test("@installations dark-mode class toggling does not throw", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/installations");

  // Confirm header rendered before toggling
  await expect(
    page.getByRole("heading", { name: "Installations", level: 1 })
  ).toBeVisible();

  // Toggle `dark` class on <html> and verify nothing crashes + header remains.
  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Installations", level: 1 })
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Installations", level: 1 })
  ).toBeVisible();
});
