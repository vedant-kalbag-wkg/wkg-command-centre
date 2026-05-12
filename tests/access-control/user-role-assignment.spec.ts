/**
 * Wave 0 RED scaffold — user-role-assignment.spec.ts
 *
 * Playwright E2E spec for /settings/users/[id] role assignment block.
 * AUTH-07: admin assigns the Ops-IT role to a viewer user with a regional scope,
 * then asserts the new assignment row appears in the user's role list.
 *
 * Fails because /settings/users/[id] role-assignment block does not exist
 * until Plan 10-04 (Wave 3).
 * Do NOT make this pass in this plan — Plan 10-08 verifies against preview alias.
 */
import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";
import { TEST_VIEWER } from "../auth/setup";

/**
 * Look up a user's ID by email via the admin users API.
 * Falls back to TEST_VIEWER_USER_ID env var if the API is unavailable.
 * Plan 10-08 documents the operator handoff for setting this env var
 * on the Vercel preview environment.
 */
async function getUserIdByEmail(
  page: import("@playwright/test").Page,
  email: string,
): Promise<string | null> {
  if (process.env.TEST_VIEWER_USER_ID) {
    return process.env.TEST_VIEWER_USER_ID;
  }
  // Try the admin users list endpoint
  const response = await page.request.get("/api/admin/users");
  if (!response.ok()) {
    return null;
  }
  const json = await response.json();
  const users: Array<{ id: string; email: string }> = json?.users ?? json ?? [];
  const found = users.find((u) => u.email === email);
  return found?.id ?? null;
}

test.describe("user role assignment — /settings/users/[id]", () => {
  test("admin can navigate to viewer user profile and see role-assignment block", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await signInAsAdmin(page);

    const viewerUserId = await getUserIdByEmail(page, TEST_VIEWER.email);

    // Fails because /settings/users/[id] role-assignment block does not exist (Wave 3)
    await page.goto(`/settings/users/${viewerUserId ?? "unknown"}`);

    await expect(
      page.getByRole("region", { name: /role assignment/i }),
    ).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("admin assigns Ops-IT role to viewer user with south-west scope", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await signInAsAdmin(page);

    const viewerUserId = await getUserIdByEmail(page, TEST_VIEWER.email);
    await page.goto(`/settings/users/${viewerUserId ?? "unknown"}`);

    // Click "Assign role" button in the role-assignment block
    await page.getByRole("button", { name: /assign role/i }).click();

    // Pick Ops-IT from the role selector.
    // Radix Select is not a native <select> — Playwright's selectOption
    // API is incompatible; use the canonical click + option-click pattern.
    // Plan 10-15 / gap-closure-round-3.
    await page.getByLabel(/role/i).click();
    await page.getByRole("option", { name: /ops.?it/i }).click();

    // Add scope: region = south-west
    await page.getByRole("button", { name: /add scope/i }).click();
    // Same Radix limitation on the Dimension type select inside ManageScopesDialog.
    await page.getByLabel(/dimension type/i).click();
    await page.getByRole("option", { name: /region/i }).click();
    await page.getByLabel(/dimension (id|value)/i).fill("south-west");

    // Submit
    await page.getByRole("button", { name: /^(assign|save)$/i }).click();

    // Assert the new assignment row appears
    await expect(
      page.getByRole("row", { name: /ops.it/i }),
    ).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
