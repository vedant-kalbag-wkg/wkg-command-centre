import { type Page } from "@playwright/test";

/**
 * Shared auth test utilities.
 *
 * The admin test user is seeded via `npm run db:seed` which creates:
 *   email: admin@weknow.co
 *   password: Admin123!
 *   role: admin
 */
export const TEST_ADMIN = {
  email: "admin@weknow.co",
  password: "Admin123!",
  name: "Admin User",
  role: "admin",
} as const;

/**
 * Sign in programmatically via the login form.
 * Waits for redirect to /kiosks after successful sign-in.
 */
export async function signInAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(TEST_ADMIN.email);
  await page.locator("#password").fill(TEST_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/kiosks", { timeout: 10000 });
}
