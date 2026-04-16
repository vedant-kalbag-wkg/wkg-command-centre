import { test, expect } from "@playwright/test";

test("@smoke homepage redirects or loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(kiosks|login)/);
});

test("@smoke app shell sidebar renders", async ({ page }) => {
  await page.goto("/kiosks");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByText("Kiosks")).toBeVisible();
  await expect(nav.getByText("Locations")).toBeVisible();
  await expect(nav.getByText("Settings")).toBeVisible();
});
