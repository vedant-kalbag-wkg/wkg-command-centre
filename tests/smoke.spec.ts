import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "./helpers/auth";

test("@smoke homepage redirects or loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(kiosks|login)/);
});

test("@smoke app shell sidebar renders", async ({ page }) => {
  // Sidebar only renders inside the authenticated app shell; sign in first
  // so /kiosks isn't redirected to /login.
  await signInAsAdmin(page);
  await page.goto("/kiosks");

  // Primary entity nav links live inside the "Main navigation" landmark.
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav).toBeVisible();
  await expect(nav.getByText("Kiosks")).toBeVisible();
  await expect(nav.getByText("Locations")).toBeVisible();

  // Settings lives in the sidebar footer (outside the Main navigation
  // landmark) — assert it renders as a sidebar link instead.
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
});
