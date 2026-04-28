/**
 * Phase 6 plan 06-06 — geocoding admin UI smoke tests.
 *
 * The dev environment will (almost always) have GOOGLE_MAPS_API_KEY unset, so
 * these specs validate the UI surface that's reachable WITHOUT the real
 * provider:
 *   1. Page loads, RBAC-gated, idle panel shows the Re-geocode-all checkbox
 *      and the "Run Dry-Run" button.
 *   2. Clicking Run Dry-Run with no API key surfaces the configuration error
 *      panel (which is the intended path until staging is wired up).
 *
 * The real-API verification is the manual-UAT checkpoint (Task 4) — see plan
 * task 4 for the staging runbook. We deliberately do NOT spin up a stubbed
 * provider here: stubbing process.env at test-time inside Next's server
 * action runtime is brittle, and the error-path coverage is exactly what we
 * want to lock in for CI.
 *
 * If a future preview env DOES set GOOGLE_MAPS_API_KEY, the second test will
 * fail because the dry-run will succeed and the configuration-error panel
 * will not render. Two options at that point: (a) gate the second test on
 * `process.env.GOOGLE_MAPS_API_KEY === undefined` (skip if set), or (b) move
 * the happy-path assertion in. Today's repo state assumes (a) is sufficient.
 */
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@geocoding admin page loads and shows the run-dry-run form", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/settings/geocoding");

  await expect(
    page.getByRole("heading", { name: "Location Geocoding", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /run dry-run/i })).toBeVisible();
  await expect(page.getByText(/re-geocode all/i)).toBeVisible();
});

test("@geocoding dry-run without API key surfaces configuration error", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.GOOGLE_MAPS_API_KEY),
    "GOOGLE_MAPS_API_KEY set in env — skipping the missing-key error-path spec",
  );

  await signInAsAdmin(page);
  await page.goto("/settings/geocoding");
  await page.getByRole("button", { name: /run dry-run/i }).click();

  // The error panel renders the env-var name verbatim so operators see it on
  // first glance. Wait up to 10s — the dry-run action validates the env var
  // synchronously, but server-action round-trips can be slow on cold start.
  await expect(page.getByText(/GOOGLE_MAPS_API_KEY/i)).toBeVisible({
    timeout: 10_000,
  });
});
