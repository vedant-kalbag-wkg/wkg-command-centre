/**
 * Import location product availability from Monday.com hotel board subitems.
 *
 * Thin CLI wrapper over `src/lib/monday/import-location-products.ts` — the
 * real work (Monday API plumbing + TRUNCATE+rebuild of `location_products`)
 * lives in the shared library so the same logic powers both this script and
 * the admin-gated in-app trigger at `/settings/data-import/monday`.
 *
 * Idempotent: upserts on (locationId, productId); TRUNCATE CASCADE each run.
 *
 * Run: npm run db:import:location-products
 */

import { db } from "@/db";
import { locationProducts, products, providers } from "@/db/schema";
import { sql } from "drizzle-orm";
import { runMondayImport } from "@/lib/monday/import-location-products";

function log(phase: string, msg: string) {
  console.log(`[${phase}] ${msg}`);
}

// ──────────────────────────────────────────────────────────────
// Verification — CLI-only; the lib fn returns a structured result
// for programmatic callers (the admin action). We keep the extra
// query-driven verification here for manual dev runs.
// ──────────────────────────────────────────────────────────────

async function verify() {
  log("VERIFY", "Running verification...");

  const lpCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(locationProducts);
  log("VERIFY", `Total locationProducts: ${lpCount[0].c}`);

  const prodCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(products);
  log("VERIFY", `Total products: ${prodCount[0].c}`);

  const provCount = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(providers);
  log("VERIFY", `Total providers: ${provCount[0].c}`);

  // The static type on `db` is PostgresJsDatabase (which returns an array-like
  // RowList), but at runtime against a Neon connection `db.execute()` actually
  // returns a neon-serverless `{ rows: [...] }` shape. If we iterate the bare
  // result we crash with "X is not iterable" (this was the stale verify bug).
  // Helper that handles both shapes — prefer `.rows` when present, fall back
  // to the value itself for postgres-js-backed runs.
  function rowsOf<T>(result: unknown): T[] {
    if (result && typeof result === "object" && "rows" in result) {
      return (result as { rows: T[] }).rows;
    }
    return result as T[];
  }

  const byProductResult = await db.execute(sql`
    SELECT p.name, count(*)::int AS locations
    FROM location_products lp
    JOIN products p ON p.id = lp.product_id
    WHERE lp.availability = 'available'
    GROUP BY p.name
    ORDER BY count(*) DESC
    LIMIT 15
  `);
  const byProduct = rowsOf<{ name: string; locations: number }>(byProductResult);
  log("VERIFY", "Products by location count:");
  for (const row of byProduct) {
    log("VERIFY", `  ${row.name}: ${row.locations} locations`);
  }

  const byProviderResult = await db.execute(sql`
    SELECT prov.name, count(*)::int AS assignments
    FROM location_products lp
    JOIN providers prov ON prov.id = lp.provider_id
    GROUP BY prov.name
    ORDER BY count(*) DESC
    LIMIT 10
  `);
  const byProvider = rowsOf<{ name: string; assignments: number }>(
    byProviderResult,
  );
  log("VERIFY", "Top providers:");
  for (const row of byProvider) {
    log("VERIFY", `  ${row.name}: ${row.assignments} assignments`);
  }

  // Sample: Sheraton Skyline
  const sampleResult = await db.execute(sql`
    SELECT l.name AS hotel, p.name AS product, prov.name AS provider,
           lp.availability, lp.commission_tiers
    FROM location_products lp
    JOIN locations l ON l.id = lp.location_id
    JOIN products p ON p.id = lp.product_id
    LEFT JOIN providers prov ON prov.id = lp.provider_id
    WHERE l.name LIKE '%Sheraton Skyline%'
    ORDER BY p.name
  `);
  const sample = rowsOf<Record<string, unknown>>(sampleResult);
  if (sample.length > 0) {
    log("VERIFY", "Sheraton Skyline products:");
    for (const row of sample) {
      log("VERIFY", `  ${row.product} → ${row.provider} (${row.availability})`);
    }
  }

  log("VERIFY", "DONE");
}

// ──────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────

async function main() {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) {
    console.error("Missing MONDAY_API_TOKEN in .env.local");
    process.exit(1);
  }

  console.log("=== Monday.com → Location Products Import ===\n");

  const result = await runMondayImport({
    mondayApiToken: token,
    db,
    logger: (phase, msg) => console.log(`[${phase}] ${msg}`),
  });

  await verify();

  console.log("\n=== Import complete ===");
  console.log(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(
    `Inserted: ${result.rowsInserted}, Placeholders: ${result.placeholdersCreated}, Skipped: ${result.hotelsSkipped}`,
  );
  if (result.placeholdersCreated > 0) {
    console.log(`Placeholders created: ${result.placeholderNames.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
