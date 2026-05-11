import { type Page } from "@playwright/test";

/**
 * Shared auth test utilities.
 *
 * The admin test user is seeded via `npm run db:seed` which creates:
 *   email: admin@weknow.co
 *   password: Admin123!
 *   role: admin
 *
 * Phase 10 adds two non-admin fixture constants:
 *   TEST_OPS_IT  — maps to the seeded Ops-IT (member) role
 *   TEST_VIEWER  — maps to the seeded Read-only (viewer) role
 *
 * CONTRACT: the credential rows for TEST_OPS_IT and TEST_VIEWER are seeded
 * by migration 0051 backfill (Plan 10-02, task 5: scripts/seed-test-users.ts).
 * These constants are the authoritative source of truth for that seed script.
 * The seed must run against the test/preview DB only (Plan 10-02 gates the
 * script on `process.env.NODE_ENV !== 'production'`).
 *
 * For Playwright runs against the Vercel preview alias, set these env vars
 * (see CLAUDE.md "Vercel preview env vars"):
 *   TEST_OPS_IT_EMAIL, TEST_OPS_IT_PASSWORD
 *   TEST_VIEWER_EMAIL, TEST_VIEWER_PASSWORD
 * Plan 10-08 documents the operator handoff for adding them to Vercel env.
 */
export const TEST_ADMIN = {
  email: "admin@weknow.co",
  password: "Admin123!",
  name: "Admin User",
  role: "admin",
} as const;

export const TEST_OPS_IT = {
  email: process.env.TEST_OPS_IT_EMAIL ?? "ops-it.test@weknowgroup.com",
  password: process.env.TEST_OPS_IT_PASSWORD ?? "OpsItTest!2026",
  name: "Test Ops-IT",
  role: "member" as const,
};

export const TEST_VIEWER = {
  email: process.env.TEST_VIEWER_EMAIL ?? "viewer.test@weknowgroup.com",
  password: process.env.TEST_VIEWER_PASSWORD ?? "ViewerTest!2026",
  name: "Test Viewer",
  role: "viewer" as const,
};

export type TestUserFixture = typeof TEST_ADMIN | typeof TEST_OPS_IT | typeof TEST_VIEWER;

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
