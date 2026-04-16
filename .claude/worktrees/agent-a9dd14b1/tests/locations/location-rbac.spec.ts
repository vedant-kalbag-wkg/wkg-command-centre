import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

async function createLocation(page: Parameters<typeof signInAsAdmin>[0], prefix: string) {
  await page.goto("/locations/new");
  const locationName = `${prefix}-${Date.now()}`;
  await page.getByPlaceholder("e.g. The Grand Hotel").fill(locationName);
  await page.getByRole("button", { name: "Create location" }).click();
  await expect(page).toHaveURL(/\/locations\/[0-9a-f-]+$/, { timeout: 15000 });
  return locationName;
}

test.describe("Location RBAC (LOC-04)", () => {
  // LOC-04: Admin sees banking and contract details
  test("LOC-04: admin can view banking section", async ({ page }) => {
    await signInAsAdmin(page);
    await createLocation(page, "RBAC-ADMIN");

    // Banking section should show the banking fields (not the restricted badge)
    const bankingSection = page.getByRole("button", { name: /^BANKING$/i });
    await expect(bankingSection).toBeVisible({ timeout: 5000 });

    // Admin should see banking fields, not restricted badge
    await expect(page.getByText("Account Name")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Account Number")).toBeVisible({ timeout: 5000 });
  });

  test("LOC-04: admin can view contract value and terms fields", async ({ page }) => {
    await signInAsAdmin(page);
    await createLocation(page, "RBAC-CONTRACT");

    // Contract section should show contract value and terms (not restricted badge)
    await expect(page.getByText("Contract Value")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Contract Terms")).toBeVisible({ timeout: 5000 });

    // Should NOT show the restricted badge for admin
    await expect(
      page.getByText("Restricted — contact your admin for access.")
    ).not.toBeVisible();
  });

  // NOTE: Viewer tests require member/viewer users to be seeded (see tests/helpers/auth.ts TODO)
  // These are kept as fixme until db:seed creates viewer users
  test.fixme("LOC-04: viewer sees restricted badge on banking section", async ({ page }) => {
    // TODO: implement after viewer user is seeded in db:seed
    void page;
  });

  test.fixme("LOC-04: viewer sees restricted badge on contract value/terms", async ({ page }) => {
    // TODO: implement after viewer user is seeded in db:seed
    void page;
  });
});
