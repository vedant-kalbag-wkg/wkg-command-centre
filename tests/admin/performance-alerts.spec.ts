import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("@admin/performance-alerts", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("admin can view performance-alerts page and trigger a manual run", async ({ page }) => {
    await page.goto("/admin/performance-alerts");
    await expect(
      page.getByRole("heading", { name: /performance alerts/i }),
    ).toBeVisible();

    // "Run now" button is present and enabled initially.
    const runNowBtn = page.getByRole("button", { name: /run now/i });
    await expect(runNowBtn).toBeVisible();
    await expect(runNowBtn).toBeEnabled();

    // Trigger the run.
    await runNowBtn.click();

    // Success toast confirms the event was queued.
    await expect(page.getByText(/run queued/i)).toBeVisible({ timeout: 10_000 });

    // Reload — recent-runs list should now show the manual trigger entry.
    await page.reload();
    await expect(page.getByText(/manual run trigger/i).first()).toBeVisible({
      timeout: 5_000,
    });
  });
});
