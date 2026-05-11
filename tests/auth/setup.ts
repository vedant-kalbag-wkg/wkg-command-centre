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
 * Test fixture user for ops-it tier (v1.0 'member' parity).
 * Seeded by `scripts/seed-test-users.ts` against test/preview DBs.
 * Defaults match the seed script — override via env vars on Vercel preview.
 */
export const TEST_OPS_IT = {
  email: process.env.TEST_OPS_IT_EMAIL ?? "ops-it.test@weknowgroup.com",
  password: process.env.TEST_OPS_IT_PASSWORD ?? "OpsItTest!2026",
  name: "Test Ops-IT",
  role: "member",
} as const;

/**
 * Test fixture user for read-only tier (v1.0 'viewer' parity).
 * Seeded by `scripts/seed-test-users.ts` against test/preview DBs.
 * Defaults match the seed script — override via env vars on Vercel preview.
 */
export const TEST_VIEWER = {
  email: process.env.TEST_VIEWER_EMAIL ?? "viewer.test@weknowgroup.com",
  password: process.env.TEST_VIEWER_PASSWORD ?? "ViewerTest!2026",
  name: "Test Viewer",
  role: "viewer",
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
