import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@kiosks kiosk detail renders PageHeader with breadcrumb and archive action", async ({
  page,
}) => {
  await signInAsAdmin(page);

  // Navigate via the list — pick the first existing kiosk row instead of
  // creating test data (avoids orphans).
  await page.goto("/kiosks");
  const firstRowLink = page
    .locator("table tbody tr")
    .first()
    .getByRole("link")
    .first();
  await expect(firstRowLink).toBeVisible();
  await firstRowLink.click();

  await page.waitForURL(/\/kiosks\/[^/]+$/, { timeout: 10000 });

  // Heading is the kiosk id / name
  await expect(page.locator("h1")).toBeVisible();
  // Breadcrumb back-link
  await expect(page.getByRole("link", { name: "Kiosks" }).first()).toBeVisible();
  // Archive action lives in the header now (via KioskDetailActions)
  await expect(
    page.getByRole("button", { name: /archive kiosk/i })
  ).toBeVisible();
});
