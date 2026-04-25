import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@settings/audit-log renders PageHeader with title", async ({ page }) => {
  await signInAsAdmin(page);
  await page.goto("/settings/audit-log");

  await expect(
    page.getByRole("heading", { name: "Audit Log", level: 1 }),
  ).toBeVisible();
});

test("@settings/audit-log renders a non-empty body for admin", async ({
  page,
}) => {
  // Dev DB is seeded with plenty of audit log entries from prior tasks
  // (outlet-type classifications, region reassignments, monday imports,
  // etc.) so we expect at least one tbody row OR the empty state — never
  // a blank page or a runtime error.
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/audit-log");

  await expect(
    page.getByRole("heading", { name: "Audit Log", level: 1 }),
  ).toBeVisible();

  // Filter bar must mount — Apply button is the cheapest "the client island
  // hydrated" signal.
  await expect(page.getByRole("button", { name: "Apply" })).toBeVisible();

  // Either a row or the empty state — both are acceptable; what we're
  // proving is that the page doesn't blow up on real data.
  const firstRow = page.locator("tbody tr").first();
  const emptyState = page.getByText("No audit log entries match these filters.");
  await expect(firstRow.or(emptyState)).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("@settings/audit-log page does not throw", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/audit-log");

  await expect(
    page.getByRole("heading", { name: "Audit Log", level: 1 }),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("@settings/audit-log dark-mode toggle does not throw", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/settings/audit-log");

  await expect(
    page.getByRole("heading", { name: "Audit Log", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Audit Log", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Audit Log", level: 1 }),
  ).toBeVisible();
});
