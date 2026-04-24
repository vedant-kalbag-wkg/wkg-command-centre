import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Minimal smoke test for the pivot-table server action.
 *
 * Drops the Revenue metric onto the "Values" drop zone, clicks Run, and asserts
 * the page renders without a 500 server response or uncaught error.
 */
test("@analytics/pivot-table runs a trivial query without 500", async ({ page }) => {
  const serverErrors: string[] = [];
  const pageErrors: Error[] = [];
  const pivotPostStatuses: number[] = [];

  page.on("pageerror", (err) => pageErrors.push(err));
  page.on("response", (resp) => {
    if (resp.status() >= 500) {
      serverErrors.push(`${resp.request().method()} ${resp.url()} → ${resp.status()}`);
    }
    if (
      resp.request().method() === "POST" &&
      resp.url().includes("/analytics/pivot-table")
    ) {
      pivotPostStatuses.push(resp.status());
    }
  });

  await signInAsAdmin(page);
  await page.goto("/analytics/pivot-table");

  await expect(
    page.getByRole("heading", { name: "Pivot Table", level: 1 }),
  ).toBeVisible();

  // Find the draggable "Revenue" metric chip in the Fields panel (left side).
  const revenueChip = page.locator('[role="button"][aria-roledescription="draggable"]', { hasText: "Revenue" }).first();

  // Find the Values drop zone. It has a uppercase "VALUES" label via CSS on the span.
  // Match the inner zone container that uses border-dashed.
  const valuesZone = page
    .locator("div.min-h-\\[56px\\].border-dashed")
    .filter({ hasText: "Drop metrics here" })
    .first();

  await expect(revenueChip).toBeVisible();
  await expect(valuesZone).toBeVisible();

  // Perform a multi-step mouse drag to satisfy dnd-kit PointerSensor distance=5 constraint.
  const chipBox = await revenueChip.boundingBox();
  const zoneBox = await valuesZone.boundingBox();
  if (!chipBox || !zoneBox) throw new Error("Could not locate drag handles");

  const startX = chipBox.x + chipBox.width / 2;
  const startY = chipBox.y + chipBox.height / 2;
  const endX = zoneBox.x + zoneBox.width / 2;
  const endY = zoneBox.y + zoneBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Cross the 5px activation threshold
  await page.mouse.move(startX + 20, startY, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 20 });
  await page.mouse.up();

  // Small settle delay so the drop-commit state flushes through React before
  // we click. Without this, the button can look enabled but the click handler
  // still sees an empty `values` array from a stale closure.
  await page.waitForTimeout(200);

  // Click Run Analysis and wait for the pivot server-action POST to resolve.
  const runBtn = page.getByRole("button", { name: /Run Analysis/i });
  await expect(runBtn).toBeEnabled({ timeout: 5000 });

  const responsePromise = page.waitForResponse(
    (resp) =>
      resp.request().method() === "POST" &&
      resp.url().includes("/analytics/pivot-table"),
    { timeout: 15000 },
  );
  await runBtn.click({ force: true });
  const actionResp = await responsePromise;

  // The server action must not return a 5xx.
  expect(actionResp.status()).toBeLessThan(500);
  for (const status of pivotPostStatuses) {
    expect(status).toBeLessThan(500);
  }
  expect(serverErrors).toEqual([]);

  // A result table (or an empty-result message) should render.
  const resultSettled = page.getByText(/^Total$|No results\./).first();
  await expect(resultSettled).toBeVisible({ timeout: 10000 });

  // No uncaught page errors
  expect(pageErrors.map((e) => e.message)).toEqual([]);

  // No visible error banner
  const errorBanner = page.locator("text=/failed query|server error|internal error/i");
  await expect(errorBanner).toHaveCount(0);
});
