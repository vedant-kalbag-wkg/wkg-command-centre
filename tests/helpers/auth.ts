import { type Page } from "@playwright/test";
import {
  TEST_OPS_IT,
  TEST_VIEWER as SETUP_TEST_VIEWER,
  type TestUserFixture,
} from "../auth/setup";

/**
 * Shared auth test utilities for Phase 2+ tests.
 *
 * The admin test user is seeded via `npm run db:seed` which creates:
 *   email: admin@weknow.co
 *   password: Admin123!
 *   role: admin
 *
 * Phase 10 non-admin fixtures (TEST_OPS_IT, TEST_VIEWER) are seeded by
 * migration 0051 backfill (Plan 10-02, task 5: scripts/seed-test-users.ts).
 * Their credentials are defined as the authoritative source in
 * tests/auth/setup.ts and may be overridden by env vars for Vercel preview runs.
 *
 * Re-exports for convenience — callers that only need Phase 10 fixtures can
 * import from this file without also importing from tests/auth/setup.ts.
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

/** Phase 10 seeded viewer fixture (overrides legacy viewer@weknow.co constant). */
export const TEST_VIEWER = SETUP_TEST_VIEWER;

export { TEST_OPS_IT };
export type { TestUserFixture };

// Sign-in takes longer on remote preview cold starts (Vercel function wake + DB
// handshake). 10s was enough for local dev but flakes intermittently against
// a Vercel preview pointed at Neon dev. Use a wider window here so auth never
// becomes the reason a test fails.
const SIGN_IN_NAV_TIMEOUT_MS = 30_000;

/**
 * Generic sign-in helper — parametrised by any object with email and password.
 * Accepts TestUserFixture (TEST_OPS_IT, TEST_VIEWER) as well as TEST_ADMIN.
 * Navigates to /login, fills credentials, waits for redirect to /kiosks.
 */
export async function signInAs(
  page: Page,
  fixture: { email: string; password: string },
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(fixture.email);
  await page.locator("input#password").fill(fixture.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/kiosks", { timeout: SIGN_IN_NAV_TIMEOUT_MS });
}

/**
 * Sign in programmatically via the login form as an admin.
 * Waits for redirect to /kiosks after successful sign-in.
 */
export async function signInAsAdmin(page: Page) {
  return signInAs(page, TEST_ADMIN);
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
 * Sign in as the Phase 10 seeded Ops-IT (member) user.
 */
export const signInAsOpsIt = (page: Page) => signInAs(page, TEST_OPS_IT);

/**
 * Sign in programmatically via the login form as a viewer.
 * Uses the Phase 10 seeded viewer fixture (viewer.test@weknowgroup.com).
 * Waits for redirect to /kiosks after successful sign-in.
 */
export const signInAsViewer = (page: Page) => signInAs(page, TEST_VIEWER);
