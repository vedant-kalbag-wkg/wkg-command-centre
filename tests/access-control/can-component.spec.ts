/**
 * Wave 0 RED scaffold — can-component.spec.ts
 *
 * Playwright E2E spec for the <Can> component — verifies that UI elements gated
 * on CASL ability checks are hidden for viewer-tier users and visible for admins.
 * AUTH-06 SC4 + RESEARCH Q4:
 *   - Viewer: Merge button NOT visible on /locations/[id]
 *   - Admin:  Merge button IS visible on /locations/[id]
 *   - Viewer: "Configure" nav-group NOT visible in sidebar
 *
 * Fails because the <Can> component does not exist until Plan 10-04 (Wave 3).
 * Do NOT make this pass in this plan — Plan 10-08 verifies against preview alias.
 */
import { test, expect } from "@playwright/test";
import { signInAsAdmin, signInAsViewer } from "../helpers/auth";

/**
 * Look up any existing location ID to navigate to.
 * Falls back to TEST_LOCATION_ID env var if set.
 * Plan 10-08 documents the operator handoff for setting this on Vercel preview.
 */
async function getAnyLocationId(
  page: import("@playwright/test").Page,
): Promise<string | null> {
  if (process.env.TEST_LOCATION_ID) {
    return process.env.TEST_LOCATION_ID;
  }
  const response = await page.request.get("/api/admin/locations");
  if (!response.ok()) {
    return null;
  }
  const json = await response.json();
  const locations: Array<{ id: string }> =
    json?.locations ?? json?.data ?? json ?? [];
  return locations[0]?.id ?? null;
}

test.describe("<Can> component — visibility gating", () => {
  test("viewer does NOT see Merge button on /locations/[id]", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await signInAsViewer(page);

    const locationId = await getAnyLocationId(page);

    // Fails because /locations/[id] <Can> gating does not exist (Wave 3)
    await page.goto(`/locations/${locationId ?? "test-location"}`);

    // Merge button must NOT be visible for viewer
    await expect(
      page.getByRole("button", { name: /merge/i }),
    ).not.toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("admin sees Merge button on /locations/[id]", async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await signInAsAdmin(page);

    const locationId = await getAnyLocationId(page);

    await page.goto(`/locations/${locationId ?? "test-location"}`);

    // Merge button MUST be visible for admin
    await expect(
      page.getByRole("button", { name: /merge/i }),
    ).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("viewer does NOT see Configure nav-group in sidebar", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await signInAsViewer(page);
    await page.goto("/kiosks");

    // Configure nav-group must NOT be visible for viewer-tier users
    await expect(
      page.getByRole("navigation").getByText(/configure/i),
    ).not.toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
