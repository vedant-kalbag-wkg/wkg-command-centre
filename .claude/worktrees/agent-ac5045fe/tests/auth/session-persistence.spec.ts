import { test, expect } from "@playwright/test";

test.describe("Session persistence", () => {
  test("@smoke session persists after page reload", async ({ page }) => {
    // Sign in
    await page.goto("/login");
    await page.getByLabel("Email address").fill("admin@weknow.co");
    await page.locator("#password").fill("Admin123!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/kiosks/, { timeout: 10000 });

    // Reload the page
    await page.reload();

    // Should still be on /kiosks (not redirected to /login)
    await expect(page).toHaveURL(/\/kiosks/, { timeout: 10000 });
  });
});
