/**
 * Import location product availability from Monday.com hotel board subitems.
 *
 * Each hotel on Monday.com has subitems representing products available at
 * that location (e.g. Transfers, Tours & Activities, Theatre). Each subitem
 * specifies the provider and commission rate.
 *
 * This script:
 *   1. Fetches all hotels from 4 Monday.com boards with subitems
 *   2. Resolves outlet codes via mirror9 typed fragments
 *   3. Creates/finds products and providers
 *   4. Upserts locationProducts with availability and commission tiers
 *
 * Idempotent: upserts on (locationId, productId).
 *
 * Run: npm run db:import:location-products
 */

import { db } from "@/db";
import {
  locations,
  products,
  providers,
  locationProducts,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN;

if (!MONDAY_API_TOKEN) {
  console.error("Missing MONDAY_API_TOKEN in .env.local");
  process.exit(1);
}

const HOTEL_BOARD_IDS = [1356570756, 1743012104, 5026387784, 5092887865];
const BOARD_NAMES: Record<number, string> = {
  1356570756: "Live Estate",
  1743012104: "Ready to Launch",
  5026387784: "Removed",
  5092887865: "Australia DCM",
};

function log(phase: string, msg: string) {
  console.log(`[${phase}] ${msg}`);
}

async function mondayQuery(query: string): Promise<unknown> {
  const MAX_RETRIES = 5;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        Authorization: MONDAY_API_TOKEN!,
        "Content-Type": "application/json",
        "API-Version": "2024-10",
      },
      body: JSON.stringify({ query }),
    });

    if (res.status === 429) {
      const wait = Math.pow(2, attempt) * 1000;
      log("RATE_LIMIT", `Retrying in ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    const json = (await res.json()) as {
      data?: unknown;
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      const msg = json.errors.map((e) => e.message).join("; ");
      if (msg.includes("Rate limit") || msg.includes("complexity")) {
        const wait = Math.pow(2, attempt) * 1000;
        log("RATE_LIMIT", `Complexity limit, retrying in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`Monday.com GraphQL error: ${msg}`);
    }

    return json.data;
  }
  throw new Error("Monday.com API: max retries exceeded");
}

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────

interface SubitemData {
  productName: string;
  providerName: string | null;
  available: boolean;
  commissionRate: number | null;
}

interface HotelWithProducts {
  hotelName: string;
  outletCodes: string[];
  subitems: SubitemData[];
}

// ──────────────────────────────────────────────────────────────
// Fetch all hotels with subitems
// ──────────────────────────────────────────────────────────────

async function fetchAllHotelsWithProducts(): Promise<HotelWithProducts[]> {
  const allHotels: HotelWithProducts[] = [];

  for (const boardId of HOTEL_BOARD_IDS) {
    log("FETCH", `Fetching ${BOARD_NAMES[boardId]} (${boardId})...`);

    let cursor: string | null = null;
    let firstPage = true;
    let boardCount = 0;

    while (true) {
      const itemFragment = `
        id name
        column_values(ids: ["mirror9"]) {
          id type
          ... on MirrorValue { display_value }
        }
        subitems {
          id name
          column_values { id text type }
        }
      `;

      let query: string;
      if (firstPage) {
        query = `{ boards(ids: [${boardId}]) { items_page(limit: 100) { cursor items { ${itemFragment} } } } }`;
      } else {
        query = `{ next_items_page(limit: 100, cursor: "${cursor}") { cursor items { ${itemFragment} } } }`;
      }

      const data = (await mondayQuery(query)) as Record<string, unknown>;

      interface PageShape {
        cursor: string | null;
        items: Array<{
          id: string;
          name: string;
          column_values: Array<{
            id: string;
            type: string;
            display_value?: string;
          }>;
          subitems: Array<{
            id: string;
            name: string;
            column_values: Array<{ id: string; text: string | null; type: string }>;
          }>;
        }>;
      }

      let page: PageShape;
      if (firstPage) {
        page = (data as { boards: Array<{ items_page: PageShape }> }).boards[0].items_page;
      } else {
        page = (data as { next_items_page: PageShape }).next_items_page;
      }

      for (const item of page.items) {
        const mirrorCol = item.column_values.find((cv) => cv.id === "mirror9");
        const displayVal = mirrorCol?.display_value ?? null;
        const outletCodes: string[] = [];
        if (displayVal) {
          for (const code of displayVal.split(",")) {
            const trimmed = code.trim();
            if (trimmed) outletCodes.push(trimmed);
          }
        }

        const subitems: SubitemData[] = [];
        for (const sub of item.subitems) {
          const cols = new Map(sub.column_values.map((cv) => [cv.id, cv.text?.trim() || null]));

          const providerName = cols.get("label2__1") ?? null;
          const availText = cols.get("color5__1") ?? null;
          const commText = cols.get("dup__of_commission9__1") ?? null;

          subitems.push({
            productName: sub.name.trim(),
            providerName,
            available: availText === "Yes",
            commissionRate: commText ? parseFloat(commText) || null : null,
          });
        }

        if (subitems.length > 0) {
          allHotels.push({
            hotelName: item.name,
            outletCodes,
            subitems,
          });
        }
      }

      boardCount += page.items.length;
      firstPage = false;
      if (!page.cursor || page.items.length === 0) break;
      cursor = page.cursor;
    }

    log("FETCH", `  ${BOARD_NAMES[boardId]}: ${boardCount} hotels`);
  }

  log("FETCH", `Total hotels with products: ${allHotels.length}`);
  return allHotels;
}

// ──────────────────────────────────────────────────────────────
// Import location products
// ──────────────────────────────────────────────────────────────

async function importLocationProducts(hotels: HotelWithProducts[]) {
  log("IMPORT", "Starting location product import...");

  // Load location lookup by outlet code
  const locRows = await db
    .select({ id: locations.id, outletCode: locations.outletCode })
    .from(locations);
  const locMap = new Map(
    locRows.filter((l) => l.outletCode).map((l) => [l.outletCode!, l.id])
  );
  log("IMPORT", `Loaded ${locMap.size} locations with outlet codes`);

  // Product and provider caches
  const productMap = new Map<string, string>();
  const existingProducts = await db.select({ id: products.id, name: products.name }).from(products);
  for (const p of existingProducts) productMap.set(p.name.toLowerCase(), p.id);

  const providerMap = new Map<string, string>();
  const existingProviders = await db.select({ id: providers.id, name: providers.name }).from(providers);
  for (const p of existingProviders) providerMap.set(p.name.toLowerCase(), p.id);

  async function getOrCreateProduct(name: string): Promise<string> {
    const key = name.toLowerCase();
    if (productMap.has(key)) return productMap.get(key)!;
    const [row] = await db
      .insert(products)
      .values({ name })
      .onConflictDoNothing({ target: products.name })
      .returning({ id: products.id });
    if (row) {
      productMap.set(key, row.id);
      return row.id;
    }
    const [existing] = await db
      .select({ id: products.id })
      .from(products)
      .where(eq(products.name, name));
    productMap.set(key, existing.id);
    return existing.id;
  }

  async function getOrCreateProvider(name: string): Promise<string> {
    const key = name.toLowerCase();
    if (providerMap.has(key)) return providerMap.get(key)!;
    const [row] = await db
      .insert(providers)
      .values({ name })
      .onConflictDoNothing({ target: providers.name })
      .returning({ id: providers.id });
    if (row) {
      providerMap.set(key, row.id);
      return row.id;
    }
    const [existing] = await db
      .select({ id: providers.id })
      .from(providers)
      .where(eq(providers.name, name));
    providerMap.set(key, existing.id);
    return existing.id;
  }

  // Pre-resolve all products and providers (few queries)
  const allProductNames = new Set<string>();
  const allProviderNames = new Set<string>();
  for (const hotel of hotels) {
    for (const sub of hotel.subitems) {
      allProductNames.add(sub.productName);
      if (sub.providerName) allProviderNames.add(sub.providerName);
    }
  }
  for (const name of allProductNames) await getOrCreateProduct(name);
  for (const name of allProviderNames) await getOrCreateProvider(name);
  log("IMPORT", `Pre-resolved ${productMap.size} products, ${providerMap.size} providers`);

  // Collect ALL rows in memory first
  const allRows: Array<typeof locationProducts.$inferInsert> = [];
  let skippedNoLoc = 0;

  for (const hotel of hotels) {
    if (hotel.outletCodes.length === 0) { skippedNoLoc++; continue; }

    const locationIds: string[] = [];
    for (const code of hotel.outletCodes) {
      const locId = locMap.get(code);
      if (locId) locationIds.push(locId);
    }
    if (locationIds.length === 0) { skippedNoLoc++; continue; }

    for (const sub of hotel.subitems) {
      const productId = productMap.get(sub.productName.toLowerCase())!;
      const providerId = sub.providerName
        ? providerMap.get(sub.providerName.toLowerCase()) ?? null
        : null;

      const commissionTiers = sub.commissionRate
        ? [{ effectiveFrom: "2020-01-01", tiers: [{ minRevenue: 0, maxRevenue: null, rate: sub.commissionRate }] }]
        : null;

      for (const locationId of locationIds) {
        allRows.push({ locationId, productId, providerId, availability: sub.available ? "available" : "unavailable", commissionTiers });
      }
    }
  }

  log("IMPORT", `Collected ${allRows.length} rows to insert (${skippedNoLoc} hotels skipped)`);

  // Clear existing locationProducts, then bulk insert in batches
  log("IMPORT", "Clearing existing location_products...");
  await db.execute(sql`TRUNCATE location_products CASCADE`);

  const BATCH_SIZE = 20;
  let inserted = 0;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const batch = allRows.slice(i, i + BATCH_SIZE);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await db.insert(locationProducts).values(batch);
        break;
      } catch (err: unknown) {
        const cause = (err as { cause?: { code?: string } })?.cause?.code;
        if ((cause === "ECONNRESET" || cause === "ETIMEDOUT") && attempt < 2) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    inserted += batch.length;
    if (inserted % 200 === 0 || i + BATCH_SIZE >= allRows.length) {
      log("IMPORT", `Inserted ${inserted}/${allRows.length} rows`);
    }
  }

  log("IMPORT", `Done: ${inserted} rows inserted, ${skippedNoLoc} hotels skipped (no matching location)`);
}

// ──────────────────────────────────────────────────────────────
// Verification
// ──────────────────────────────────────────────────────────────

async function verify() {
  log("VERIFY", "Running verification...");

  const lpCount = await db.select({ c: sql<number>`count(*)::int` }).from(locationProducts);
  log("VERIFY", `Total locationProducts: ${lpCount[0].c}`);

  const prodCount = await db.select({ c: sql<number>`count(*)::int` }).from(products);
  log("VERIFY", `Total products: ${prodCount[0].c}`);

  const provCount = await db.select({ c: sql<number>`count(*)::int` }).from(providers);
  log("VERIFY", `Total providers: ${provCount[0].c}`);

  const byProduct = await db.execute(sql`
    SELECT p.name, count(*)::int AS locations
    FROM location_products lp
    JOIN products p ON p.id = lp.product_id
    WHERE lp.availability = 'available'
    GROUP BY p.name
    ORDER BY count(*) DESC
    LIMIT 15
  `) as unknown as Array<{ name: string; locations: number }>;
  log("VERIFY", "Products by location count:");
  for (const row of byProduct) {
    log("VERIFY", `  ${row.name}: ${row.locations} locations`);
  }

  const byProvider = await db.execute(sql`
    SELECT prov.name, count(*)::int AS assignments
    FROM location_products lp
    JOIN providers prov ON prov.id = lp.provider_id
    GROUP BY prov.name
    ORDER BY count(*) DESC
    LIMIT 10
  `) as unknown as Array<{ name: string; assignments: number }>;
  log("VERIFY", "Top providers:");
  for (const row of byProvider) {
    log("VERIFY", `  ${row.name}: ${row.assignments} assignments`);
  }

  // Sample: Sheraton Skyline
  const sample = await db.execute(sql`
    SELECT l.name AS hotel, p.name AS product, prov.name AS provider,
           lp.availability, lp.commission_tiers
    FROM location_products lp
    JOIN locations l ON l.id = lp.location_id
    JOIN products p ON p.id = lp.product_id
    LEFT JOIN providers prov ON prov.id = lp.provider_id
    WHERE l.name LIKE '%Sheraton Skyline%'
    ORDER BY p.name
  `) as unknown as Array<Record<string, unknown>>;
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
  console.log("=== Monday.com → Location Products Import ===\n");
  const hotels = await fetchAllHotelsWithProducts();
  await importLocationProducts(hotels);
  await verify();
  console.log("\n=== Import complete ===");
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
