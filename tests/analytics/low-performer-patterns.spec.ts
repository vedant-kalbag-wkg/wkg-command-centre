import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Low Performer Patterns + threshold editor", () => {
  test("@portfolio high and low performer cards + threshold editor render", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    // Portfolio header proves we landed on the page
    await expect(
      page.getByRole("heading", { name: "Portfolio", exact: true }),
    ).toBeVisible();

    // Both performer-pattern cards are present
    await expect(
      page.getByRole("heading", {
        name: "High Performer Patterns",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Low Performer Patterns",
        exact: true,
      }),
    ).toBeVisible();

    // Threshold editor + both inputs
    await expect(
      page.getByRole("heading", {
        name: "Performer Tier Thresholds",
        exact: true,
      }),
    ).toBeVisible();
    const greenInput = page.getByLabel("Green cutoff percent");
    const redInput = page.getByLabel("Red cutoff percent");
    await expect(greenInput).toBeVisible();
    await expect(redInput).toBeVisible();
  });

  test("@portfolio changing green from 30 to 20 keeps low-performer card visible", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    await expect(
      page.getByRole("heading", {
        name: "Low Performer Patterns",
        exact: true,
      }),
    ).toBeVisible();

    const greenInput = page.getByLabel("Green cutoff percent");
    await greenInput.fill("20");
    // Blur so onChange commits
    await greenInput.press("Tab");

    // Low-performer card still visible
    await expect(
      page.getByRole("heading", {
        name: "Low Performer Patterns",
        exact: true,
      }),
    ).toBeVisible();
    // No validation error surfaced inside the threshold editor
    const editorAlert = page
      .locator("div", { hasText: "Performer Tier Thresholds" })
      .getByRole("alert");
    await expect(editorAlert).toHaveCount(0);
    // Summary text shows 20/60/30 split
    await expect(
      page.getByText(/Green 20% \/ Yellow 50% \/ Red 30%/),
    ).toBeVisible();
  });
});
