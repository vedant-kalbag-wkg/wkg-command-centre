import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Session persistence", () => {
  test("@smoke session persists after page reload", async ({ page }) => {
    await signInAsAdmin(page);
    await page.reload();

    // Should still be on /kiosks (not redirected to /login)
    await expect(page).toHaveURL(/\/kiosks/, { timeout: 10000 });
  });
});
