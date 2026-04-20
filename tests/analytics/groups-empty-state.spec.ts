import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

// UUID v4-ish pattern — used to assert no raw UUIDs leak into user-visible
// dropdown labels.
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function assertNoUuidInText(text: string, ctx: string) {
  expect(text, `${ctx} should not contain a UUID: "${text}"`).not.toMatch(
    UUID_PATTERN,
  );
}

async function expectMultiSelectOpensWithNameOptions(
  page: Page,
  triggerLabel: RegExp,
) {
  const trigger = page.getByRole("button", { name: triggerLabel }).first();
  await expect(trigger).toBeVisible({ timeout: 15_000 });

  // Trigger shows placeholder/label (not a UUID) before any selection.
  const triggerText = (await trigger.textContent())?.trim() ?? "";
  assertNoUuidInText(triggerText, "selector trigger placeholder");

  // Open the dropdown and verify options carry human-readable names.
  await trigger.click();
  const firstOption = page.getByRole("option").first();
  await expect(firstOption).toBeVisible({ timeout: 10_000 });

  const optionLabels = await page.getByRole("option").allTextContents();
  expect(optionLabels.length).toBeGreaterThan(0);
  for (const label of optionLabels) {
    assertNoUuidInText(label, "dropdown option label");
  }

  return { trigger, firstOption, firstLabel: optionLabels[0].trim() };
}

test("@analytics/hotel-groups shows empty-state overlay until a group is selected and dropdown shows names not UUIDs", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/hotel-groups");

  await expect(
    page.getByRole("heading", { name: "Hotel Groups", level: 1 }),
  ).toBeVisible();

  // Empty-state overlay is visible before any selection.
  await expect(page.getByText("Select a hotel group to view reports")).toBeVisible({
    timeout: 15_000,
  });

  // Open the selector and confirm options use group names (no UUID leakage).
  const { firstOption } = await expectMultiSelectOpensWithNameOptions(
    page,
    /select a hotel group/i,
  );

  // Pick the first option — overlay should dismiss, metrics should render.
  await firstOption.click();
  await page.keyboard.press("Escape");

  await expect(
    page.getByText("Select a hotel group to view reports"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Group Metrics/ }),
  ).toBeVisible({ timeout: 15_000 });
});

test("@analytics/location-groups shows empty-state overlay until a group is selected and dropdown shows names not UUIDs", async ({
  page,
}) => {
  await signInAsAdmin(page);
  await page.goto("/analytics/location-groups");

  await expect(
    page.getByRole("heading", { name: "Location Groups", level: 1 }),
  ).toBeVisible();

  await expect(
    page.getByText("Select a location group to view reports"),
  ).toBeVisible({ timeout: 15_000 });

  const { firstOption } = await expectMultiSelectOpensWithNameOptions(
    page,
    /select location group/i,
  );

  await firstOption.click();
  await page.keyboard.press("Escape");

  await expect(
    page.getByText("Select a location group to view reports"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Group Metrics/ }),
  ).toBeVisible({ timeout: 15_000 });
});
