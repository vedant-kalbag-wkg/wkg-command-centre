import type { FullConfig } from "@playwright/test";
import { Client } from "pg";

/**
 * Playwright global setup — populates fixture env vars from the preview DB.
 *
 * Phase 10 access-control specs depend on three env vars to skip API
 * discovery against non-existent /api/admin/* endpoints:
 *   - TEST_LOCATION_ID
 *   - TEST_OPS_IT_ROLE_ID
 *   - TEST_VIEWER_USER_ID
 *
 * Without them, the specs' fallback API calls 404 → return null →
 * navigate to /locations/null → assertion fails for the wrong reason.
 *
 * This globalSetup queries the preview DB once (per test run) and writes
 * the three IDs into process.env BEFORE any spec runs. Playwright runs
 * globalSetup in the same process as the runner, so env mutations
 * propagate to specs naturally.
 *
 * No-op when running locally (no PLAYWRIGHT_BASE_URL or no DATABASE_URL).
 * Operators who set the env vars manually continue to work — globalSetup
 * does not overwrite values that are already set.
 *
 * Plan 10-15 / gap-closure-round-3.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  // Bail when running local-dev mode. The webServer block in
  // playwright.config.ts handles `npm run dev` for localhost runs;
  // globalSetup only runs when an operator has pointed Playwright at
  // a real preview deployment with a DATABASE_URL to match.
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.log(
      "[globalSetup] PLAYWRIGHT_BASE_URL set but DATABASE_URL is not — skipping fixture-id discovery. Set DATABASE_URL to populate TEST_LOCATION_ID / TEST_OPS_IT_ROLE_ID / TEST_VIEWER_USER_ID automatically.",
    );
    return;
  }

  const viewerEmail =
    process.env.TEST_VIEWER_EMAIL ?? "viewer.test@weknowgroup.com";

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();

    // Run all three lookups in parallel. Failures on any one
    // produce a console warning but do not abort — the spec will
    // fall through to its existing fallback path and either skip
    // gracefully (e.g. test navigates to /locations/null and
    // /pageErrors stays empty) or fail with a clearer error.
    const [locationRes, opsItRes, viewerRes] = await Promise.allSettled([
      client.query<{ id: string }>("SELECT id FROM locations LIMIT 1"),
      client.query<{ id: string }>(
        "SELECT id FROM roles WHERE name = $1 LIMIT 1",
        ["ops-it"],
      ),
      client.query<{ id: string }>(
        'SELECT id FROM "user" WHERE email = $1 LIMIT 1',
        [viewerEmail],
      ),
    ]);

    // Respect operator-set env vars — don't overwrite.
    if (!process.env.TEST_LOCATION_ID) {
      if (locationRes.status === "fulfilled" && locationRes.value.rows[0]) {
        process.env.TEST_LOCATION_ID = locationRes.value.rows[0].id;
        console.log(
          `[globalSetup] TEST_LOCATION_ID=${process.env.TEST_LOCATION_ID}`,
        );
      } else {
        console.warn(
          "[globalSetup] Could not resolve TEST_LOCATION_ID — specs will use their fallback path.",
        );
      }
    }

    if (!process.env.TEST_OPS_IT_ROLE_ID) {
      if (opsItRes.status === "fulfilled" && opsItRes.value.rows[0]) {
        process.env.TEST_OPS_IT_ROLE_ID = opsItRes.value.rows[0].id;
        console.log(
          `[globalSetup] TEST_OPS_IT_ROLE_ID=${process.env.TEST_OPS_IT_ROLE_ID}`,
        );
      } else {
        console.warn(
          "[globalSetup] Could not resolve TEST_OPS_IT_ROLE_ID — specs will use their fallback path.",
        );
      }
    }

    if (!process.env.TEST_VIEWER_USER_ID) {
      if (viewerRes.status === "fulfilled" && viewerRes.value.rows[0]) {
        process.env.TEST_VIEWER_USER_ID = viewerRes.value.rows[0].id;
        console.log(
          `[globalSetup] TEST_VIEWER_USER_ID=${process.env.TEST_VIEWER_USER_ID}`,
        );
      } else {
        console.warn(
          `[globalSetup] Could not resolve TEST_VIEWER_USER_ID for email=${viewerEmail} — specs will use their fallback path.`,
        );
      }
    }
  } finally {
    await client.end();
  }
}
