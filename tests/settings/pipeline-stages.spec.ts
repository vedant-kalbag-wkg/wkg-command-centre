import { test, expect } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

test("@settings/pipeline-stages renders PageHeader with title", async ({
  page,
}) => {
  const errors: Error[] = [];
  page.on("pageerror", (err) => errors.push(err));

  await signInAsAdmin(page);
  await page.goto("/settings/pipeline-stages");

  // The PipelineStagesClient opens a Radix dialog on mount, which marks the
  // underlying page inert/aria-hidden. Use a raw DOM locator for the h1 so
  // we still verify the PageHeader rendered behind the modal.
  await expect(
    page.locator("h1", { hasText: "Pipeline Stages" })
  ).toBeVisible();

  expect(errors).toEqual([]);
});
