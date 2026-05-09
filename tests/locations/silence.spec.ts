import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Playwright E2E tests for the per-hotel alert silence/unsilence admin panel.
 * Covers PERF-07 (hotel-level rewrite): admin-only alert silencing UI on
 * /locations/[id]. Replaces the deleted tests/kiosks/silence.spec.ts.
 *
 * Creates a throwaway location per run so the panel has a predictable target
 * (the first row of the seeded /locations list might not match across
 * preview deploys). The location is left in the DB after the test — same
 * pattern as the existing inline-edit specs.
 *
 * NOTE: Do NOT run these specs without a running dev/preview server and
 * TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD env vars set.
 */

async function createThrowawayLocation(
  page: Parameters<typeof signInAsAdmin>[0],
  prefix: string,
): Promise<string> {
  await page.goto("/locations/new");
  const name = `${prefix}-${Date.now()}`;
  await page.getByPlaceholder("e.g. The Grand Hotel").fill(name);
  await page.getByRole("button", { name: "Create location" }).click();
  await expect(page).toHaveURL(/\/locations\/[0-9a-f-]+$/, { timeout: 15000 });
  const match = page.url().match(/\/locations\/([0-9a-f-]+)$/);
  return match ? match[1] : "";
}

test.describe("Hotel alert silencing (PERF-07, hotel-level)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
    await createThrowawayLocation(page, "silence-uat");
    // Already on /locations/<id> after creation.
  });

  test("PERF-07: admin sees alert silencing panel on location detail page", async ({ page }) => {
    await expect(
      page.getByText(/alert silencing \(admin only\)/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /silence alerts/i }),
    ).toBeVisible();
  });

  test("PERF-07: silence button is disabled when reason is empty", async ({ page }) => {
    const silenceBtn = page.getByRole("button", { name: /silence alerts/i });
    await expect(silenceBtn).toBeVisible();
    await expect(silenceBtn).toBeDisabled();
  });

  test("PERF-07: silence button enables when reason has 3+ characters", async ({ page }) => {
    const silenceBtn = page.getByRole("button", { name: /silence alerts/i });
    await expect(silenceBtn).toBeVisible();

    await page.getByLabel(/reason for silencing/i).fill("ab");
    await expect(silenceBtn).toBeDisabled();

    await page.getByLabel(/reason for silencing/i).fill("abc");
    await expect(silenceBtn).toBeEnabled();
  });

  test("PERF-07: can silence a hotel and see confirmation toast", async ({ page }) => {
    await page
      .getByLabel(/reason for silencing/i)
      .fill("Playwright E2E — scheduled maintenance test");

    await page.getByRole("button", { name: /silence alerts/i }).click();

    await expect(page.getByText("Hotel alerts silenced")).toBeVisible({
      timeout: 5000,
    });

    // Panel should now show the silenced state (unsilence button visible)
    await expect(
      page.getByRole("button", { name: /unsilence alerts/i }),
    ).toBeVisible({ timeout: 5000 });

    // Clean up — unsilence so subsequent runs start clean
    await page.getByRole("button", { name: /unsilence alerts/i }).click();
    await expect(page.getByText("Hotel alerts unsilenced")).toBeVisible({
      timeout: 5000,
    });
  });

  test("PERF-07: silenced panel shows reason and unsilence button", async ({
    page,
  }) => {
    await page
      .getByLabel(/reason for silencing/i)
      .fill("Playwright E2E — silenced panel assertion");
    await page.getByRole("button", { name: /silence alerts/i }).click();
    await expect(page.getByText("Hotel alerts silenced")).toBeVisible({
      timeout: 5000,
    });

    await expect(
      page.getByText(/alerts are currently silenced/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /unsilence alerts/i }),
    ).toBeVisible();

    // Clean up
    await page.getByRole("button", { name: /unsilence alerts/i }).click();
    await expect(page.getByText("Hotel alerts unsilenced")).toBeVisible({
      timeout: 5000,
    });
  });
});
