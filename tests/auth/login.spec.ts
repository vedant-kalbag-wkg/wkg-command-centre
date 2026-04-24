import { test, expect } from "@playwright/test";
import { TEST_ADMIN } from "../helpers/auth";

test.describe("Login page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("shows login form with email, password, sign in button", async ({
    page,
  }) => {
    await expect(page.getByText("Sign in to WeKnow")).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.locator("#password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in" })
    ).toBeVisible();
  });

  test("shows validation errors for empty fields on submit", async ({
    page,
  }) => {
    // Click sign in with empty fields
    await page.getByRole("button", { name: "Sign in" }).click();

    // After submitting empty form, validation errors should appear
    await expect(page.getByText("Email is required")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Password is required")).toBeVisible({
      timeout: 5000,
    });
  });

  test("@smoke user can sign in with valid credentials and land on /kiosks", async ({
    page,
  }) => {
    await page.getByLabel("Email address").fill(TEST_ADMIN.email);
    await page.locator("#password").fill(TEST_ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/kiosks/, { timeout: 10000 });
  });

  test("shows error toast for invalid credentials", async ({ page }) => {
    await page.getByLabel("Email address").fill("wrong@example.com");
    await page.locator("#password").fill("wrongpassword");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Sonner toast should appear
    await expect(
      page.getByText("Invalid email or password")
    ).toBeVisible({ timeout: 5000 });
  });

  test("forgot password link navigates to /reset-password", async ({
    page,
  }) => {
    await page.getByText("Forgot password?").click();
    await expect(page).toHaveURL(/\/reset-password/);
  });

  test("no sign up link or register option visible", async ({ page }) => {
    await expect(page.getByText("Sign up")).not.toBeVisible();
    await expect(page.getByText("Register")).not.toBeVisible();
    await expect(page.getByText("Create account")).not.toBeVisible();
  });
});
