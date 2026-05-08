import { test, expect } from "@playwright/test";

import { signInAsAdmin } from "../helpers/auth";

/**
 * Phase 7 Plan 07-03 — Location merge UI + Undo (DATA-02 / DATA-04 D-07).
 *
 * Three test cases mirror the plan's behavior contract:
 *   1. N→1 merge happy path — multi-select 2 rows, open dialog, verify the
 *      consequences preview block renders with the locked UI-SPEC bullets.
 *      The destructive merge confirmation (`Merge locations` click) is gated
 *      by `PLAYWRIGHT_DESTRUCTIVE=1` so default `--list` and default test
 *      runs DO NOT mutate any DB. Required by 07-03 threat T-07.03-06.
 *   2. Undo button visible on a merge audit-log entry detail page —
 *      navigates to /admin/audit-log/[id] and asserts the Undo merge button
 *      is rendered. Requires the UAT branch to have at least one merge entry
 *      whose snapshot still exists.
 *   3. Undo locked when snapshot is missing — operator-seeded scenario
 *      (a merge whose snapshot has been undone, so the page renders the
 *      "Undo no longer available" copy). Skipped unless PLAYWRIGHT_DESTRUCTIVE.
 *
 * Per CLAUDE.md "Playwright specs against preview deploys": this spec MUST be
 * run with `PLAYWRIGHT_BASE_URL=<vercel-preview-alias>` against the UAT
 * branch in Plan E. Listing-only (`--list`) is not sufficient evidence.
 */
test.describe("Location merge UI (DATA-02)", () => {
  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("@phase-7 N→1 merge consequences preview renders for 2 selected rows", async ({
    page,
  }) => {
    // Seed assumption: UAT branch has at least one same-name location pair
    // (Residence Inn cluster from prod). Plan B's reseeded UAT branch
    // satisfies this. Local dev runs would need the seed step from
    // tasks/v2-carryover-from-v1-phase-6.md.
    await page.goto("/locations");
    await expect(page.getByRole("heading", { name: "Locations" })).toBeVisible();

    // Filter the table down to a known same-name cluster.
    const search = page.getByPlaceholder(/search/i).first();
    await search.fill("Residence Inn");

    // Multi-select the first two visible rows via their row checkboxes.
    const checkboxes = page.locator("tbody tr input[type=checkbox]");
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    // BulkToolbar surfaces a Merge button at selectedCount >= mergeMinCount (2).
    await page.getByRole("button", { name: /^Merge$/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Merge \d+ locations?/),
    ).toBeVisible();

    // Pick the first row as canonical (clicks the picker tile).
    await dialog.locator("button").filter({ hasText: /will be archived/ }).first().click();

    // Consequences preview bullets — lock the literals against UI-SPEC drift.
    await expect(dialog.getByText("What will happen")).toBeVisible();
    await expect(dialog.getByText(/will be archived/)).toBeVisible();
    await expect(
      dialog.getByText("A snapshot of original data will be saved to audit log"),
    ).toBeVisible();

    // Destructive confirmation is opt-in only (T-07.03-06). Default --list
    // and default test run NEVER click Merge locations.
    if (process.env.PLAYWRIGHT_DESTRUCTIVE === "1") {
      await dialog.getByRole("button", { name: "Merge locations" }).click();
      await expect(page.getByText(/merged|archived/i)).toBeVisible();
    } else {
      // Cancel out — leaves DB state untouched.
      await dialog.getByRole("button", { name: "Cancel" }).click();
    }
  });

  test("@phase-7 undo button visible on merge audit-log entry detail page", async ({
    page,
  }) => {
    // Walk the audit-log list, follow the first merge entry to the new
    // /admin/audit-log/[id] detail page.
    await page.goto("/settings/audit-log");
    const mergeRow = page
      .getByRole("row")
      .filter({ hasText: /merge/i })
      .first();
    await expect(mergeRow).toBeVisible();
    // Audit-log table doesn't yet render row links to /admin/audit-log/[id]
    // (that wiring lands in a follow-up plan). Until then, navigate via the
    // URL directly: pull the entry id from the row's data attribute or visit
    // the explicit admin route. Operator-driven manual navigation in the
    // checkpoint covers the click-through; this spec only asserts the
    // detail-page surface itself.
    test.skip(
      process.env.PLAYWRIGHT_DESTRUCTIVE !== "1",
      "Detail-page assertion requires a known merge audit id — operator passes via env in Plan E.",
    );
    const auditId = process.env.UAT_MERGE_AUDIT_ID;
    if (!auditId) {
      test.fail();
      throw new Error(
        "Set UAT_MERGE_AUDIT_ID env var to a known audit_logs.id with action='merge' on the UAT branch.",
      );
    }
    await page.goto(`/admin/audit-log/${auditId}`);
    await expect(
      page.getByRole("heading", { name: "Audit log entry" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo merge" })).toBeVisible();
  });

  test("@phase-7 undo locked surface renders when snapshot is missing", async ({
    page,
  }) => {
    // Operator-seeded scenario — a merge entry whose snapshot has been
    // undone or aged out, so the detail page renders "Undo no longer
    // available" copy.
    test.skip(
      process.env.PLAYWRIGHT_DESTRUCTIVE !== "1",
      "Requires UAT branch with a seeded already-undone merge entry.",
    );
    const auditId = process.env.UAT_UNDONE_MERGE_AUDIT_ID;
    if (!auditId) {
      test.fail();
      throw new Error(
        "Set UAT_UNDONE_MERGE_AUDIT_ID to an audit_logs.id whose linked snapshot has been deleted.",
      );
    }
    await page.goto(`/admin/audit-log/${auditId}`);
    await expect(page.getByText(/Undo is no longer available/)).toBeVisible();
  });
});
