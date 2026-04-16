import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Audit Log (AUDIT-01, AUDIT-02, AUDIT-03)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // AUDIT-02: Kiosk detail audit tab shows timeline
  test("AUDIT-02: kiosk detail audit tab shows timeline", async ({ page }) => {
    await page.goto("/kiosks");
    await page.waitForSelector("table", { timeout: 10000 });

    // Click on a kiosk row that has a detail link (kiosk ID cells link to /kiosks/[id])
    const kioskLinks = page.locator("table a[href*='/kiosks/']");
    const count = await kioskLinks.count();
    if (count === 0) {
      test.skip();
      return;
    }

    const href = await kioskLinks.first().getAttribute("href");
    if (!href || href === "/kiosks/new") {
      test.skip();
      return;
    }

    await page.goto(href);
    await page.waitForURL(`**${href}`, { timeout: 10000 });

    // Should have an Audit tab
    await expect(page.getByRole("tab", { name: "Audit" })).toBeVisible({ timeout: 8000 });
    await page.getByRole("tab", { name: "Audit" }).click();

    // Audit timeline should render
    await expect(
      page.locator("text=No activity yet").or(
        page.locator("[data-slot=avatar-fallback]")
      )
    ).toBeVisible({ timeout: 10000 });
  });

  test("AUDIT-02: location detail audit tab shows timeline", async ({ page }) => {
    await page.goto("/locations");
    await page.waitForSelector("table", { timeout: 10000 });

    const locationLinks = page.locator("table a[href*='/locations/']");
    const count = await locationLinks.count();
    if (count === 0) {
      test.skip();
      return;
    }

    const href = await locationLinks.first().getAttribute("href");
    if (!href || href === "/locations/new") {
      test.skip();
      return;
    }

    await page.goto(href);
    await page.waitForURL(`**${href}`, { timeout: 10000 });

    // Should have an Audit tab
    await expect(page.getByRole("tab", { name: "Audit" })).toBeVisible({ timeout: 8000 });
    await page.getByRole("tab", { name: "Audit" }).click();

    // Audit timeline should render
    await expect(
      page.locator("text=No activity yet").or(
        page.locator("[data-slot=avatar-fallback]")
      )
    ).toBeVisible({ timeout: 10000 });
  });

  // AUDIT-03: Global audit log
  test("AUDIT-03: admin can view global audit log at /settings/audit-log", async ({ page }) => {
    await page.goto("/settings/audit-log");
    // Should load the Audit Log page (not redirect away)
    await expect(page).toHaveURL(/audit-log/, { timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible({ timeout: 5000 });
  });

  test("AUDIT-03: audit log page has filter controls for User, Entity Type, and Date", async ({ page }) => {
    await page.goto("/settings/audit-log");
    await page.waitForURL(/audit-log/, { timeout: 10000 });

    // Wait for page to fully load
    await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible({ timeout: 5000 });

    // Should have User filter label
    await expect(page.getByText("User", { exact: true }).first()).toBeVisible({ timeout: 5000 });
    // Should have Entity Type filter label
    await expect(page.getByText("Entity Type", { exact: true })).toBeVisible({ timeout: 5000 });
    // Should have From date filter label
    await expect(page.getByText("From", { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test("AUDIT-03: settings page shows Audit Log card for admin", async ({ page }) => {
    await page.goto("/settings");
    // Wait for settings page to load
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 5000 });
    // Audit Log card should be visible for admins
    await expect(page.locator("a[href='/settings/audit-log']")).toBeVisible({ timeout: 5000 });
  });
});
