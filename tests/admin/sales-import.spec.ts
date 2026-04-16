import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import path from "node:path";
import { test, expect } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  importStagings,
  locations,
  products,
  providers,
  salesImports,
  salesRecords,
} from "@/db/schema";
import { signInAsAdmin } from "../auth/setup";

/**
 * UAT for M4 Task 4.4 — sales CSV import admin UI.
 *
 * Seeds the dimensions referenced by tests/fixtures/sales-import/*.csv
 * (two locations, one product, one provider) and cleans up any prior
 * sales_imports rows with matching filenames so the source-hash dedupe
 * doesn't fire across repeated runs.
 */

const OUTLETS = ["OUT-UAT-A", "OUT-UAT-B"] as const;
const PRODUCT_NAME = "UAT Tour";
const PROVIDER_NAME = "UAT Provider";
const FIXTURE_FILES = ["happy-3-rows.csv", "one-invalid.csv"] as const;

async function resetFixtureState() {
  // Remove prior imports that might have been left over — cascades into
  // import_stagings; salesRecords.importId is set null on import deletion so
  // we also explicitly drop sales rows tied to the two fixture saleRefs.
  const priorImports = await db
    .select({ id: salesImports.id })
    .from(salesImports)
    .where(inArray(salesImports.filename, [...FIXTURE_FILES]));
  if (priorImports.length > 0) {
    const ids = priorImports.map((r) => r.id);
    await db.delete(salesRecords).where(inArray(salesRecords.importId, ids));
    await db.delete(importStagings).where(inArray(importStagings.importId, ids));
    await db.delete(auditLogs).where(inArray(auditLogs.entityId, ids));
    await db.delete(salesImports).where(inArray(salesImports.id, ids));
  }

  for (const code of OUTLETS) {
    const existing = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.outletCode, code))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(locations).values({ name: `UAT ${code}`, outletCode: code });
    }
  }

  const prod = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.name, PRODUCT_NAME))
    .limit(1);
  if (prod.length === 0) await db.insert(products).values({ name: PRODUCT_NAME });

  const prov = await db
    .select({ id: providers.id })
    .from(providers)
    .where(eq(providers.name, PROVIDER_NAME))
    .limit(1);
  if (prov.length === 0) await db.insert(providers).values({ name: PROVIDER_NAME });
}

function fixturePath(name: string) {
  return path.join(process.cwd(), "tests", "fixtures", "sales-import", name);
}

test.describe("Sales CSV import (admin UI)", () => {
  test.beforeAll(async () => {
    await resetFixtureState();
  });

  test.beforeEach(async ({ page }) => {
    await signInAsAdmin(page);
  });

  test("happy path: upload → preview → commit", async ({ page }) => {
    await resetFixtureState();
    await page.goto("/settings/data-import/sales");

    await page
      .getByLabel("CSV file")
      .setInputFiles(fixturePath("happy-3-rows.csv"));

    await expect(page.getByText("Preview", { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /Commit 3 rows/i })).toBeEnabled();

    // Stat values.
    await expect(page.getByText("Total rows").locator("..").getByText("3")).toBeVisible();

    await page.getByRole("button", { name: /Commit 3 rows/i }).click();
    await expect(page.getByText(/Committed 3 sales rows/i)).toBeVisible({ timeout: 10_000 });

    // Preview card disappears.
    await expect(page.getByText("Preview", { exact: false })).not.toBeVisible();

    // Second upload of the same file is rejected.
    await page
      .getByLabel("CSV file")
      .setInputFiles(fixturePath("happy-3-rows.csv"));
    await expect(page.getByText(/already been uploaded/i)).toBeVisible({ timeout: 10_000 });
  });

  test("invalid rows block commit; cancel resets", async ({ page }) => {
    // Clean sales_imports so the one-invalid fixture can be staged cleanly.
    const priorImports = await db
      .select({ id: salesImports.id })
      .from(salesImports)
      .where(eq(salesImports.filename, "one-invalid.csv"));
    if (priorImports.length > 0) {
      const ids = priorImports.map((r) => r.id);
      await db.delete(importStagings).where(inArray(importStagings.importId, ids));
      await db.delete(salesImports).where(inArray(salesImports.id, ids));
    }

    await page.goto("/settings/data-import/sales");
    await page
      .getByLabel("CSV file")
      .setInputFiles(fixturePath("one-invalid.csv"));

    await expect(page.getByText("Preview", { exact: false })).toBeVisible({ timeout: 10_000 });

    // Invalid count > 0 → Commit button disabled.
    await expect(page.getByRole("button", { name: /Commit/ })).toBeDisabled();

    await page.getByRole("button", { name: /Cancel/ }).click();
    await expect(page.getByText(/Import cancelled/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Preview", { exact: false })).not.toBeVisible();
  });
});
