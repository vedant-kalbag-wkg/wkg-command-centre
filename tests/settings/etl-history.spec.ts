import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@settings/data-import/azure renders PageHeader with title", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/settings/data-import/azure");

  await expect(
    page.getByRole("heading", { name: "Azure ETL Runs", level: 1 }),
  ).toBeVisible();
});

test("@settings/data-import/azure renders chrome (filters + KPI tiles) without throwing", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/data-import/azure");

  await expect(
    page.getByRole("heading", { name: "Azure ETL Runs", level: 1 }),
  ).toBeVisible();

  // Filter bar Apply button is the cheapest "client island hydrated" signal.
  await expect(page.getByRole("button", { name: "Apply" })).toBeVisible();

  // KPI tiles render their headings — these are the four tiles up top.
  await expect(page.getByText("Total processed", { exact: true })).toBeVisible();
  await expect(page.getByText("Last 7 days", { exact: true })).toBeVisible();
  await expect(page.getByText("Latest success", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Currently failed", { exact: true }),
  ).toBeVisible();

  // Either a row or the empty state — both acceptable; we're proving no
  // runtime error.
  const firstRow = page.locator("tbody tr").first();
  const emptyState = page.getByText(
    "No ETL runs recorded yet — has the Azure cron triggered?",
  );
  await expect(firstRow.or(emptyState)).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test("@settings/data-import/azure dark-mode toggle does not throw", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/settings/data-import/azure");

  await expect(
    page.getByRole("heading", { name: "Azure ETL Runs", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Azure ETL Runs", level: 1 }),
  ).toBeVisible();

  await page.evaluate(() => {
    document.documentElement.classList.toggle("dark");
  });
  await expect(
    page.getByRole("heading", { name: "Azure ETL Runs", level: 1 }),
  ).toBeVisible();
});
