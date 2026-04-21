import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Portfolio — High Performer Patterns KPI tiles", () => {
  test("@portfolio shows Avg Revenue / Room tile and not Avg Kiosks / Location", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    // Wait for the portfolio page shell to render.
    await expect(
      page.getByRole("heading", { name: "Portfolio", exact: true }),
    ).toBeVisible();

    // Scroll the patterns card into view if needed — it's below the fold.
    // Both HighPerformerPatterns and LowPerformerPatterns render a tile labeled
    // "Avg Revenue / Room", so target the first occurrence (High Performer).
    const revenuePerRoomTile = page
      .getByText("Avg Revenue / Room", { exact: true })
      .first();
    await revenuePerRoomTile.scrollIntoViewIfNeeded();
    await expect(revenuePerRoomTile).toBeVisible();

    // The old tile must be gone.
    await expect(
      page.getByText("Avg Kiosks / Location", { exact: true }),
    ).toHaveCount(0);
  });
});
