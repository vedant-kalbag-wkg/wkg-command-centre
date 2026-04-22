import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("@admin/cache purge", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("admin can purge portfolio cache and see audit log entry", async ({ page }) => {
    await page.goto("/admin/cache");
    await expect(page.getByRole("heading", { name: /cache management/i })).toBeVisible();

    // Open scope dropdown, select Portfolio
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: "Portfolio" }).click();

    // Click purge
    await page.getByRole("button", { name: /purge/i }).click();

    // Toast confirms success
    await expect(page.getByText(/purged analytics:portfolio/i)).toBeVisible({ timeout: 5000 });

    // Reload — audit log should now include the purge
    await page.reload();
    await expect(page.getByText("analytics:portfolio").first()).toBeVisible({ timeout: 5000 });
  });
});
