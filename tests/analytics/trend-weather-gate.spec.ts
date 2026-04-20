import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Auth helper with fallback: prefer signInAsAdmin (seeded creds). If those
 * fail in dev environments where the admin password was rotated, fall back
 * to injecting the session cookie from auth.json at the repo root.
 */
async function authenticateAdmin(
  page: import("@playwright/test").Page,
  baseURL: string | undefined,
) {
  const authJsonPath = join(process.cwd(), "auth.json");
  if (existsSync(authJsonPath)) {
    try {
      const raw = JSON.parse(readFileSync(authJsonPath, "utf-8")) as {
        cookies?: Array<{
          name: string;
          value: string;
          domain: string;
          path: string;
          expires?: number;
          httpOnly?: boolean;
          secure?: boolean;
          sameSite?: "Strict" | "Lax" | "None";
        }>;
      };
      if (raw.cookies?.length) {
        await page.context().addCookies(raw.cookies);
        await page.goto(baseURL ?? "http://localhost:3003");
        // If cookie is valid we'll not get redirected to /login
        return;
      }
    } catch {
      /* fall through to credentials path */
    }
  }
  await signInAsAdmin(page);
}

/**
 * Task #11 — Weather toggle on /analytics/trend-builder must be disabled
 * unless exactly one location group is effectively selected (per-series
 * OR global analytics filter bar, whichever is tighter).
 *
 * The weather-toggle wrapper exposes `data-weather-allowed="true|false"`
 * so tests can assert the gate state deterministically.
 */

const TREND_BUILDER_PATH = "/analytics/trend-builder";

test.describe("Trend Builder — weather gate", () => {
  test("weather toggle is disabled by default (zero location groups selected)", async ({
    page,
    baseURL,
  }) => {
    await authenticateAdmin(page, baseURL);
    await page.goto(TREND_BUILDER_PATH);

    await expect(
      page.getByRole("heading", { name: "Trend Builder", level: 1 }),
    ).toBeVisible();

    const weatherWrapper = page.getByTestId("weather-toggle-wrapper");
    await expect(weatherWrapper).toBeVisible();
    await expect(weatherWrapper).toHaveAttribute(
      "data-weather-allowed",
      "false",
    );

    // The underlying Switch is disabled
    const weatherSwitch = page.locator("#show-weather");
    await expect(weatherSwitch).toBeDisabled();
  });

  test("hovering the disabled weather toggle shows the explanatory tooltip", async ({
    page,
    baseURL,
  }) => {
    await authenticateAdmin(page, baseURL);
    await page.goto(TREND_BUILDER_PATH);

    await expect(
      page.getByRole("heading", { name: "Trend Builder", level: 1 }),
    ).toBeVisible();

    const weatherWrapper = page.getByTestId("weather-toggle-wrapper");
    await expect(weatherWrapper).toHaveAttribute(
      "data-weather-allowed",
      "false",
    );

    await weatherWrapper.hover();
    await expect(
      page.getByText(
        "Weather requires exactly one location group selected",
      ),
    ).toBeVisible();
  });

  test("selecting exactly one location group on a series enables the weather toggle", async ({
    page,
    baseURL,
  }) => {
    await authenticateAdmin(page, baseURL);
    await page.goto(TREND_BUILDER_PATH);

    await expect(page.getByText("Builder Panel")).toBeVisible();

    // Scope to the Builder Panel (exclude any global filter bar duplicates)
    const panel = page
      .getByRole("heading", { name: "Builder Panel" })
      .locator("..")
      .locator("..");

    // Open the per-series "Location Groups" multi-select on the first row
    const locationGroupsTrigger = panel
      .getByRole("button", { name: /^Location Groups/ })
      .first();
    await expect(locationGroupsTrigger).toBeVisible();
    await locationGroupsTrigger.click();

    // Select the first available location group option
    const firstOption = page
      .getByRole("option")
      .or(page.locator('[cmdk-item]'))
      .first();
    await expect(firstOption).toBeVisible({ timeout: 5000 });
    await firstOption.click();

    // Close the popover
    await page.keyboard.press("Escape");

    // Apply the pending changes so appliedSeries picks up the new filter
    await page.getByRole("button", { name: "Apply", exact: true }).click();

    // Weather gate should flip to allowed
    const weatherWrapper = page.getByTestId("weather-toggle-wrapper");
    await expect(weatherWrapper).toHaveAttribute(
      "data-weather-allowed",
      "true",
    );
    await expect(page.locator("#show-weather")).toBeEnabled();
  });

  test("adding a second location group disables the weather toggle again", async ({
    page,
    baseURL,
  }) => {
    await authenticateAdmin(page, baseURL);
    await page.goto(TREND_BUILDER_PATH);

    await expect(page.getByText("Builder Panel")).toBeVisible();

    const panel = page
      .getByRole("heading", { name: "Builder Panel" })
      .locator("..")
      .locator("..");

    const locationGroupsTrigger = panel
      .getByRole("button", { name: /^Location Groups/ })
      .first();
    await locationGroupsTrigger.click();

    // Pick two options
    const options = page.getByRole("option").or(page.locator('[cmdk-item]'));
    await expect(options.first()).toBeVisible({ timeout: 5000 });
    const count = await options.count();
    test.skip(
      count < 2,
      "Need at least 2 location groups in seed data to exercise the multi-group path",
    );

    await options.nth(0).click();
    await options.nth(1).click();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Apply", exact: true }).click();

    const weatherWrapper = page.getByTestId("weather-toggle-wrapper");
    await expect(weatherWrapper).toHaveAttribute(
      "data-weather-allowed",
      "false",
    );
    await expect(page.locator("#show-weather")).toBeDisabled();
  });
});
