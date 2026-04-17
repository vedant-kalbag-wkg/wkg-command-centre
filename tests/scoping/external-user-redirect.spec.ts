import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { user, userScopes } from "@/db/schema";

/**
 * UAT spec for M3 Task 3.1 — middleware gating.
 *
 * Seeds an external user (creating it if missing) with one userScopes row
 * so the external-user invariant is satisfied, then signs in as that user
 * and verifies the proxy redirects every internal route to
 * /portal/analytics/portfolio while leaving /portal/* and /login alone.
 *
 * Originally deferred in the M3 plan — included here once the manage-scopes
 * dialog and the audit_logs.entity_id text fix were in place.
 */

const EXTERNAL_TEST_USER = {
  email: "external-uat@weknow.co",
  password: "ExternalUat123!",
  name: "External UAT User",
} as const;

async function ensureExternalTestUser(): Promise<string> {
  let userId: string;

  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, EXTERNAL_TEST_USER.email))
    .limit(1);

  if (existing.length === 0) {
    const created = await auth.api.createUser({
      body: {
        email: EXTERNAL_TEST_USER.email,
        password: EXTERNAL_TEST_USER.password,
        name: EXTERNAL_TEST_USER.name,
        role: "user",
      },
    });
    userId = created.user.id;
  } else {
    userId = existing[0].id;
  }

  await db
    .update(user)
    .set({ userType: "external", banned: false })
    .where(eq(user.id, userId));

  await db
    .insert(userScopes)
    .values({
      userId,
      dimensionType: "hotel_group",
      dimensionId: "uat-test-group",
    })
    .onConflictDoNothing();

  return userId;
}

async function signInAsExternal(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(EXTERNAL_TEST_USER.email);
  await page.locator("#password").fill(EXTERNAL_TEST_USER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 10000,
  });
}

test.describe("External user middleware gating", () => {
  test.beforeAll(async () => {
    await ensureExternalTestUser();
  });

  test("external user is redirected to /portal/analytics/portfolio from /kiosks", async ({
    page,
  }) => {
    await signInAsExternal(page);
    await page.goto("/kiosks");
    await expect(page).toHaveURL(/\/portal\/analytics\/portfolio$/);
  });

  test("external user is redirected from /locations", async ({ page }) => {
    await signInAsExternal(page);
    await page.goto("/locations");
    await expect(page).toHaveURL(/\/portal\/analytics\/portfolio$/);
  });

  test("external user is redirected from /settings/users", async ({ page }) => {
    await signInAsExternal(page);
    await page.goto("/settings/users");
    await expect(page).toHaveURL(/\/portal\/analytics\/portfolio$/);
  });

  test("external user can load /portal/coming-soon directly", async ({
    page,
  }) => {
    await signInAsExternal(page);
    await page.goto("/portal/coming-soon");
    await expect(page).toHaveURL(/\/portal\/coming-soon$/);
    await expect(
      page.getByRole("heading", { name: "External portal coming soon" }),
    ).toBeVisible();
  });

  test("external user can sign out from the portal", async ({ page }) => {
    await signInAsExternal(page);
    await page.goto("/portal/analytics/portfolio");
    await page.waitForURL(/\/portal\/analytics\/portfolio/, { timeout: 15000 });
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await page.waitForURL(/\/login$/, { timeout: 10000 });
  });
});
