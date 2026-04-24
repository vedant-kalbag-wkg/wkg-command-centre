import { type Page } from "@playwright/test";

/**
 * Shared auth test utilities for Phase 2 tests.
 *
 * The admin test user is seeded via `npm run db:seed` which creates:
 *   email: admin@weknow.co
 *   password: Admin123!
 *   role: admin
 *
 * NOTE: The seed script does NOT create member or viewer users.
 * TODO: seed must create member/viewer test users
 * Until the seed is updated, these helpers will sign in as admin
 * and rely on admin-created member/viewer accounts being available.
 */
export const TEST_ADMIN = {
  email: process.env.TEST_ADMIN_EMAIL ?? "admin@weknow.co",
  password: process.env.TEST_ADMIN_PASSWORD ?? "TestAdmin123!",
  name: "Admin User",
  role: "admin",
} as const;

export const TEST_MEMBER = {
  email: "member@weknow.co",
  password: "Member123!",
  name: "Member User",
  role: "member",
} as const;

export const TEST_VIEWER = {
  email: "viewer@weknow.co",
  password: "Viewer123!",
  name: "Viewer User",
  role: "viewer",
} as const;

// Sign-in takes longer on remote preview cold starts (Vercel function wake + DB
// handshake). 10s was enough for local dev but flakes intermittently against
// a Vercel preview pointed at Neon dev. Use a wider window here so auth never
// becomes the reason a test fails.
const SIGN_IN_NAV_TIMEOUT_MS = 30_000;

/**
 * Sign in programmatically via the login form as an admin.
 * Waits for redirect to /kiosks after successful sign-in.
 */
export async function signInAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(TEST_ADMIN.email);
  await page.locator("input#password").fill(TEST_ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/kiosks", { timeout: SIGN_IN_NAV_TIMEOUT_MS });
}

/**
 * Sign in programmatically via the login form as a member.
 * Waits for redirect to /kiosks after successful sign-in.
 *
 * TODO: implement after member/viewer users are added to db:seed
 */
export async function signInAsMember(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(TEST_MEMBER.email);
  await page.locator("input#password").fill(TEST_MEMBER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/kiosks", { timeout: SIGN_IN_NAV_TIMEOUT_MS });
}

/**
 * Sign in programmatically via the login form as a viewer.
 * Waits for redirect to /kiosks after successful sign-in.
 *
 * TODO: implement after member/viewer users are added to db:seed
 */
export async function signInAsViewer(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(TEST_VIEWER.email);
  await page.locator("input#password").fill(TEST_VIEWER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/kiosks", { timeout: SIGN_IN_NAV_TIMEOUT_MS });
}
