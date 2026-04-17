import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { test, expect } from "@playwright/test";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  user,
  userScopes,
  hotelGroups,
  locations,
  locationHotelGroupMemberships,
} from "@/db/schema";

/**
 * E2E tests for the admin impersonation flow (M9 Task 6).
 *
 * Covers:
 *  1. Admin starts impersonation from user-table "Preview as" action
 *  2. Admin exits impersonation via banner "Exit" button
 *  3. Impersonation banner appears on portal analytics pages
 */

const IMPERSONATE_TARGET = {
  email: "impersonate-target@weknow.co",
  password: "ImpTarget123!",
  name: "Impersonate Target",
};

const TEST_HOTEL_GROUP_NAME = "Impersonate Test Group";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureUser(): Promise<string> {
  let userId: string;

  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, IMPERSONATE_TARGET.email))
    .limit(1);

  if (existing.length === 0) {
    const created = await auth.api.createUser({
      body: {
        email: IMPERSONATE_TARGET.email,
        password: IMPERSONATE_TARGET.password,
        name: IMPERSONATE_TARGET.name,
        role: "user",
      },
    });
    userId = created.user.id;
  } else {
    userId = existing[0].id;
  }

  // Ensure the user is external + active (survives prior test deactivations)
  await db
    .update(user)
    .set({ userType: "external", banned: false })
    .where(eq(user.id, userId));

  // Clear and re-add scopes to prevent cross-test contamination
  await db.delete(userScopes).where(eq(userScopes.userId, userId));

  // Ensure the hotel group exists
  await db
    .insert(hotelGroups)
    .values({ name: TEST_HOTEL_GROUP_NAME })
    .onConflictDoNothing();

  const [hg] = await db
    .select({ id: hotelGroups.id })
    .from(hotelGroups)
    .where(eq(hotelGroups.name, TEST_HOTEL_GROUP_NAME))
    .limit(1);

  // Ensure at least one location is assigned to the hotel group
  const existingLocations = await db
    .select({ id: locations.id })
    .from(locations)
    .limit(1);

  if (existingLocations.length > 0) {
    await db
      .insert(locationHotelGroupMemberships)
      .values({
        locationId: existingLocations[0].id,
        hotelGroupId: hg.id,
      })
      .onConflictDoNothing();
  }

  // Add a hotel_group scope for the target user
  await db
    .insert(userScopes)
    .values({
      userId,
      dimensionType: "hotel_group",
      dimensionId: hg.id,
    })
    .onConflictDoNothing();

  return userId;
}

async function signInAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill("admin@weknow.co");
  await page.locator("#password").fill("Admin123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 15000,
  });
}

async function startImpersonationViaUI(page: import("@playwright/test").Page) {
  await signInAsAdmin(page);
  await page.goto("/settings/users");
  await page.waitForLoadState("networkidle");

  const targetRow = page
    .locator("tr")
    .filter({ hasText: IMPERSONATE_TARGET.email });
  await targetRow.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: "Preview as" }).click();

  await expect(page.getByText(/Previewing as/)).toBeVisible({ timeout: 10000 });
  await page.waitForURL(/\/analytics\/portfolio/, { timeout: 15000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Impersonation flow", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    await ensureUser();
  });

  test("admin can start impersonation from user table", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/settings/users");
    await page.waitForLoadState("networkidle");

    // Find the target user row and click Actions
    const targetRow = page
      .locator("tr")
      .filter({ hasText: IMPERSONATE_TARGET.email });
    await targetRow.getByRole("button", { name: "Actions" }).click();

    // Click "Preview as"
    await page.getByRole("menuitem", { name: "Preview as" }).click();

    // Verify toast
    await expect(page.getByText(/Previewing as/)).toBeVisible({
      timeout: 10000,
    });

    // Should navigate to analytics
    await page.waitForURL(/\/analytics\/portfolio/, { timeout: 15000 });

    // Verify impersonation banner is visible
    await expect(
      page.getByText(/Viewing as:.*Impersonate Target/),
    ).toBeVisible({ timeout: 10000 });
  });

  test("admin can exit impersonation", async ({ page }) => {
    // Start impersonation first
    await startImpersonationViaUI(page);

    // Verify banner exists
    await expect(page.getByText(/Viewing as/)).toBeVisible({ timeout: 10000 });

    // Reload the page to clear the Sonner toast that overlays the Exit button
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText(/Viewing as/)).toBeVisible({ timeout: 10000 });

    // Now click Exit button without toast interference
    await page.getByRole("button", { name: "Exit" }).click();

    // Wait for the server action + router.refresh() to complete
    // The banner should disappear once the impersonation cookies are deleted
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "networkidle" });

    await expect(page.getByText(/Viewing as/)).not.toBeVisible({
      timeout: 10000,
    });
  });

  test("impersonation shows in portal with banner", async ({ page }) => {
    // Start impersonation
    await startImpersonationViaUI(page);

    // Navigate to portal analytics
    await page.goto("/portal/analytics/portfolio");

    // Verify portal page loads with impersonation banner
    await expect(
      page.getByText(/Viewing as:.*Impersonate Target/),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.getByRole("heading", { name: "Portfolio Overview" }),
    ).toBeVisible({ timeout: 15000 });
  });
});
