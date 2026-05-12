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

    // Add a single rule: action=read, subject=Location.
    //
    // NOTE (Plan 10-15 / gap-closure-round-3 / assumption #7):
    // The Create dialog's handleCreate (role-list-client.tsx:84) closes
    // the dialog and refreshes the list without navigating to the new
    // role's editor — the "Add rule" button lives on /settings/roles/[id]
    // (role-editor-client.tsx:735), not in the dialog. This means the
    // line below will likely STILL TIMEOUT post-Plan-10-15 because the
    // "Add rule" button is not in the spec's reachable DOM. The fix is
    // either (a) UX redesign: unified create-with-rules dialog, or
    // (b) split this spec into create-only + edit-and-add-rule. Plan
    // 10-15's scope is the selectOption→click+option replacement only
    // (lines 50-51); the click on Add rule remains as-is so the
    // failure surface is deterministic.
    //
    // ALSO: line 50 below — getByLabel(/action/i) — does NOT resolve
    // even when the Add rule button is reachable, because actions are
    // rendered as ActionChips (button chips, role-editor-client.tsx:553-562),
    // NOT as a labelled select. This selector has no fix at this
    // component layer; the spec re-shape is needed.
    await page.getByRole("button", { name: /add rule/i }).click();

    // Radix Select replacement for selectOption — applies only to the
    // Subject Select at role-editor-client.tsx:534-549 (line 51 in this
    // spec). Line 50 (action) is unfixable here — see note above.
    await page.getByLabel(/action/i).click();
    await page.getByRole("option", { name: /^read$/i }).click();
    await page.getByLabel(/subject/i).click();
    await page.getByRole("option", { name: /^Location$/i }).click();

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
