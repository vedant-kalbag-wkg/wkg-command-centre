/**
 * Phase 6 plan 06-02 — multi-location config-group regression fixture (SC8).
 *
 * Catches the `ANY(${ids})` Drizzle bug PR #29 (commit fbcce77) hot-fixed.
 * Pre-fix, listConfigGroups() generated `ANY(($1, $2, $3))` for any group
 * with ≥2 active linked locations, which Postgres rejected with SQLSTATE
 * 42809 — the list page rendered a 500. This spec seeds exactly that
 * shape (a group with 2 active linked locations + 1 active product) and
 * asserts both the list and detail pages render cleanly.
 *
 * To verify this spec actually catches the regression:
 *   git revert --no-commit fbcce77
 *   npx playwright test tests/kiosk-config-groups/multi-location.spec.ts
 *   # the list-page test must FAIL
 *   git revert --abort
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";
import { db } from "@/db";
import {
  kioskConfigGroups,
  locations,
  products,
  locationProducts,
  regions,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

// Stable identifiers — the regression catches if the seed shape (group
// with ≥2 linked locations) is what trips listConfigGroups, so the names
// just need to be unique-per-run and easy to clean up.
const FIXTURE_GROUP_NAME = `_e2e_multi_location_group_${randomUUID().slice(0, 8)}`;
const FIXTURE_PRODUCT_NAME = `_e2e_multi_location_product_${randomUUID().slice(0, 8)}`;
const LOC1_NAME = `_e2e Multi-Location 1 ${randomUUID().slice(0, 4)}`;
const LOC2_NAME = `_e2e Multi-Location 2 ${randomUUID().slice(0, 4)}`;

test.describe("@kiosk-config-groups multi-location regression (PR #29)", () => {
  let groupId: string | undefined;
  let location1Id: string | undefined;
  let location2Id: string | undefined;
  let productId: string | undefined;

  test.beforeAll(async () => {
    // Resolve any existing region — every location needs primary_region_id
    // (NOT NULL since migration 0022). If the test DB has no regions row
    // we abort rather than silently passing an empty test. We only select
    // the `id` column (not `select()` over the whole row) so a dev DB
    // that's drifted on schema columns we don't need still passes the
    // prerequisite check.
    const [region] = await db
      .select({ id: regions.id })
      .from(regions)
      .limit(1);
    if (!region) {
      throw new Error(
        "Test prerequisite: at least one row in `regions` is required " +
          "(run `npm run db:seed` first).",
      );
    }

    // Seed config group.
    const [group] = await db
      .insert(kioskConfigGroups)
      .values({ name: FIXTURE_GROUP_NAME })
      .returning();
    groupId = group.id;

    // Seed two active locations linked to the group. The bug surfaces only
    // when ≥2 linked locations exist (so `ids.length >= 2` and the broken
    // `ANY(${ids})` binding rejects the query).
    const [loc1] = await db
      .insert(locations)
      .values({
        name: LOC1_NAME,
        primaryRegionId: region.id,
        kioskConfigGroupId: groupId,
      })
      .returning();
    location1Id = loc1.id;

    const [loc2] = await db
      .insert(locations)
      .values({
        name: LOC2_NAME,
        primaryRegionId: region.id,
        kioskConfigGroupId: groupId,
      })
      .returning();
    location2Id = loc2.id;

    // Seed one active product linked to BOTH locations with availability
    // = "yes" (the value listConfigGroups filters on for productAvailability).
    const [product] = await db
      .insert(products)
      .values({ name: FIXTURE_PRODUCT_NAME })
      .returning();
    productId = product.id;

    await db.insert(locationProducts).values([
      {
        locationId: location1Id,
        productId,
        providerId: null,
        availability: "yes",
      },
      {
        locationId: location2Id,
        productId,
        providerId: null,
        availability: "yes",
      },
    ]);
  });

  test.afterAll(async () => {
    // Reverse FK order. Catch-and-swallow per delete so a partial seed
    // failure doesn't leave the suite stuck — operator can clean up
    // manually using the FIXTURE_* prefixes if needed. Skip individual
    // deletes whose id is undefined (beforeAll bailed early before
    // populating it) so this hook never times out.
    if (productId) {
      try {
        await db
          .delete(locationProducts)
          .where(eq(locationProducts.productId, productId));
      } catch {
        /* noop */
      }
      try {
        await db.delete(products).where(eq(products.id, productId));
      } catch {
        /* noop */
      }
    }
    if (location1Id) {
      try {
        await db.delete(locations).where(eq(locations.id, location1Id));
      } catch {
        /* noop */
      }
    }
    if (location2Id) {
      try {
        await db.delete(locations).where(eq(locations.id, location2Id));
      } catch {
        /* noop */
      }
    }
    if (groupId) {
      try {
        await db
          .delete(kioskConfigGroups)
          .where(eq(kioskConfigGroups.id, groupId));
      } catch {
        /* noop */
      }
    }
  });

  test("list page (/kiosk-config-groups) renders the multi-location group without 500", async ({
    page,
  }) => {
    // Capture browser-side errors so a hidden 500 surfaced as a
    // client-side render error doesn't pass the test.
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e)}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(`console.error: ${msg.text()}`);
      }
    });

    await signInAsAdmin(page);
    const response = await page.goto("/kiosk-config-groups");
    // The PR #29 bug rendered as a server 500 (Drizzle threw on the
    // `ANY(($1,$2,$3))` query). Status < 400 catches it.
    expect(response?.status()).toBeLessThan(400);

    await expect(
      page.getByRole("heading", { name: "Kiosk Config Groups", level: 1 }),
    ).toBeVisible();

    // Group row must render — proves the productAvailability column was
    // computed without throwing.
    await expect(page.getByText(FIXTURE_GROUP_NAME)).toBeVisible({
      timeout: 10_000,
    });

    expect(consoleErrors).toEqual([]);
  });

  test("detail page (/kiosk-config-groups/[id]) renders both linked locations", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e)}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(`console.error: ${msg.text()}`);
      }
    });

    await signInAsAdmin(page);
    const response = await page.goto(`/kiosk-config-groups/${groupId}`);
    expect(response?.status()).toBeLessThan(400);

    // Both seeded locations must appear on the members list. Detail page
    // renders members via ConfigGroupMembersClient which formats them as
    // "<outletCode> — <name>" (or just "<name>" if outletCode is null);
    // matching by name keeps the assertion stable across that formatting.
    await expect(page.getByText(LOC1_NAME)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(LOC2_NAME)).toBeVisible({ timeout: 10_000 });

    expect(consoleErrors).toEqual([]);
  });
});
