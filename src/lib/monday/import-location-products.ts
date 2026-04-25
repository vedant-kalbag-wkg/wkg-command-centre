/**
 * Monday.com → location_products import (library function).
 *
 * Same behaviour as the original CLI script in
 * `scripts/import-location-products-from-monday.ts`, extracted into a pure
 * function so it can be called from both the CLI and from an admin-gated
 * server action at `/settings/data-import/monday`.
 *
 * Responsibilities:
 *   1. Fetch all hotels (+ subitems) from 4 Monday boards via GraphQL
 *   2. Resolve mirror9 outlet codes → existing `locations` rows
 *   3. For case-1 hotels on Live Estate / Australia DCM (no outlet code),
 *      create a placeholder location so commission tiers still import
 *   4. TRUNCATE `location_products` then bulk-insert the rebuilt rows
 *
 * Deps are injected so the function is pure (no direct `process.env` reads,
 * no `process.exit`). Callers handle env lookup, logging sink, and error
 * recovery themselves.
 */

import {
  auditLogs,
  locations,
  products,
  providers,
  locationProducts,
  regions,
} from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import type { db as defaultDb } from "@/db";

const HOTEL_BOARD_IDS = [1356570756, 1743012104, 5026387784, 5092887865];
const BOARD_NAMES: Record<number, string> = {
  1356570756: "Live Estate",
  1743012104: "Ready to Launch",
  5026387784: "Removed",
  5092887865: "Australia DCM",
};

// Default region for placeholder locations, keyed by board. Monday hotels
// without a mirror9 outlet code get a placeholder `locations` row so their
// commission tiers import; since we don't know the real region, we seed by
// board geography. Operators can reassign per-hotel via the region picker
// in /settings/outlet-types. Ready-to-Launch / Removed boards don't produce
// placeholders (see PLACEHOLDER_IMPORT_BOARDS).
const BOARD_REGION: Record<number, string> = {
  1356570756: "UK", // Live Estate — default; operator reassigns per-hotel if wrong
  1743012104: "UK", // Ready to Launch — not imported (see PLACEHOLDER_IMPORT_BOARDS)
  5026387784: "UK", // Removed — not imported
  5092887865: "AU", // Australia DCM — defaults to AU (added in migration 0025)
};

// Boards whose no-outlet-code hotels get promoted from silent-skip to
// placeholder-import. Removed + Ready-to-Launch deliberately omitted — those
// hotels aren't live yet and shouldn't land in analytics surfaces.
const PLACEHOLDER_IMPORT_BOARDS = new Set<number>([
  1356570756, // Live Estate
  5092887865, // Australia DCM
]);

export type MondayImportResult = {
  rowsInserted: number;
  placeholdersCreated: number;
  placeholderNames: string[];
  hotelsSkipped: number;
  productsResolved: number;
  providersResolved: number;
  durationMs: number;
};

export type MondayImportDeps = {
  mondayApiToken: string;
  db: typeof defaultDb;
  logger?: (phase: string, msg: string) => void;
};

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
  // Board + item provenance — required for the flag-not-skip path so we know
  // which board a no-outlet-code hotel came from (→ placeholder or skip) and
  // can stamp `MONDAY-<mondayItemId>` onto the placeholder outletCode.
  mondayItemId: string;
  boardId: number;
}

const noopLogger = () => {};

export async function runMondayImport(
  deps: MondayImportDeps,
): Promise<MondayImportResult> {
  const { mondayApiToken, db, logger = noopLogger } = deps;
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  // ────────────────────────────────────────────────────────────
  // Monday API client (closure captures the token)
  // ────────────────────────────────────────────────────────────
  async function mondayQuery(query: string): Promise<unknown> {
    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          Authorization: mondayApiToken,
          "Content-Type": "application/json",
          "API-Version": "2024-10",
        },
        body: JSON.stringify({ query }),
      });

      if (res.status === 429) {
        const wait = Math.pow(2, attempt) * 1000;
        logger("RATE_LIMIT", `Retrying in ${wait}ms...`);
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
          logger("RATE_LIMIT", `Complexity limit, retrying in ${wait}ms...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw new Error(`Monday.com GraphQL error: ${msg}`);
      }

      return json.data;
    }
    throw new Error("Monday.com API: max retries exceeded");
  }

  // ────────────────────────────────────────────────────────────
  // Fetch all hotels with subitems
  // ────────────────────────────────────────────────────────────
  async function fetchAllHotelsWithProducts(): Promise<HotelWithProducts[]> {
    const allHotels: HotelWithProducts[] = [];

    for (const boardId of HOTEL_BOARD_IDS) {
      logger("FETCH", `Fetching ${BOARD_NAMES[boardId]} (${boardId})...`);

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
              column_values: Array<{
                id: string;
                text: string | null;
                type: string;
              }>;
            }>;
          }>;
        }

        let page: PageShape;
        if (firstPage) {
          page = (data as { boards: Array<{ items_page: PageShape }> }).boards[0]
            .items_page;
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
            const cols = new Map(
              sub.column_values.map((cv) => [cv.id, cv.text?.trim() || null]),
            );

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
              mondayItemId: item.id,
              boardId,
            });
          }
        }

        boardCount += page.items.length;
        firstPage = false;
        if (!page.cursor || page.items.length === 0) break;
        cursor = page.cursor;
      }

      logger("FETCH", `  ${BOARD_NAMES[boardId]}: ${boardCount} hotels`);
    }

    logger("FETCH", `Total hotels with products: ${allHotels.length}`);
    return allHotels;
  }

  // ────────────────────────────────────────────────────────────
  // Import location products
  // ────────────────────────────────────────────────────────────
  const hotels = await fetchAllHotelsWithProducts();

  logger("IMPORT", "Starting location product import...");

  // Load location lookup by outlet code
  const locRows = await db
    .select({ id: locations.id, outletCode: locations.outletCode })
    .from(locations);
  const locMap = new Map(
    locRows.filter((l) => l.outletCode).map((l) => [l.outletCode!, l.id]),
  );
  logger("IMPORT", `Loaded ${locMap.size} locations with outlet codes`);

  // Region code → id lookup for placeholder creation. We fetch once up front
  // so the main loop stays pure (no DB reads in the hot path).
  const regionRows = await db
    .select({ id: regions.id, code: regions.code })
    .from(regions);
  const regionByCode = new Map(regionRows.map((r) => [r.code, r.id]));
  logger(
    "IMPORT",
    `Loaded ${regionByCode.size} regions (${regionRows.map((r) => r.code).join(", ")})`,
  );

  // Track hotel names we had to placeholder so the summary line can list them.
  const placeholderHotelNames: string[] = [];

  /**
   * Create (or find, if it already exists from a prior run) a placeholder
   * location for a Monday hotel with no mirror9 outlet code. The outletCode
   * is `MONDAY-<mondayItemId>` — the MONDAY- prefix is also the signal the
   * /settings/outlet-types admin UI uses to badge the row as
   * "Imported from Monday" (see pipeline.ts::reviewReason).
   */
  async function createPlaceholderLocation(
    hotel: HotelWithProducts,
  ): Promise<string> {
    const outletCode = `MONDAY-${hotel.mondayItemId}`;
    const regionCode = BOARD_REGION[hotel.boardId];
    const primaryRegionId = regionByCode.get(regionCode);
    if (!primaryRegionId) {
      throw new Error(
        `No region row for code '${regionCode}' (board=${BOARD_NAMES[hotel.boardId]}). ` +
          `Seed regions before running placeholder import.`,
      );
    }

    const notes =
      `Imported from Monday (mondayItemId=${hotel.mondayItemId}) on ` +
      `${new Date().toISOString().slice(0, 10)} — no outlet code on mirror9, ` +
      `needs manual review (verify region + set type). Board=${BOARD_NAMES[hotel.boardId]}.`;

    // onConflictDoNothing on (primaryRegionId, outletCode) — the existing
    // unique constraint. Returning can be empty if the row already exists
    // from a prior run, in which case we SELECT to get the id.
    const [inserted] = await db
      .insert(locations)
      .values({
        name: hotel.hotelName,
        outletCode,
        primaryRegionId,
        locationType: null,
        notes,
      })
      .onConflictDoNothing({
        target: [locations.primaryRegionId, locations.outletCode],
      })
      .returning({ id: locations.id });

    if (inserted) {
      placeholderHotelNames.push(hotel.hotelName);
      await db.insert(auditLogs).values({
        actorId: "script:import-location-products-from-monday",
        actorName: "System (Monday import)",
        entityType: "location",
        entityId: inserted.id,
        entityName: hotel.hotelName,
        action: "imported_from_monday_placeholder",
        metadata: {
          mondayItemId: hotel.mondayItemId,
          board: BOARD_NAMES[hotel.boardId],
        },
      });
      return inserted.id;
    }

    // Already exists — look it up.
    const [existing] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(
        and(
          eq(locations.primaryRegionId, primaryRegionId),
          eq(locations.outletCode, outletCode),
        ),
      );
    return existing.id;
  }

  // Product and provider caches
  const productMap = new Map<string, string>();
  const existingProducts = await db
    .select({ id: products.id, name: products.name })
    .from(products);
  for (const p of existingProducts) productMap.set(p.name.toLowerCase(), p.id);

  const providerMap = new Map<string, string>();
  const existingProviders = await db
    .select({ id: providers.id, name: providers.name })
    .from(providers);
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
  logger(
    "IMPORT",
    `Pre-resolved ${productMap.size} products, ${providerMap.size} providers`,
  );

  // Collect ALL rows in memory first
  const allRows: Array<typeof locationProducts.$inferInsert> = [];
  let skippedNoLoc = 0;
  let placeholdersCreated = 0;

  for (const hotel of hotels) {
    const locationIds: string[] = [];

    if (hotel.outletCodes.length === 0) {
      // Case 1: hotel has no mirror9 outlet code. On active boards
      // (Live Estate / Australia DCM) create a placeholder so commission
      // tiers still import; elsewhere keep the old skip behaviour.
      if (PLACEHOLDER_IMPORT_BOARDS.has(hotel.boardId)) {
        const locId = await createPlaceholderLocation(hotel);
        locationIds.push(locId);
        placeholdersCreated++;
      } else {
        skippedNoLoc++;
        continue;
      }
    } else {
      // Case 2: hotel has outlet codes on mirror9 — resolve each to an
      // existing location. If NONE resolve, skip (unchanged behaviour).
      for (const code of hotel.outletCodes) {
        const locId = locMap.get(code);
        if (locId) locationIds.push(locId);
      }
      if (locationIds.length === 0) {
        skippedNoLoc++;
        continue;
      }
    }

    for (const sub of hotel.subitems) {
      const productId = productMap.get(sub.productName.toLowerCase())!;
      const providerId = sub.providerName
        ? (providerMap.get(sub.providerName.toLowerCase()) ?? null)
        : null;

      const commissionTiers = sub.commissionRate
        ? [
            {
              effectiveFrom: "2020-01-01",
              tiers: [
                {
                  minRevenue: 0,
                  maxRevenue: null,
                  rate: sub.commissionRate,
                },
              ],
            },
          ]
        : null;

      for (const locationId of locationIds) {
        allRows.push({
          locationId,
          productId,
          providerId,
          availability: sub.available ? "available" : "unavailable",
          commissionTiers,
        });
      }
    }
  }

  logger(
    "IMPORT",
    `Collected ${allRows.length} rows to insert ` +
      `(${placeholdersCreated} placeholder locations created, ${skippedNoLoc} hotels skipped)`,
  );

  // Clear existing locationProducts, then bulk insert in batches
  logger("IMPORT", "Clearing existing location_products...");
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
        if (
          (cause === "ECONNRESET" || cause === "ETIMEDOUT") &&
          attempt < 2
        ) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    inserted += batch.length;
    if (inserted % 200 === 0 || i + BATCH_SIZE >= allRows.length) {
      logger("IMPORT", `Inserted ${inserted}/${allRows.length} rows`);
    }
  }

  logger(
    "IMPORT",
    `Done: ${inserted} rows inserted, ${skippedNoLoc} hotels skipped (no matching location), ` +
      `${placeholdersCreated} placeholder locations created`,
  );
  if (placeholderHotelNames.length > 0) {
    logger(
      "IMPORT",
      `Created ${placeholderHotelNames.length} placeholder locations for hotels missing outlet codes: ${placeholderHotelNames.join(", ")}`,
    );
  }

  const endedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  return {
    rowsInserted: inserted,
    placeholdersCreated,
    placeholderNames: placeholderHotelNames,
    hotelsSkipped: skippedNoLoc,
    productsResolved: productMap.size,
    providersResolved: providerMap.size,
    durationMs: endedAt - startedAt,
  };
}
