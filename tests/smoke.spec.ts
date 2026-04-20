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

  // Sidebar nav links are rendered as accessible <a> elements inside the
  // shadcn Sidebar primitive (no <nav> landmark).
  await expect(page.getByRole("link", { name: "Kiosks" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Locations" })).toBeVisible();

  // Top bar renders its controls: sidebar trigger and theme toggle.
  await expect(page.getByRole("button", { name: "Toggle Sidebar" }).first()).toBeVisible();
});
