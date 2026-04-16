import { test } from "@playwright/test";

/**
 * View tab / URL routing tests — Wave 0 stubs.
 *
 * Covers ?view= query param routing for Gantt, Calendar, and Table tabs.
 * Will be implemented in Plan 03-02 once the installations page with tabs exists.
 */

test.describe("View Tab Routing", () => {
  test.fixme("?view=gantt loads Gantt tab", async ({ page }) => {
    void page;
  });

  test.fixme("?view=calendar loads Calendar tab", async ({ page }) => {
    void page;
  });

  test.fixme("?view=table loads Table tab (default)", async ({ page }) => {
    void page;
  });

  test.fixme("switching tabs updates URL query param", async ({ page }) => {
    void page;
  });
});
