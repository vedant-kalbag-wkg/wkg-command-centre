import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

test("@etl/history renders PageHeader with title and does not throw", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/data-import/sales");

  await expect(
    page.getByRole("heading", { name: "Sales Ingestion History", level: 1 }),
  ).toBeVisible();

  // Either a data row or the empty-state message should render — the table
  // always mounts, we just want to confirm the render path completes.
  const emptyState = page.getByText("No ingestion runs yet.");
  const anyRow = page.locator("tbody tr").first();
  await expect(emptyState.or(anyRow)).toBeVisible();

  expect(pageErrors).toEqual([]);
});
