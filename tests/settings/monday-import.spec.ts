import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Monday-import admin page smoke — verifies the UI chrome renders for an
 * admin user. Deliberately does NOT click the "Run Monday Import" button:
 * clicking triggers a real Monday API call plus a TRUNCATE+rebuild of
 * location_products, which is side-effectful and slow (30-60s against dev).
 * Integration coverage of runMondayImport lives in
 * tests/lib/monday/import-location-products.integration.test.ts.
 */
test("@settings/data-import/monday page renders with run button", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/data-import/monday");

  await expect(
    page.getByRole("heading", { name: "Monday Import", level: 1 }),
  ).toBeVisible();

  // The button label depends on whether MONDAY_API_TOKEN is configured on
  // the target deployment; either way the label text is "Run Monday Import".
  // We assert visibility, not enablement (so the test works against a dev
  // env where the token may or may not be set).
  await expect(
    page.getByRole("button", { name: /Run Monday Import/i }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});
