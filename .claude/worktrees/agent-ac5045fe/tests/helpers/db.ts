import { type Page } from "@playwright/test";

/**
 * Shared DB test helpers for Phase 2 tests.
 *
 * These functions navigate the app UI to create test records,
 * ensuring tests don't depend on manual DB state.
 *
 * NOTE: All implementations are placeholders until CRUD pages exist.
 * TODO: implement after CRUD pages exist (Plan 02-01/02-02)
 */

/**
 * Create a test kiosk via the UI and return its detail page URL.
 *
 * TODO: implement after CRUD pages exist (Plan 02-01)
 */
export async function createTestKiosk(
  page: Page,
  overrides?: Partial<{ kioskId: string; outletCode: string }>
): Promise<string> {
  // TODO: implement after CRUD pages exist (Plan 02-01)
  // Navigate to /kiosks/new, fill form with defaults + overrides, submit
  // Return the created kiosk's URL (parsed from redirect)
  void page;
  void overrides;
  return "/kiosks/test";
}

/**
 * Create a test location via the UI and return its detail page URL.
 *
 * TODO: implement after CRUD pages exist (Plan 02-02)
 */
export async function createTestLocation(
  page: Page,
  overrides?: Partial<{ name: string; address: string }>
): Promise<string> {
  // TODO: implement after CRUD pages exist (Plan 02-02)
  // Navigate to /locations/new, fill form with defaults + overrides, submit
  // Return the created location's URL
  void page;
  void overrides;
  return "/locations/test";
}

/**
 * Archive/cleanup test data created during test runs.
 *
 * For now this is a no-op — tests should be idempotent and
 * use unique identifiers to avoid conflicts between runs.
 *
 * TODO: implement archive via API once endpoints exist (Plan 02-01/02-02)
 */
export async function cleanupTestData(): Promise<void> {
  // Placeholder — tests should be idempotent
  // TODO: archive test records or truncate via API once endpoints exist
}
