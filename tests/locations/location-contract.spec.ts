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

test.describe("Location Contract (LOC-03)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("LOC-03: can view contract fields on location detail", async ({ page }) => {
    await createLocation(page, "CONTRACT-VIEW");

    // Navigate to the Contract section — click the collapsible trigger to expand if needed
    const contractSection = page.getByRole("button", { name: /^CONTRACT$/i });
    await expect(contractSection).toBeVisible({ timeout: 5000 });

    // Section should be expanded by default — Contract Documents should be visible
    await expect(page.getByText("Contract Documents")).toBeVisible({ timeout: 5000 });
  });

  test("LOC-03: contract upload button is present", async ({ page }) => {
    await createLocation(page, "UPLOAD-BTN");

    // Contract section should show Upload document button
    await expect(page.getByRole("button", { name: "Upload document" })).toBeVisible({
      timeout: 5000,
    });
  });

  test("LOC-03: file too large shows error message", async ({ page }) => {
    await createLocation(page, "FILE-SIZE");

    // Trigger file input with a large file via DataTransfer API mock
    // Inject a mock file exceeding 10 MB into the hidden file input
    const uploadBtn = page.getByRole("button", { name: "Upload document" });
    await expect(uploadBtn).toBeVisible({ timeout: 5000 });

    // Set a large file on the input via page.evaluate
    await page.evaluate(() => {
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (!input) return;

      // Create a mock large file
      const largeContent = new ArrayBuffer(11 * 1024 * 1024); // 11 MB
      const file = new File([largeContent], "large-file.pdf", { type: "application/pdf" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      input.files = dataTransfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // Should show file too large error
    await expect(
      page.getByText("File too large. Maximum size is 10 MB.")
    ).toBeVisible({ timeout: 5000 });
  });
});
