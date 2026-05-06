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
import { eq, and, isNull, sql } from "drizzle-orm";
import type { db as defaultDb } from "@/db";
import { mondayQueryWithRetry } from "@/lib/monday/client";
import { normaliseName } from "@/lib/normalise";

const HOTEL_BOARD_IDS = [1356570756, 1743012104, 5026387784, 5092887865];
const BOARD_NAMES: Record<number, string> = {
  1356570756: "Live Estate",
  1743012104: "Ready to Launch",
  5026387784: "Removed",
  5092887865: "Australia DCM",
};

// Region for placeholder locations, keyed by board. Only set for boards
// whose geography is unambiguous (e.g. Australia DCM is AU-only). For mixed
// boards like Live Estate we deliberately do NOT default — historically we
// fell back to "UK" here, which silently mis-attributed non-UK hotels into
// the UK region (audit D5 Parts A+B cleaned up the resulting mess). When no
// entry exists for a board, placeholder creation is skipped and logged.
const BOARD_REGION: Record<number, string> = {
  5092887865: "AU", // Australia DCM — AU-only board (added in migration 0025)
};

// Boards whose no-outlet-code hotels get promoted from silent-skip to
// placeholder-import. Removed + Ready-to-Launch deliberately omitted — those
// hotels aren't live yet and shouldn't land in analytics surfaces.
const PLACEHOLDER_IMPORT_BOARDS = new Set<number>([
  1356570756, // Live Estate
  5092887865, // Australia DCM
]);

/**
 * Phase 7 Plan 07-04 (DATA-03 D-09) — same-name candidate detection.
 *
 * One entry per Monday hotel item whose `normaliseName(item.name)` matches
 * an existing active locations row that does NOT belong to the same Monday
 * import. Surfaced both in the dry-run return value AND as a single
 * `dry_import_warning` audit-log entry summarising the batch.
 */
export type SameNameWarning = {
  normalisedName: string;
  mondayItemId: string;
  itemName: string;
  collidingLocationIds: string[];
};

export type MondayImportResult = {
  rowsInserted: number;
  placeholdersCreated: number;
  placeholderNames: string[];
  hotelsSkipped: number;
  /**
   * Subset of `hotelsSkipped` — placeholder-eligible hotels that we refused
   * to create because the board has no unambiguous regional default. Tracked
   * separately so operators can spot when Monday boards drift (e.g. a new
   * non-AU board is added) and the data team needs to decide on a region
   * mapping rather than silently UK-defaulting (audit D5 Part D).
   */
  placeholdersSkippedNoRegion: number;
  productsResolved: number;
  providersResolved: number;
  durationMs: number;
  /**
   * Phase 7 Plan 07-04 — same-name candidates detected for this run. In
   * dry-run mode the array is computed before any DB writes (other than the
   * single `dry_import_warning` audit entry); in normal-import mode it is
   * always `[]` (the import does not currently insert hotels — that's the
   * job of import-hotel-locations.ts — so there's nothing for this pass to
   * warn against).
   */
  sameNameWarnings: SameNameWarning[];
};

export type MondayImportDeps = {
  mondayApiToken: string;
  db: typeof defaultDb;
  logger?: (phase: string, msg: string) => void;
  /**
   * Phase 7 Plan 07-04 — when `true`, run all read-only steps (Monday fetch,
   * resolve outlet codes, compute same-name warnings) but skip writes that
   * mutate `location_products`, `products`, `providers`, `locations`. The
   * single `dry_import_warning` audit-log entry is the only intentional
   * write in dry-run mode, and it is conditional on `persistWarnings`
   * (defaults to `true` so the dry-run leaves a forensic trail).
   */
  dryRun?: boolean;
  /**
   * Phase 7 Plan 07-04 — when `false` and `dryRun=true`, suppress the
   * `dry_import_warning` audit-log entry. Useful in tests that assert the
   * caller's return-value contract without depending on audit_logs state.
   * Default: `true`.
   */
  persistWarnings?: boolean;
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
  const {
    mondayApiToken,
    db,
    logger = noopLogger,
    dryRun = false,
    persistWarnings = true,
  } = deps;
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  // ────────────────────────────────────────────────────────────
  // Monday API client — extracted to @/lib/monday/client (Phase 6 plan
  // 06-02). The client reads MONDAY_API_TOKEN from process.env, so we
  // bridge the dep-injected token into the env for the duration of the
  // import (restoring the prior value on completion to avoid leaking
  // ambient state into other calls).
  // ────────────────────────────────────────────────────────────
  const previousToken = process.env.MONDAY_API_TOKEN;
  process.env.MONDAY_API_TOKEN = mondayApiToken;
  async function mondayQuery(query: string): Promise<unknown> {
    try {
      // Wrap the extracted retry helper so the rate-limit path emits the
      // existing "RATE_LIMIT" log line. The helper itself doesn't take a
      // logger; we accept the loss of fine-grained per-attempt logs in
      // exchange for a single shared retry implementation.
      logger("MONDAY", "Issuing GraphQL query (with retry)");
      return await mondayQueryWithRetry<unknown>(query, {});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Preserve the legacy error shape for any caller that pattern-matches
      // on it. Rate-limit and other retryable errors come through as
      // "Monday API errors: ..." from the new client; remap to the legacy
      // "Monday.com GraphQL error" prefix used by this script.
      if (message.startsWith("Monday API errors: ")) {
        throw new Error(
          `Monday.com GraphQL error: ${message.slice("Monday API errors: ".length)}`,
        );
      }
      throw err;
    }
  }
  try {

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

  logger(
    "IMPORT",
    dryRun
      ? "Dry-run: computing same-name warnings only (no writes)..."
      : "Starting location product import...",
  );

  // ────────────────────────────────────────────────────────────
  // Phase 7 Plan 07-04 (DATA-03 D-09) — same-name candidate detection.
  //
  // Build a map from `normalised_name` to the list of active `locations.id`
  // rows that have it. Then, for every hotel we're about to import, compute
  // `normaliseName(hotel.hotelName)` and emit a warning if the normalised
  // name already belongs to active locations rows.
  //
  // We deliberately do this BEFORE any DB writes so the dry-run path is
  // side-effect-free (other than the single `dry_import_warning` audit log
  // entry, which is intentional). In normal-import mode we still compute the
  // warnings (cheap) but never emit the audit entry; the warnings are
  // returned in the result for the caller to surface.
  // ────────────────────────────────────────────────────────────
  const sameNameWarnings: SameNameWarning[] = [];
  const activeLocationsRows = await db
    .select({
      id: locations.id,
      normalisedName: locations.normalisedName,
    })
    .from(locations)
    .where(isNull(locations.archivedAt));
  const normalisedNameToActiveIds = new Map<string, string[]>();
  for (const row of activeLocationsRows) {
    if (!row.normalisedName) continue;
    const list = normalisedNameToActiveIds.get(row.normalisedName) ?? [];
    list.push(row.id);
    normalisedNameToActiveIds.set(row.normalisedName, list);
  }
  for (const hotel of hotels) {
    const norm = normaliseName(hotel.hotelName);
    if (!norm) continue;
    const colliding = normalisedNameToActiveIds.get(norm);
    if (!colliding || colliding.length === 0) continue;
    sameNameWarnings.push({
      normalisedName: norm,
      mondayItemId: hotel.mondayItemId,
      itemName: hotel.hotelName,
      collidingLocationIds: colliding,
    });
  }
  if (sameNameWarnings.length > 0) {
    logger(
      "IMPORT",
      `Same-name warnings: ${sameNameWarnings.length} Monday item(s) collide with existing active locations`,
    );
    if (dryRun && persistWarnings) {
      // Single audit-log entry summarising the batch — keeps the log
      // forensically useful without flooding it with one row per warning.
      await db.insert(auditLogs).values({
        actorId: "system:runMondayImport",
        actorName: "System (Monday import dry-run)",
        entityType: "system",
        entityId: "monday-import",
        entityName: "Monday hotel import (dry-run)",
        action: "dry_import_warning",
        metadata: {
          warnings: sameNameWarnings.length,
          sample: sameNameWarnings.slice(0, 5),
        },
      });
    }
  }

  // Dry-run short-circuit — bail out before any further DB writes. We still
  // return the same-shape result so callers can pattern-match on counts.
  if (dryRun) {
    const endedAt =
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    return {
      rowsInserted: 0,
      placeholdersCreated: 0,
      placeholderNames: [],
      hotelsSkipped: 0,
      placeholdersSkippedNoRegion: 0,
      productsResolved: 0,
      providersResolved: 0,
      durationMs: endedAt - startedAt,
      sameNameWarnings,
    };
  }

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
   * location for a Monday hotel with no mirror9 outlet code. Returns null
   * when the hotel's board has no unambiguous regional default (so the
   * caller can skip + log instead of silently mis-attributing). The
   * outletCode is `MONDAY-<mondayItemId>` — the MONDAY- prefix is also
   * the signal the /settings/outlet-types admin UI uses to badge the row
   * as "Imported from Monday" (see pipeline.ts::reviewReason).
   */
  async function createPlaceholderLocation(
    hotel: HotelWithProducts,
  ): Promise<string | null> {
    const outletCode = `MONDAY-${hotel.mondayItemId}`;
    const regionCode = BOARD_REGION[hotel.boardId];
    if (!regionCode) return null;
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
  let placeholdersSkippedNoRegion = 0;

  for (const hotel of hotels) {
    const locationIds: string[] = [];

    if (hotel.outletCodes.length === 0) {
      // Case 1: hotel has no mirror9 outlet code. On active boards
      // (Live Estate / Australia DCM) attempt to create a placeholder so
      // commission tiers still import; elsewhere keep the old skip
      // behaviour. Placeholder creation returns null when the board has
      // no unambiguous regional default — we refuse to guess (formerly
      // silently UK-defaulted; see audit D5 Part D) and skip+log instead.
      if (PLACEHOLDER_IMPORT_BOARDS.has(hotel.boardId)) {
        const locId = await createPlaceholderLocation(hotel);
        if (locId) {
          locationIds.push(locId);
          placeholdersCreated++;
        } else {
          logger(
            "MONDAY",
            `Skipping placeholder for hotel "${hotel.hotelName}" ` +
              `(mondayItemId=${hotel.mondayItemId}, board=${BOARD_NAMES[hotel.boardId]}): ` +
              `no regional default for this board — operator must add an outlet code on Monday ` +
              `or extend BOARD_REGION.`,
          );
          placeholdersSkippedNoRegion++;
          skippedNoLoc++;
          continue;
        }
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
      `(${placeholdersCreated} placeholder locations created, ${skippedNoLoc} hotels skipped` +
      (placeholdersSkippedNoRegion > 0
        ? `, of which ${placeholdersSkippedNoRegion} skipped for missing regional default`
        : "") +
      `)`,
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
      placeholdersSkippedNoRegion,
      productsResolved: productMap.size,
      providersResolved: providerMap.size,
      durationMs: endedAt - startedAt,
      // Phase 7 Plan 07-04 — populated above before any DB writes; carried
      // through to the normal-import return so callers don't need to branch
      // on dryRun to read the field.
      sameNameWarnings,
    };
  } finally {
    // Restore the prior MONDAY_API_TOKEN value. `delete` on `previousToken
    // === undefined` so `'MONDAY_API_TOKEN' in process.env` returns false
    // again (matches the pre-call state for callers that rely on env-var
    // presence checks).
    if (previousToken === undefined) {
      delete process.env.MONDAY_API_TOKEN;
    } else {
      process.env.MONDAY_API_TOKEN = previousToken;
    }
  }
}
