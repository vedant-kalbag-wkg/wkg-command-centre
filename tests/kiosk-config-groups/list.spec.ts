import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@kiosk-config-groups list renders PageHeader with title", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/kiosk-config-groups");

  await expect(
    page.getByRole("heading", { name: "Kiosk Config Groups", level: 1 })
  ).toBeVisible();
});

test("@kiosk-config-groups list shows either table rows or empty state", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/kiosk-config-groups");

  // Either there is at least one data row OR the EmptyState copy renders.
  const tableRows = page.locator("table tbody tr");
  const emptyCopy = page.getByText(/no config groups yet/i).first();

  await expect
    .poll(
      async () =>
        (await tableRows.count()) > 0 ||
        (await emptyCopy.isVisible().catch(() => false)),
      { timeout: 5000 }
    )
    .toBe(true);
});

test("@kiosk-config-groups dark-mode class toggling does not throw", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/kiosk-config-groups");

  // Confirm header rendered before toggling
  await expect(
    page.getByRole("heading", { name: "Kiosk Config Groups", level: 1 })
  ).toBeVisible();

  // Toggle `dark` class on <html> and verify nothing crashes + header remains.
  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Kiosk Config Groups", level: 1 })
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Kiosk Config Groups", level: 1 })
  ).toBeVisible();
});
