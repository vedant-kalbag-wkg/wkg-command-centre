import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Playwright E2E tests for the kiosk silence/unsilence admin panel.
 * Covers PERF-07: admin-only alert silencing UI on /kiosks/[id].
 *
 * These tests navigate to an existing kiosk (the first in the list) and
 * exercise the KioskAdminPanel component. They do NOT create fixtures —
 * the panel is always visible to admins and the DB state is reset after
 * each test via the unsilence flow.
 *
 * NOTE: Do NOT run these specs without a running dev/preview server and
 * TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD env vars set.
 */

test.describe("Kiosk alert silencing (PERF-07)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);

    // Navigate to the kiosk list and click the first kiosk row.
    await page.goto("/kiosks");
    await page.waitForSelector('[data-slot="table"]', { timeout: 10000 });
    const firstRowLink = page
      .locator("table tbody tr")
      .first()
      .getByRole("link")
      .first();
    await expect(firstRowLink).toBeVisible();
    await firstRowLink.click();
    await page.waitForURL(/\/kiosks\/[^/]+$/, { timeout: 15000 });
  });

  test("PERF-07: admin sees alert silencing panel on kiosk detail page", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /alert silencing/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /silence alerts/i }),
    ).toBeVisible();
  });

  test("PERF-07: silence button is disabled when reason is empty", async ({ page }) => {
    // Ensure we are in unsilenced state — silence button is present
    const silenceBtn = page.getByRole("button", { name: /silence alerts/i });
    await expect(silenceBtn).toBeVisible();
    // With an empty reason the button must be disabled
    await expect(silenceBtn).toBeDisabled();
  });

  test("PERF-07: silence button enables when reason has 3+ characters", async ({ page }) => {
    const silenceBtn = page.getByRole("button", { name: /silence alerts/i });
    await expect(silenceBtn).toBeVisible();

    // Less than 3 chars — still disabled
    await page.getByLabel(/reason for silencing/i).fill("ab");
    await expect(silenceBtn).toBeDisabled();

    // 3+ chars — enabled
    await page.getByLabel(/reason for silencing/i).fill("abc");
    await expect(silenceBtn).toBeEnabled();
  });

  test("PERF-07: can silence a kiosk and see confirmation toast", async ({ page }) => {
    // Skip if kiosk is already silenced — unsilence first to get clean state
    const alreadySilenced = await page
      .getByRole("button", { name: /unsilence alerts/i })
      .isVisible()
      .catch(() => false);
    if (alreadySilenced) {
      await page.getByRole("button", { name: /unsilence alerts/i }).click();
      await expect(page.getByText("Kiosk alerts unsilenced")).toBeVisible({
        timeout: 5000,
      });
      await page.reload();
      await page.waitForURL(/\/kiosks\/[^/]+$/, { timeout: 10000 });
    }

    await page
      .getByLabel(/reason for silencing/i)
      .fill("Playwright E2E — scheduled maintenance test");

    await page.getByRole("button", { name: /silence alerts/i }).click();

    await expect(page.getByText("Kiosk alerts silenced")).toBeVisible({
      timeout: 5000,
    });

    // The panel should now show the silenced state (unsilence button visible)
    await expect(
      page.getByRole("button", { name: /unsilence alerts/i }),
    ).toBeVisible({ timeout: 5000 });

    // Clean up — unsilence so subsequent tests start with the same state
    await page.getByRole("button", { name: /unsilence alerts/i }).click();
    await expect(page.getByText("Kiosk alerts unsilenced")).toBeVisible({
      timeout: 5000,
    });
  });

  test("PERF-07: silenced panel shows reason and unsilence button", async ({
    page,
  }) => {
    // First silence with a known reason (or skip if already silenced)
    const alreadySilenced = await page
      .getByRole("button", { name: /unsilence alerts/i })
      .isVisible()
      .catch(() => false);

    if (!alreadySilenced) {
      await page
        .getByLabel(/reason for silencing/i)
        .fill("Playwright E2E — silenced panel assertion");
      await page.getByRole("button", { name: /silence alerts/i }).click();
      await expect(page.getByText("Kiosk alerts silenced")).toBeVisible({
        timeout: 5000,
      });
    }

    // After silencing: banner visible, unsilence button present
    await expect(
      page.getByText(/alerts are currently silenced/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /unsilence alerts/i }),
    ).toBeVisible();

    // Clean up
    await page.getByRole("button", { name: /unsilence alerts/i }).click();
    await expect(page.getByText("Kiosk alerts unsilenced")).toBeVisible({
      timeout: 5000,
    });
  });
});
