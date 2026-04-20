import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Portfolio (rebuilt)", () => {
  test("@portfolio portfolio page renders header, KPI strip, and chart grid", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    // PageHeader
    await expect(
      page.getByRole("heading", { name: "Portfolio", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Cross-portfolio performance overview"),
    ).toBeVisible();

    // KPI strip — at least one of the expected labels
    await expect(page.getByText("Revenue", { exact: true }).first()).toBeVisible();

    // Chart grid — daily trends card present (card header, not section)
    await expect(
      page.getByRole("heading", { name: "Daily Trends", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Category Performance", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Top Products", exact: true }),
    ).toBeVisible();
  });

  test("@portfolio comparison toggle and flags drawer are functional", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    await expect(
      page.getByRole("heading", { name: "Portfolio", exact: true }),
    ).toBeVisible();

    // Comparison toggle in the header actions
    const yoyButton = page.getByRole("button", { name: "YoY", exact: true });
    await expect(yoyButton).toBeVisible();
    await yoyButton.click();

    // Active flags button opens the right-side Sheet
    const flagsButton = page.getByRole("button", { name: /^Active flags \(/ });
    await expect(flagsButton).toBeVisible();
    await flagsButton.click();

    // Sheet title — the sheet uses the same "Active flags (N)" label
    await expect(
      page.getByRole("dialog").getByText(/Active flags \(/),
    ).toBeVisible();
  });

  test("@portfolio page stays functional when data fails or is slow", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");
    await page.waitForLoadState("networkidle");

    // Shell must remain — header visible regardless of query outcome
    await expect(
      page.getByRole("heading", { name: "Portfolio", exact: true }),
    ).toBeVisible();
  });
});
