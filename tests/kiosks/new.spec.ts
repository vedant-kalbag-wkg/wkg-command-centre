import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@kiosks new-kiosk page renders PageHeader with breadcrumb", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/kiosks/new");

  await expect(
    page.getByRole("heading", { name: "New kiosk", level: 1 })
  ).toBeVisible();
  // Breadcrumb back-link to Kiosks list
  await expect(
    page.getByRole("link", { name: "Kiosks" }).first()
  ).toBeVisible();
});
