import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Phase 3.4 — outlet-type classification → analytics filter roundtrip.
 *
 * Logs in as admin, classifies the first unclassified outlet as "airport"
 * on /settings/outlet-types, navigates to /analytics/portfolio, and
 * verifies that the Location Type filter offers `Airport` as an option.
 *
 * The filter assertion is loose-coupled: `Airport` surfaces as long as
 * ANY outlet is classified as airport — which is fine for an integration
 * smoke test. Dev already has 13 airport outlets so the filter assertion
 * also runs in the empty-list fallthrough case where no unclassified rows
 * remain.
 */
test("@settings/outlet-types classify → Location Type filter shows Airport", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/outlet-types");

  await expect(
    page.getByRole("heading", { name: "Outlet Types", level: 1 }),
  ).toBeVisible();

  const firstRow = page.locator("tbody tr").first();
  const emptyState = page.getByText("All outlets classified");

  // Race: either the table has rows we can classify, or the empty state
  // is rendered (dev can be fully classified between runs). We only need
  // one of them to appear before moving on.
  await expect(firstRow.or(emptyState)).toBeVisible();

  const hasUnclassifiedRows = await firstRow.isVisible();

  if (hasUnclassifiedRows) {
    // Capture the outlet code for the toast assertion (it's the second
    // cell — first is the row-select checkbox).
    const outletCode = (
      await firstRow.locator("td").nth(1).textContent()
    )?.trim();
    expect(outletCode, "outlet code should be readable").toBeTruthy();

    // Open the per-row type dropdown. The trigger is the Select's button
    // inside the row — there's one Select and one Save button per row, so
    // first() on a role-scoped query is stable.
    const typeTrigger = firstRow.getByRole("combobox").first();
    await typeTrigger.click();

    // shadcn Select renders options in a portal, so scope via role not
    // the row locator. "Airport" is the visible label for `airport`.
    await page.getByRole("option", { name: "Airport" }).click();

    await firstRow.getByRole("button", { name: "Save" }).click();

    // Two behavioural signals: toast appears AND the row we just saved
    // disappears from the list (optimistic removal). We assert both —
    // toast catches the happy path, row-count delta catches the case
    // where the toast flickers too briefly to be caught.
    await expect(
      page.getByText(`Classified ${outletCode} as Airport`),
    ).toBeVisible();

    // The specific outlet code should no longer be present in the table.
    await expect(
      page.locator("tbody").getByText(outletCode!, { exact: true }),
    ).toHaveCount(0);
  }

  // Step 5-7 run regardless — with or without a fresh classification,
  // the filter should offer Airport (dev has 13 pre-existing airports).
  await page.goto("/analytics/portfolio");

  // Wait for the filter bar to render. Location Type is a MultiSelectFilter
  // whose trigger is a <button> with the filter label.
  const locationTypeTrigger = page.getByRole("button", { name: /Location Type/i });
  await expect(locationTypeTrigger).toBeVisible();
  await locationTypeTrigger.click();

  // The option uses the LOCATION_TYPE_LABELS["airport"] = "Airport" string,
  // rendered as a CommandItem (role=option once open).
  await expect(
    page.getByRole("option", { name: "Airport" }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
