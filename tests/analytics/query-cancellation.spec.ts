import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Navigating away from an analytics page while a server action is still
 * loading must not bleed a pivot-related error into the next page. The
 * `useAbortableAction` hook discards the late result on unmount.
 */
test("@analytics navigating from pivot-table to heat-map mid-load does not surface pivot errors", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);

  // Start on pivot-table. The page mounts and begins its client-side work.
  await page.goto("/analytics/pivot-table");
  await expect(
    page.getByRole("heading", { name: "Pivot Table", level: 1 }),
  ).toBeVisible();

  // Immediately navigate to heat-map. If the old pivot component's late
  // server-action response tried to touch state on the new page (or dropped
  // an error toast), we'd see it here.
  await page.goto("/analytics/heat-map");
  await expect(
    page.getByRole("heading", { name: "Performance Heat Map", level: 1 }),
  ).toBeVisible({ timeout: 15_000 });

  // No pivot-related error toast should appear on the heat-map page.
  const pivotErrorToast = page.getByText(/Failed to run pivot query/i);
  await expect(pivotErrorToast).toHaveCount(0);

  // And no uncaught page errors fired in the interim.
  expect(pageErrors).toEqual([]);
});
