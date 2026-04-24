import { test, expect, type Page } from "@playwright/test";
import { signInAsAdmin } from "../helpers/auth";

/**
 * Phase 4.7 — property-level performer columns on /analytics/portfolio.
 *
 * Asserts that the Outlet Tiers table on /analytics/portfolio exposes the
 * new property-level columns (Kiosks, Rooms, Hotel Group, {metric}/Kiosk,
 * {metric}/Room), that the High Performer Patterns card no longer surfaces
 * a "Hotel Group Distribution" panel (removed in d50cd31), and that toggling
 * the Sales ↔ Revenue metric-mode control in the filter bar swaps the column
 * header label (e.g. "Total Sales" → "Total Revenue").
 *
 * Data-row assertions gracefully skip when the dev environment has no outlet
 * data for the default filter window — header assertions still run.
 */

// Currency formatter in src/lib/analytics/formatters.ts renders GBP with the
// en-GB locale — either "£1,234" or "£1,234.56". Whitespace between symbol and
// digits is not used by `Intl.NumberFormat("en-GB")`, so the tight pattern is
// safe here.
const CURRENCY_RE = /£[\d,]+(?:\.\d+)?/;

// Portfolio data loads via a server action that fans out to 6 Neon queries;
// on dev with a cold pool this can take 15-20s. The Outlet Tiers card
// renders a skeleton until every query resolves, so any assertion against
// the tier table needs a generous wait window or it flakes on slow loads.
const DATA_LOAD_TIMEOUT_MS = 45_000;

async function getOutletTiersTable(page: Page) {
  // The Outlet Tiers ChartCard renders a heading and the table directly below.
  // Scope to the table that contains the "Outlet Code" header — this is a
  // stable text-in-DOM match regardless of sibling tables on the page.
  // Use `hasText` instead of `has: getByRole` to avoid subtle cross-locator
  // scoping bugs when the table body is still mounting.
  const table = page
    .locator("table")
    .filter({ hasText: "Outlet Code" })
    .first();
  await expect(table).toBeVisible({ timeout: DATA_LOAD_TIMEOUT_MS });
  return table;
}

test.describe("Portfolio — property-level performer columns", () => {
  test("@portfolio Outlet Tiers exposes Kiosks / Rooms / Hotel Group / per-kiosk / per-room columns", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    await expect(
      page.getByRole("heading", { name: "Portfolio", exact: true }),
    ).toBeVisible();

    // Scroll the Outlet Tiers card into view — it's far below the fold.
    const outletTiersHeading = page.getByRole("heading", {
      name: "Outlet Tiers",
      exact: true,
    });
    await outletTiersHeading.scrollIntoViewIfNeeded();
    await expect(outletTiersHeading).toBeVisible();

    const table = await getOutletTiersTable(page);

    // New property-level headers added by commit abf8fc9. These are exact
    // role-based matches against the shadcn <TableHead> cells.
    await expect(
      table.getByRole("columnheader", { name: "Kiosks", exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Rooms", exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: "Hotel Group", exact: true }),
    ).toBeVisible();

    // metric-label prefixed headers (Sales or Revenue — depends on current
    // mode; we only check the suffix).
    await expect(
      table.getByRole("columnheader", { name: /\/\s*Kiosk$/ }),
    ).toBeVisible();
    await expect(
      table.getByRole("columnheader", { name: /\/\s*Room$/ }),
    ).toBeVisible();
  });

  test("@portfolio Outlet Tiers data rows show numeric kiosk count and currency revenue/kiosk", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    const outletTiersHeading = page.getByRole("heading", {
      name: "Outlet Tiers",
      exact: true,
    });
    await outletTiersHeading.scrollIntoViewIfNeeded();
    await expect(outletTiersHeading).toBeVisible();

    // Race the terminal states — either the table rendered (has rows) or the
    // ChartCard swapped to its EmptyState. Whichever wins tells us the load
    // finished.
    const tableLocator = page
      .locator("table")
      .filter({ hasText: "Outlet Code" })
      .first();
    const emptyState = page.getByText(
      "No outlet data for selected filters",
      { exact: true },
    );
    await expect(tableLocator.or(emptyState).first()).toBeVisible({
      timeout: DATA_LOAD_TIMEOUT_MS,
    });

    if (await emptyState.isVisible().catch(() => false)) {
      test.skip(true, "Dev env has no outlet data for default filters");
      return;
    }

    const table = await getOutletTiersTable(page);

    // Resolve the column indices for "Kiosks" and "{metric} / Kiosk" so we
    // can read the corresponding cell in the first data row. Use an
    // aria-label/text match scoped to the table's header row so there's no
    // risk of cross-table ambiguity.
    const headerRow = table.locator("thead tr").first();
    const headerCells = headerRow.locator("th");
    const headerCount = await headerCells.count();
    const headers: string[] = [];
    for (let i = 0; i < headerCount; i++) {
      // Use textContent — innerText() applies CSS transforms (the table
      // headers are styled `text-transform: uppercase`), so mixed-case DOM
      // text becomes all-caps and breaks identity matches.
      headers.push(((await headerCells.nth(i).textContent()) ?? "").trim());
    }
    const kiosksIdx = headers.findIndex((h) => h.toLowerCase() === "kiosks");
    const perKioskIdx = headers.findIndex((h) =>
      /\/\s*kiosk$/i.test(h),
    );
    expect(
      kiosksIdx,
      `Kiosks column should exist in headers: ${JSON.stringify(headers)}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      perKioskIdx,
      `metric/Kiosk column should exist in headers: ${JSON.stringify(headers)}`,
    ).toBeGreaterThanOrEqual(0);

    const firstRow = table.locator("tbody tr").first();
    await expect(firstRow).toBeVisible();

    const kioskCell = firstRow.locator("td").nth(kiosksIdx);
    const kioskText = (await kioskCell.innerText()).trim();
    // Kiosks cell is formatNumber(row.kioskCount) — digits with optional
    // comma grouping. Rows should never render an em-dash for kioskCount
    // because the action always provides a number.
    expect(kioskText, "kiosk count should be numeric").toMatch(/^[\d,]+$/);

    const perKioskCell = firstRow.locator("td").nth(perKioskIdx);
    const perKioskText = (await perKioskCell.innerText()).trim();
    // Allow em-dash for outlets with null revenuePerKiosk; otherwise expect a
    // GBP-formatted value. Both cases are valid product behaviour — we only
    // want to know the column is wired to the row shape.
    expect(
      perKioskText === "—" || CURRENCY_RE.test(perKioskText),
      `per-kiosk cell should be em-dash or currency, got: "${perKioskText}"`,
    ).toBeTruthy();
  });

  test("@portfolio High Performer Patterns no longer surfaces Hotel Group Distribution", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    const patternsHeading = page.getByRole("heading", {
      name: "High Performer Patterns",
      exact: true,
    });
    await patternsHeading.scrollIntoViewIfNeeded();
    await expect(patternsHeading).toBeVisible();

    // Region Distribution is still present; Hotel Group Distribution was
    // removed in d50cd31. Match case-insensitive to future-proof against
    // minor copy tweaks.
    await expect(
      page.getByRole("heading", { name: /hotel group distribution/i }),
    ).toHaveCount(0);
  });

  test("@portfolio Sales ↔ Revenue toggle swaps Outlet Tiers header labels", async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto("/analytics/portfolio");

    const outletTiersHeading = page.getByRole("heading", {
      name: "Outlet Tiers",
      exact: true,
    });
    await outletTiersHeading.scrollIntoViewIfNeeded();

    const table = await getOutletTiersTable(page);

    // The "Total {metric}" header is the stable anchor for mode-label swaps —
    // it lives in the header row and changes text wholesale when the toggle
    // flips. Capture current text, flip the opposite button, and wait for
    // the cell text to change.
    const totalHeader = table
      .locator("thead th")
      .filter({ hasText: /^Total (Sales|Revenue)$/ });
    await expect(totalHeader).toBeVisible();
    const initialLabel = (await totalHeader.innerText()).trim();
    const initialMode = initialLabel === "Total Sales" ? "sales" : "revenue";
    const oppositeLabel = initialMode === "sales" ? "Revenue" : "Sales";
    const oppositeHeaderText =
      initialMode === "sales" ? "Total Revenue" : "Total Sales";

    // The metric-mode toggle is in the sticky filter bar — data-testid
    // `metric-mode-toggle` scopes the button group.
    const toggle = page.getByTestId("metric-mode-toggle");
    await expect(toggle).toBeVisible();
    await toggle.getByRole("button", { name: oppositeLabel }).click();

    // Wait for the header to update — the page refetches on mode change and
    // the label renders off metricMode in the Zustand store, so this is the
    // authoritative "toggle took effect" signal.
    await expect(totalHeader).toHaveText(oppositeHeaderText);
  });
});
