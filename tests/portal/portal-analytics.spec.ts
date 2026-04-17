/**
 * Portal analytics E2E tests — verifies that:
 *   - External user sees the portal layout with sidebar navigation.
 *   - All 5 portal analytics pages are reachable from the sidebar.
 *   - Filter bar is rendered with dimension filters for scoped users.
 *   - External user can sign out from the portal.
 */
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

// ---------------------------------------------------------------------------
// Test credentials
// ---------------------------------------------------------------------------

const PORTAL_TEST_USER = {
  email: "portal-test@weknow.co",
  password: "PortalTest123!",
  name: "Portal Test User",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureUser(
  creds: { email: string; password: string; name: string },
  opts: {
    userType: "internal" | "external";
    scopes?: { dimensionType: "hotel_group" | "region" | "location_group" | "location" | "product" | "provider"; dimensionId: string }[];
  },
): Promise<string> {
  let userId: string;

  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, creds.email))
    .limit(1);

  if (existing.length === 0) {
    const created = await auth.api.createUser({
      body: {
        email: creds.email,
        password: creds.password,
        name: creds.name,
        role: "user",
      },
    });
    userId = created.user.id;
  } else {
    userId = existing[0].id;
  }

  await db
    .update(user)
    .set({ userType: opts.userType, banned: false })
    .where(eq(user.id, userId));

  await db.delete(userScopes).where(eq(userScopes.userId, userId));

  if (opts.scopes) {
    for (const scope of opts.scopes) {
      await db
        .insert(userScopes)
        .values({
          userId,
          dimensionType: scope.dimensionType,
          dimensionId: scope.dimensionId,
        })
        .onConflictDoNothing();
    }
  }

  return userId;
}

async function signIn(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe.serial("Portal analytics navigation", () => {
  let portalGroupId: string;

  test.beforeAll(async () => {
    // 1. Create a hotel group for this test suite
    const groupRows = await db
      .insert(hotelGroups)
      .values({ name: "Portal Test Group" })
      .onConflictDoNothing()
      .returning({ id: hotelGroups.id });

    if (groupRows.length > 0) {
      portalGroupId = groupRows[0].id;
    } else {
      const existing = await db
        .select({ id: hotelGroups.id })
        .from(hotelGroups)
        .where(eq(hotelGroups.name, "Portal Test Group"))
        .limit(1);
      portalGroupId = existing[0].id;
    }

    // 2. Assign at least one location to the group so scoped queries return data
    const allLocs = await db
      .select({ id: locations.id, outletCode: locations.outletCode })
      .from(locations);

    const firstLoc =
      allLocs.find((l) => l.outletCode === "GRAND-001") ?? allLocs[0];
    if (firstLoc) {
      await db
        .insert(locationHotelGroupMemberships)
        .values({ locationId: firstLoc.id, hotelGroupId: portalGroupId })
        .onConflictDoNothing();
    }

    // 3. Create external user scoped to Portal Test Group
    await ensureUser(PORTAL_TEST_USER, {
      userType: "external",
      scopes: [{ dimensionType: "hotel_group", dimensionId: portalGroupId }],
    });
  });

  // -----------------------------------------------------------------------
  // Test 1: External user lands on portal layout with sidebar
  // -----------------------------------------------------------------------

  test("external user lands on portal layout with sidebar", async ({
    page,
  }) => {
    await signIn(page, PORTAL_TEST_USER.email, PORTAL_TEST_USER.password);

    // Should redirect to portal portfolio page
    await page.waitForURL(/\/portal\/analytics\/portfolio/, {
      timeout: 15_000,
    });

    // Verify portal sidebar is visible — look for "Analytics" group label
    await expect(page.getByText("Analytics", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Verify all 5 nav items exist in the sidebar
    const expectedNavItems = [
      "Portfolio",
      "Heat Map",
      "Trend Builder",
      "Hotel Groups",
      "Regions",
    ];
    for (const item of expectedNavItems) {
      await expect(page.getByRole("link", { name: item })).toBeVisible({
        timeout: 5_000,
      });
    }

    // Verify NO internal nav items are present
    const internalItems = ["Kiosks", "Locations", "Installations"];
    for (const item of internalItems) {
      await expect(page.getByRole("link", { name: item })).not.toBeVisible();
    }
  });

  // -----------------------------------------------------------------------
  // Test 2: Can navigate all 5 portal analytics pages
  // -----------------------------------------------------------------------

  test("can navigate all 5 portal analytics pages", async ({ page }) => {
    test.setTimeout(120_000); // dev server compiles each page on first visit

    await signIn(page, PORTAL_TEST_USER.email, PORTAL_TEST_USER.password);

    await page.waitForURL(/\/portal\/analytics\/portfolio/, {
      timeout: 15_000,
    });

    // Verify Portfolio page heading (already on this page after sign-in)
    await expect(
      page.getByRole("heading", { name: "Portfolio Overview" }),
    ).toBeVisible({ timeout: 15_000 });

    // Navigate to the remaining 4 pages via sidebar links
    const remaining = [
      { link: "Heat Map", heading: "Performance Heat Map" },
      { link: "Trend Builder", heading: "Trend Builder" },
      { link: "Hotel Groups", heading: "Hotel Groups" },
      { link: "Regions", heading: "Regions" },
    ];

    for (const p of remaining) {
      await page.getByRole("link", { name: p.link }).click();

      await expect(
        page.getByRole("heading", { name: p.heading }),
      ).toBeVisible({ timeout: 30_000 });
    }

    // Navigate back to Portfolio to verify full round-trip
    await page.getByRole("link", { name: "Portfolio" }).click();

    await expect(
      page.getByRole("heading", { name: "Portfolio Overview" }),
    ).toBeVisible({ timeout: 30_000 });
  });

  // -----------------------------------------------------------------------
  // Test 3: Filter bar renders with dimension filter buttons
  // -----------------------------------------------------------------------

  test("filter bar renders with dimension filter buttons", async ({
    page,
  }) => {
    await signIn(page, PORTAL_TEST_USER.email, PORTAL_TEST_USER.password);

    await page.waitForURL(/\/portal\/analytics\/portfolio/, {
      timeout: 15_000,
    });

    // Wait for the page to fully load
    await expect(page.getByText("Total Revenue")).toBeVisible({
      timeout: 20_000,
    });

    // Verify the filter bar renders with all expected dimension filters.
    // The AnalyticsFilterBar uses getScopedDimensionOptions for the portal
    // layout, so these buttons confirm the filter bar is wired up correctly.
    const filterButtons = [
      "Locations",
      "Products",
      "Hotel Groups",
      "Regions",
      "Location Groups",
    ];
    for (const label of filterButtons) {
      await expect(
        page.getByRole("button", { name: label, exact: true }),
      ).toBeVisible({ timeout: 5_000 });
    }

    // Verify date range picker is present
    await expect(
      page.getByRole("button", { name: /\d{2}\/\d{2}\/\d{4}/ }),
    ).toBeVisible({ timeout: 5_000 });

    // Verify Apply Filters and Reset buttons are present
    await expect(
      page.getByRole("button", { name: "Apply Filters" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Reset" }),
    ).toBeVisible();
  });

  // -----------------------------------------------------------------------
  // Test 4: External user can sign out from portal
  // -----------------------------------------------------------------------

  test("external user can sign out from portal", async ({ page }) => {
    await signIn(page, PORTAL_TEST_USER.email, PORTAL_TEST_USER.password);

    await page.waitForURL(/\/portal\/analytics\/portfolio/, {
      timeout: 15_000,
    });

    // Click the Sign out button in the sidebar footer
    await page.getByRole("button", { name: "Sign out" }).click();

    // Should redirect to login
    await page.waitForURL(/\/login/, { timeout: 15_000 });

    // Verify we're on the login page
    await expect(
      page.getByRole("button", { name: "Sign in" }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
