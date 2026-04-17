import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Hotel Groups", () => {
  test("page loads and shows hotel group list with 2025 data", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/hotel-groups?from=2025-01-01&to=2025-12-31");

    await expect(
      page.getByRole("heading", { name: "Hotel Groups" }),
    ).toBeVisible();
    await expect(page.getByText("Hotel Groups").first()).toBeVisible();

    // Wait for groups list to load — should show at least one group
    // The GroupSelector renders group items; once loaded, skeleton disappears
    await expect(page.getByText("Group Metrics")).toBeVisible({
      timeout: 15000,
    });
  });

  test("selecting a group shows detail view with KPI cards", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/hotel-groups?from=2025-01-01&to=2025-12-31");

    // Wait for the detail sections to render (auto-selects first group)
    await expect(page.getByText("Group Metrics")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("Hotels in Group")).toBeVisible();
    await expect(page.getByText("Daily Trends")).toBeVisible();
  });
});
