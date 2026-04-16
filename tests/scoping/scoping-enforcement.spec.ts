/**
 * Scoping enforcement E2E spec — SKIPPED until M6 lands the analytics routes.
 *
 * Contract:
 *   - External user scoped to hotel_group=A sees ONLY sales for locations in HG-A.
 *   - External user scoped to provider=Uber sees ONLY Uber sales.
 *   - Internal admin sees all rows regardless of seed state.
 *   - External user with zero scopes → 403 / redirect / clear error (not silent empty).
 *
 * Re-enable by removing `.skip` in M6 once /analytics/portfolio or equivalent
 * route lands, and the API route uses scopedSalesCondition() in its handler.
 */
import { test, expect } from '@playwright/test';

test.describe.skip('Scoping enforcement (awaiting M6 routes)', () => {
  test('admin sees all sales across hotel groups', async ({ page }) => {
    // TODO(M6): sign in as admin, navigate to /analytics/portfolio,
    // assert rows from both hotel groups are visible.
    expect(true).toBe(true);
  });

  test('external user scoped to hotel_group=A sees only HG-A sales', async ({ page }) => {
    // TODO(M6): seed user with userScopes(hotel_group=A), sign in,
    // hit /analytics/portfolio, assert only HG-A locations visible.
    expect(true).toBe(true);
  });

  test('external user scoped to provider=Uber sees only Uber sales', async ({ page }) => {
    // TODO(M6): seed user with userScopes(provider=Uber), sign in,
    // hit /analytics/portfolio, assert only Uber-provider rows.
    expect(true).toBe(true);
  });

  test('external user with zero scopes is blocked (403 or clear empty-state)', async ({ page }) => {
    // TODO(M6): seed external user with no userScopes rows, sign in attempt
    // should be blocked at invite-accept (per design doc). If they somehow
    // log in, any /analytics/* hit must 403 — not silently return empty.
    expect(true).toBe(true);
  });
});
