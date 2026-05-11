/**
 * Wave 0 RED scaffold — role-editor.spec.ts
 *
 * Playwright E2E spec for /settings/roles list + create role UI.
 * AUTH-07 SC4: admin creates a custom role with explicit rules, asserts toast
 * confirmation, and asserts the new row appears in the role list.
 *
 * Fails because /settings/roles does not exist until Plan 10-04 (Wave 3).
 * Do NOT make this pass in this plan — Plan 10-08 verifies against preview alias.
 */
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test.describe("role editor — /settings/roles", () => {
  test("admin can navigate to /settings/roles and see Roles heading", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await signInAsAdmin(page);
    await page.goto("/settings/roles");

    // Fails because /settings/roles does not exist (Wave 3 creates it)
    await expect(
      page.getByRole("heading", { level: 1, name: "Roles" }),
    ).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("admin creates a custom role and sees toast + new row", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await signInAsAdmin(page);
    await page.goto("/settings/roles");

    // Click "Create role" button
    await page.getByRole("button", { name: /create role/i }).click();

    // Fill role form — display name + description
    await page.getByLabel(/display name/i).fill("Custom Kiosk Reader");
    await page.getByLabel(/description/i).fill("Can only read Kiosk");

    // Add a single rule: action=read, subject=Location
    await page.getByRole("button", { name: /add rule/i }).click();
    await page.getByLabel(/action/i).selectOption("read");
    await page.getByLabel(/subject/i).selectOption("Location");

    // Submit the form
    await page.getByRole("button", { name: /^(save|create)$/i }).click();

    // Assert toast "Role created"
    await expect(
      page.getByRole("status").filter({ hasText: /role created/i }),
    ).toBeVisible();

    // Assert new row appears in the role list
    await expect(
      page.getByRole("row", { name: /custom kiosk reader/i }),
    ).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
