import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * E2E coverage for the Duplicate Location Detection feature (Phase 04.x, Task 8).
 *
 * Drives /settings/duplicates end-to-end via the UI — no server-action shortcuts,
 * no DB mocks. Seeds locations through the real /locations/new form, matching the
 * conventions in tests/locations/*.spec.ts.
 *
 * Seeding strategy: to keep pairs stable above the default 0.75 slider threshold,
 * each pair uses near-identical names differing only in the final letter
 * ("…A" vs "…B"). That gives bigram Jaccard ≈ 1.0 and keeps the two rows
 * distinguishable in the DOM. A per-test `runId` namespaces each pair so
 * parallel or repeated runs never collide — and the pair row can be located
 * unambiguously by filtering on BOTH names.
 */

async function createLocation(page: Page, name: string): Promise<void> {
  await page.goto("/locations/new");
  await page.getByPlaceholder("e.g. The Grand Hotel").fill(name);
  await page.getByRole("button", { name: "Create location" }).click();
  await expect(page).toHaveURL(/\/locations\/[0-9a-f-]+$/, { timeout: 15000 });
}

test.describe("Duplicate locations — scan & dismiss (DUP-01, DUP-02)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  // DUP-01: Happy path — scan surfaces near-duplicate pair, Review opens MergeDialog
  test("DUP-01: scan surfaces near-duplicate pair and Review opens MergeDialog", async ({
    page,
  }) => {
    const runId = Date.now();
    const nameA = `Hilton Kensington DUP1-${runId}-A`;
    const nameB = `Hilton Kensington DUP1-${runId}-B`;

    await createLocation(page, nameA);
    await createLocation(page, nameB);

    await page.goto("/settings/duplicates");
    await expect(
      page.getByRole("button", { name: /Scan for duplicates/i })
    ).toBeVisible();

    await page.getByRole("button", { name: /Scan for duplicates/i }).click();

    // Scan success toast (N varies based on residual DB state)
    await expect(page.getByText(/Found \d+ candidate pair\(s\)/)).toBeVisible({
      timeout: 15000,
    });

    // Locate the row that contains BOTH seeded names — unique to this run.
    const pairRow = page
      .locator("li", { has: page.getByText(nameA, { exact: true }) })
      .filter({ has: page.getByText(nameB, { exact: true }) });
    await expect(pairRow).toBeVisible({ timeout: 5000 });

    // Open merge dialog
    await pairRow.getByRole("button", { name: "Review" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText(/Merge 2 locations/i)).toBeVisible();

    // MergeDialog is pre-populated with both records — the canonical/archived
    // labels only appear when records.length === 2 and pre-selection ran.
    await expect(dialog.getByText(/\(canonical\)/)).toBeVisible();
    await expect(dialog.getByText(/\(will be archived\)/)).toBeVisible();

    // Both seeded names render inside the dialog
    await expect(dialog.getByText(nameA, { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText(nameB, { exact: true }).first()).toBeVisible();
  });

  // DUP-02: Dismiss persists — dismissed pair does not reappear on rescan
  test("DUP-02: dismissed pair does not reappear on rescan", async ({ page }) => {
    const runId = Date.now();
    const nameA = `Marriott Mayfair DUP2-${runId}-A`;
    const nameB = `Marriott Mayfair DUP2-${runId}-B`;

    await createLocation(page, nameA);
    await createLocation(page, nameB);

    await page.goto("/settings/duplicates");

    // First scan — pair should appear
    await page.getByRole("button", { name: /Scan for duplicates/i }).click();
    await expect(page.getByText(/Found \d+ candidate pair\(s\)/)).toBeVisible({
      timeout: 15000,
    });

    const pairRow = page
      .locator("li", { has: page.getByText(nameA, { exact: true }) })
      .filter({ has: page.getByText(nameB, { exact: true }) });
    await expect(pairRow).toBeVisible({ timeout: 5000 });

    // Dismiss the pair
    await pairRow.getByRole("button", { name: "Dismiss pair" }).click();
    await expect(page.getByText("Pair dismissed")).toBeVisible({ timeout: 5000 });

    // Row disappears from the current list (optimistic filter)
    await expect(pairRow).toHaveCount(0, { timeout: 5000 });

    // Rescan — dismissal must persist server-side
    await page.getByRole("button", { name: /Scan for duplicates/i }).click();
    await expect(page.getByText(/Found \d+ candidate pair\(s\)/)).toBeVisible({
      timeout: 15000,
    });

    // The pair must NOT reappear
    await expect(
      page
        .locator("li", { has: page.getByText(nameA, { exact: true }) })
        .filter({ has: page.getByText(nameB, { exact: true }) })
    ).toHaveCount(0);
  });
});
