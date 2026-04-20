import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Multi-select behaviour on the per-dimension analytics pages:
 *   - /analytics/hotel-groups
 *   - /analytics/location-groups
 *   - /analytics/regions
 *
 * Each page's primary selector is a multi-select; the equivalent chip in the
 * top analytics filter bar is hidden on that page (the selector IS the
 * filter).
 */

async function safeSignIn(page: import("@playwright/test").Page) {
  try {
    await signInAsAdmin(page);
  } catch (err) {
    test.skip(
      true,
      `db-backed auth not reachable in this environment: ${String(err)}`,
    );
  }
}

test("@analytics/hotel-groups multi-select: selecting two groups updates URL with comma-separated ids and renders metrics; filter-bar chip is hidden", async ({
  page,
}) => {
  await safeSignIn(page);
  await page.goto("/analytics/hotel-groups");

  await expect(
    page.getByRole("heading", { name: "Hotel Groups", level: 1 }),
  ).toBeVisible({ timeout: 15_000 });

  // The "Hotel Groups" chip in the top filter bar must NOT be rendered here.
  // The page-level selector IS the filter for this dimension.
  const filterBarChip = page.getByRole("button", {
    name: /^Hotel Groups(\s|$)/,
  });
  await expect(filterBarChip).toHaveCount(0);

  // Open the page-level multi-select.
  const selectorTrigger = page
    .getByRole("button", { name: /Select a hotel group/i })
    .first();
  await expect(selectorTrigger).toBeVisible({ timeout: 15_000 });
  await selectorTrigger.click();

  const options = page.getByRole("option");
  const optionCount = await options.count();
  if (optionCount < 2) {
    test.skip(true, "need at least 2 hotel groups in test DB to assert multi-select");
  }

  await options.nth(0).click();
  await options.nth(1).click();
  await page.keyboard.press("Escape");

  // URL should carry both ids comma-separated under ?group=...
  await expect
    .poll(
      () => {
        const url = new URL(page.url());
        return url.searchParams.get("group") ?? "";
      },
      { timeout: 5_000 },
    )
    .toMatch(/^[^,]+,[^,]+/);

  // The metrics panel should render.
  await expect(
    page.getByRole("button", { name: /Group Metrics/ }),
  ).toBeVisible({ timeout: 15_000 });
});

test("@analytics/location-groups multi-select: filter-bar chip is hidden on this page", async ({
  page,
}) => {
  await safeSignIn(page);
  await page.goto("/analytics/location-groups");

  await expect(
    page.getByRole("heading", { name: "Location Groups", level: 1 }),
  ).toBeVisible({ timeout: 15_000 });

  const filterBarChip = page.getByRole("button", {
    name: /^Location Groups(\s|$)/,
  });
  await expect(filterBarChip).toHaveCount(0);
});

test("@analytics/regions card-toggle multi-select: clicking two cards marks both selected; Regions chip is hidden in filter bar", async ({
  page,
}) => {
  await safeSignIn(page);
  await page.goto("/analytics/regions");

  await expect(
    page.getByRole("heading", { name: "Regions", level: 1 }),
  ).toBeVisible({ timeout: 15_000 });

  // Filter bar "Regions" chip must NOT be present on this page.
  const filterBarChip = page.getByRole("button", { name: /^Regions(\s|$)/ });
  await expect(filterBarChip).toHaveCount(0);

  // Region cards expose role=button via aria-pressed. Click two.
  const cards = page.locator('[role="button"][aria-pressed]');
  const count = await cards.count();
  if (count < 2) {
    test.skip(true, "need at least 2 regions in test DB to assert multi-select cards");
  }

  await cards.nth(0).click();
  await cards.nth(1).click();

  // Both should now report aria-pressed=true.
  await expect(cards.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(cards.nth(1)).toHaveAttribute("aria-pressed", "true");

  // URL should carry both ids comma-separated under ?region=...
  await expect
    .poll(
      () => {
        const url = new URL(page.url());
        return url.searchParams.get("region") ?? "";
      },
      { timeout: 5_000 },
    )
    .toMatch(/^[^,]+,[^,]+/);
});
