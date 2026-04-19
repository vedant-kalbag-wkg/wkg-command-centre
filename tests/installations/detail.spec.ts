import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@installations installation detail renders PageHeader with breadcrumb + delete action", async ({
  page,
}) => {
  await signInAsAdmin(page);

  // Create a lightweight test installation via the UI so we have something
  // to navigate to — the sweep is presentation-only, so we rely on
  // the existing create flow.
  const testName = `UI-KIT-DETAIL-${Date.now()}`;
  await page.goto("/installations/new");
  await page.getByLabel(/name/i).first().fill(testName);
  await page.getByRole("button", { name: /create installation/i }).click();

  // Should redirect to the detail page.
  await page.waitForURL(/\/installations\/[^/]+$/, { timeout: 10000 });

  // Heading (title in PageHeader)
  await expect(page.getByRole("heading", { name: testName, level: 1 })).toBeVisible();

  // Breadcrumb back-link to Installations list
  await expect(
    page.getByRole("link", { name: /installations/i }).first()
  ).toBeVisible();

  // Delete action in the header
  await expect(
    page.getByRole("button", { name: /delete installation/i })
  ).toBeVisible();
});
