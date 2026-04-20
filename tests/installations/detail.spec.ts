import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@installations installation detail renders PageHeader with breadcrumb + delete action", async ({
  page,
}) => {
  await signInAsAdmin(page);

  // Navigate via the list — pick the first existing installation row instead
  // of creating test data (avoids orphans). Mirrors the kiosk detail spec.
  await page.goto("/installations");
  const firstRow = page.locator("table tbody tr").first();
  if (!(await firstRow.isVisible().catch(() => false))) {
    test.skip(true, "No installations seeded");
  }

  const firstRowLink = firstRow.getByRole("link").first();
  await expect(firstRowLink).toBeVisible();
  await firstRowLink.click();

  await page.waitForURL(/\/installations\/[^/]+$/, { timeout: 10000 });

  // Heading (title in PageHeader)
  await expect(page.locator("h1")).toBeVisible();

  // Breadcrumb back-link to Installations list
  await expect(
    page.getByRole("link", { name: /installations/i }).first()
  ).toBeVisible();

  // Delete action in the header
  await expect(
    page.getByRole("button", { name: /delete installation/i })
  ).toBeVisible();
});
