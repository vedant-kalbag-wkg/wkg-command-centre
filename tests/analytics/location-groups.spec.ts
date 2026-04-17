import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("Location Groups", () => {
  test("page loads and shows location group list", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(
      "/analytics/location-groups?from=2025-01-01&to=2025-12-31",
    );

    await expect(
      page.getByRole("heading", { name: "Location Groups" }),
    ).toBeVisible();
    await expect(
      page.getByText("Performance analysis by location group"),
    ).toBeVisible();

    // Wait for group list to load — Group Metrics appears once a group auto-selects
    await expect(page.getByText("Group Metrics")).toBeVisible({
      timeout: 15000,
    });
  });

  test("capacity metrics visible", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto(
      "/analytics/location-groups?from=2025-01-01&to=2025-12-31",
    );

    // Wait for detail to load
    await expect(page.getByText("Capacity Metrics")).toBeVisible({
      timeout: 15000,
    });

    // The Capacity Metrics section should be present
    await expect(page.getByText("Peer Analysis")).toBeVisible();
    await expect(page.getByText("Hotels in Group")).toBeVisible();
  });
});
