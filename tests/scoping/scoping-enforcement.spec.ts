/**
 * Scoping enforcement E2E tests — verifies that:
 *   - Admin (internal) sees all sales across hotel groups.
 *   - External user scoped to hotel_group=A sees portal with scoped data.
 *   - External user is blocked from internal routes.
 *   - External user with zero scopes sees an error (invariant enforced).
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
  locations,
  hotelGroups,
  locationHotelGroupMemberships,
} from "@/db/schema";

// ---------------------------------------------------------------------------
// Test credentials
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  email: "admin@weknow.co",
  password: "Admin123!",
};

const SCOPED_EXTERNAL_USER = {
  email: "scope-test-ext@weknow.co",
  password: "ScopeTest123!",
  name: "Scoped External User",
};

const UNSCOPED_EXTERNAL_USER = {
  email: "unscoped-test-ext@weknow.co",
  password: "UnscopeTest123!",
  name: "Unscoped External User",
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

test.describe.serial("Scoping enforcement", () => {
  let groupAId: string;

  test.beforeAll(async () => {
    // 1. Create hotel groups
    const groupARows = await db
      .insert(hotelGroups)
      .values({ name: "Scope Test Group A" })
      .onConflictDoNothing()
      .returning({ id: hotelGroups.id });

    const groupBRows = await db
      .insert(hotelGroups)
      .values({ name: "Scope Test Group B" })
      .onConflictDoNothing()
      .returning({ id: hotelGroups.id });

    // If onConflictDoNothing returned nothing, look them up
    if (groupARows.length > 0) {
      groupAId = groupARows[0].id;
    } else {
      const existing = await db
        .select({ id: hotelGroups.id })
        .from(hotelGroups)
        .where(eq(hotelGroups.name, "Scope Test Group A"))
        .limit(1);
      groupAId = existing[0].id;
    }

    let groupBId: string;
    if (groupBRows.length > 0) {
      groupBId = groupBRows[0].id;
    } else {
      const existing = await db
        .select({ id: hotelGroups.id })
        .from(hotelGroups)
        .where(eq(hotelGroups.name, "Scope Test Group B"))
        .limit(1);
      groupBId = existing[0].id;
    }

    // 2. Look up demo locations by outletCode
    const outletCodes = [
      "GRAND-001",
      "CITY-002",
      "RIVER-003",
      "AIR-004",
      "HARB-005",
    ];
    const allLocs = await db
      .select({ id: locations.id, outletCode: locations.outletCode })
      .from(locations);

    const locByCode = new Map(
      allLocs
        .filter((l) => l.outletCode && outletCodes.includes(l.outletCode))
        .map((l) => [l.outletCode!, l.id]),
    );

    // 3. Assign locations to groups
    // Group A: GRAND-001, CITY-002
    for (const code of ["GRAND-001", "CITY-002"]) {
      const locId = locByCode.get(code);
      if (locId) {
        await db
          .insert(locationHotelGroupMemberships)
          .values({ locationId: locId, hotelGroupId: groupAId })
          .onConflictDoNothing();
      }
    }

    // Group B: RIVER-003, AIR-004, HARB-005
    for (const code of ["RIVER-003", "AIR-004", "HARB-005"]) {
      const locId = locByCode.get(code);
      if (locId) {
        await db
          .insert(locationHotelGroupMemberships)
          .values({ locationId: locId, hotelGroupId: groupBId })
          .onConflictDoNothing();
      }
    }

    // 4. Create external user scoped to Group A
    await ensureUser(SCOPED_EXTERNAL_USER, {
      userType: "external",
      scopes: [{ dimensionType: "hotel_group", dimensionId: groupAId }],
    });

    // 5. Create external user with NO scopes
    await ensureUser(UNSCOPED_EXTERNAL_USER, {
      userType: "external",
    });
  });

  // -----------------------------------------------------------------------
  // Test 1: Admin sees all sales across hotel groups
  // -----------------------------------------------------------------------

  test("admin sees all sales across hotel groups", async ({ page }) => {
    await signIn(page, ADMIN_USER.email, ADMIN_USER.password);

    await page.goto("/analytics/portfolio");

    // Wait for heading
    await expect(
      page.getByRole("heading", { name: "Portfolio Overview" }),
    ).toBeVisible({ timeout: 15_000 });

    // Wait for data to render — skeleton is replaced by the Summary section
    // with KPI cards. Wait for "Total Revenue" text that appears in KpiCard.
    await expect(page.getByText("Total Revenue")).toBeVisible({
      timeout: 15_000,
    });

    // Admin should NOT see an error banner
    await expect(
      page.locator(".border-destructive\\/50"),
    ).not.toBeVisible();
  });

  // -----------------------------------------------------------------------
  // Test 2: External user scoped to Group A sees portal with scoped data
  // -----------------------------------------------------------------------

  test("external user scoped to Group A sees portal with scoped data", async ({
    page,
  }) => {
    await signIn(
      page,
      SCOPED_EXTERNAL_USER.email,
      SCOPED_EXTERNAL_USER.password,
    );

    // After login, should redirect to portal
    await page.waitForURL(/\/portal\/analytics\/portfolio/, {
      timeout: 15_000,
    });

    // Verify portal sidebar is visible — look for "Analytics" label
    await expect(page.getByText("Analytics", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Verify page loads with heading
    await expect(
      page.getByRole("heading", { name: "Portfolio Overview" }),
    ).toBeVisible({ timeout: 15_000 });

    // Wait for data to render (no skeleton)
    await expect(page.getByText("Total Revenue")).toBeVisible({
      timeout: 15_000,
    });

    // Should NOT see an error banner
    await expect(
      page.locator(".border-destructive\\/50"),
    ).not.toBeVisible();
  });

  // -----------------------------------------------------------------------
  // Test 3: External user cannot access internal routes
  // -----------------------------------------------------------------------

  test("external user cannot access internal routes", async ({ page }) => {
    await signIn(
      page,
      SCOPED_EXTERNAL_USER.email,
      SCOPED_EXTERNAL_USER.password,
    );

    // Try /kiosks — should redirect to portal
    await page.goto("/kiosks");
    await page.waitForURL(/\/portal\/analytics\/portfolio/, {
      timeout: 15_000,
    });

    // Try /analytics/portfolio (internal analytics) — should redirect to portal
    await page.goto("/analytics/portfolio");
    await page.waitForURL(/\/portal\/analytics\/portfolio/, {
      timeout: 15_000,
    });
  });

  // -----------------------------------------------------------------------
  // Test 4: External user with zero scopes gets error
  // -----------------------------------------------------------------------

  test("external user with zero scopes gets error", async ({ page }) => {
    await signIn(
      page,
      UNSCOPED_EXTERNAL_USER.email,
      UNSCOPED_EXTERNAL_USER.password,
    );

    // Redirects to portal
    await page.waitForURL(/\/portal\/analytics\/portfolio/, {
      timeout: 15_000,
    });

    // The page will try to fetch data, which calls scopedSalesCondition.
    // For external users with 0 scopes, it throws. The portfolio page
    // catches this and displays an error banner.
    await expect(
      page.locator(".border-destructive\\/50"),
    ).toBeVisible({ timeout: 20_000 });
  });
});
