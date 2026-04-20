import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Verifies the react-big-calendar toolbar renders with shadcn <Button>
 * components instead of the default react-big-calendar styling.
 *
 * Covers Task #4 from the Vercel bug sweep.
 */

test.describe("Calendar toolbar theme", () => {
  test("shadcn-themed nav + view buttons render on /installations?view=calendar", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/installations?view=calendar");

    // Wait for the calendar toolbar to be in the DOM.
    const toolbar = page.locator(".rbc-calendar-wk").first();
    await expect(toolbar).toBeVisible();

    // Nav buttons: Previous / Today / Next
    const previousBtn = page.getByRole("button", { name: /previous/i });
    const todayBtn = page.getByRole("button", { name: /^today$/i });
    const nextBtn = page.getByRole("button", { name: /next/i }).first();

    await expect(previousBtn).toBeVisible();
    await expect(todayBtn).toBeVisible();
    await expect(nextBtn).toBeVisible();

    // View mode buttons: Month / Week / Day
    const monthBtn = page.getByRole("button", { name: /^month$/i });
    const weekBtn = page.getByRole("button", { name: /^week$/i });
    const dayBtn = page.getByRole("button", { name: /^day$/i });

    await expect(monthBtn).toBeVisible();
    await expect(weekBtn).toBeVisible();
    await expect(dayBtn).toBeVisible();

    // data-slot="button" is rendered by the shadcn <Button> primitive — proves
    // we are no longer using the default react-big-calendar toolbar buttons.
    await expect(todayBtn).toHaveAttribute("data-slot", "button");
    await expect(monthBtn).toHaveAttribute("data-slot", "button");

    // Visual snapshot for diff review (not a strict assertion).
    await toolbar.screenshot({
      path: "test-results/calendar-toolbar-theme.png",
    });
  });
});
