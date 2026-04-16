import { type Page } from "@playwright/test";

/**
 * Shared installation test helpers for Phase 3 tests.
 *
 * NOTE: createTestInstallation is a stub until CRUD pages exist in Plan 03-02.
 * cleanupTestInstallations provides direct DB cleanup for test teardown.
 */

/**
 * Create a test installation via the UI and return its detail page URL.
 *
 * TODO: implement after CRUD pages exist (Plan 03-02)
 */
export async function createTestInstallation(
  page: Page,
  data?: Partial<{
    name: string;
    region: string;
    status: "planned" | "active" | "complete";
    plannedStart: string;
    plannedEnd: string;
  }>
): Promise<string> {
  // TODO: implement after CRUD pages exist (Plan 03-02)
  // Navigate to /installations/new, fill form with defaults + overrides, submit
  // Return the created installation's URL (parsed from redirect)
  void page;
  void data;
  return "/installations/test";
}

/**
 * Cleanup test installations created during test runs.
 *
 * For now this is a no-op — tests should be idempotent and use unique identifiers.
 *
 * TODO: implement via direct DB delete once server actions exist
 */
export async function cleanupTestInstallations(): Promise<void> {
  // Placeholder — tests should be idempotent
  // TODO: use drizzle to delete installations where name like 'TEST-*'
}
