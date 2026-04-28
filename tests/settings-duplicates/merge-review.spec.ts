import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Phase 6 Plan 06-01 — UI smoke for the merge-review surface.
 *
 * The destructive `--apply` path is intentionally NOT exercised here — that
 * happens in manual UAT against a staging DB. These specs only verify:
 *   1. The page renders and lists cluster cards (or the empty-state copy).
 *   2. Saving a decision per cluster round-trips through the server action.
 *   3. The Apply button is rendered (its enabled-state depends on saved
 *      decisions, which we cannot guarantee without seeding).
 */

test("@merge-review page loads and renders cluster cards", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/settings/duplicates/merge-review");

  await expect(
    page.getByRole("heading", { name: "Multi-POS Merge Review", level: 1 }),
  ).toBeVisible();

  // Either the cluster cards render OR the empty-state copy is visible.
  const clusterCards = page.locator("[data-testid='merge-cluster-card']");
  const emptyCopy = page.getByText(/no clusters/i).first();
  await expect
    .poll(
      async () =>
        (await clusterCards.count()) > 0 ||
        (await emptyCopy.isVisible().catch(() => false)),
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("@merge-review save-decision per cluster persists via server action", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/settings/duplicates/merge-review");
  const firstCluster = page.locator("[data-testid='merge-cluster-card']").first();
  const count = await firstCluster.count();
  test.skip(count === 0, "No clusters seeded — skipping");

  const firstPair = firstCluster.locator("[data-testid='merge-defunct-pair']").first();
  await firstPair.getByRole("radio", { name: /approved/i }).check();
  await firstPair.getByRole("button", { name: /save decision/i }).click();

  // Either a sonner toast (success) flashes, OR the saved-state caption renders.
  await expect(
    firstPair.getByText(/decision saved|saved/i),
  ).toBeVisible({ timeout: 10_000 });
});

test("@merge-review apply button is rendered on the page", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/settings/duplicates/merge-review");
  const applyBtn = page.getByRole("button", { name: /apply approved merges/i });
  await expect(applyBtn).toBeVisible();
});
