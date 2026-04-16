"use server";

import { z } from "zod/v4";
import { requireRole } from "@/lib/rbac";
import {
  fetchBoardColumns,
  fetchAllItems,
  type BoardColumn,
  type MondayItem,
} from "@/lib/monday-client";
import {
  autoDetectMappings,
  mapMondayItemToKiosk,
  mapMondayItemToLocation,
  mapSubitemsToLocationProducts,
  extractLocationName,
  normaliseLocationName,
  detectMergeConflicts,
  detectMultiOutletRows,
  expandSplitItems,
  type FieldMapping,
  type ImportPreview,
  type ImportProgress,
  type SplitDecision,
} from "@/lib/field-mapper";
import { db } from "@/db";
import {
  kiosks,
  locations,
  kioskAssignments,
  pipelineStages,
  products,
  providers,
  locationProducts,
  installationKiosks,
} from "@/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

// =============================================================================
// Module-level session state (per RESEARCH.md Pattern 5)
// Acceptable for a one-time admin tool on a single Next.js server instance.
// =============================================================================

// Use globalThis to survive module re-evaluation in dev mode (Turbopack/HMR)
const globalForImport = globalThis as unknown as {
  importSessions?: Map<string, ImportProgress>;
  fetchedItemsCache?: Map<string, MondayItem[]>;
};
const importSessions = globalForImport.importSessions ??= new Map<string, ImportProgress>();
const fetchedItemsCache = globalForImport.fetchedItemsCache ??= new Map<string, MondayItem[]>();

// =============================================================================
// Zod validation
// =============================================================================

const boardIdSchema = z.string().min(1, "Board ID is required");

// =============================================================================
// Server action: exploreBoardColumns (MIGR-01)
// =============================================================================

/**
 * Fetches board column metadata from Monday.com and auto-detects field mappings.
 * Admin-only. Returns columns and suggested mappings for admin review.
 */
export async function exploreBoardColumns(boardId: string): Promise<
  | { success: true; columns: BoardColumn[]; mappings: FieldMapping[] }
  | { error: string }
> {
  try {
    await requireRole("admin");

    const validatedBoardId = boardIdSchema.parse(boardId);

    const columns = await fetchBoardColumns(validatedBoardId);
    const mappings = autoDetectMappings(columns);

    return { success: true, columns, mappings };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to explore board" };
  }
}

// =============================================================================
// Server action: detectSplits
// =============================================================================

/**
 * Fetches all board items and detects rows with comma-separated outlet codes.
 * Caches fetched items to avoid re-fetching during dry-run/import.
 */
export async function detectSplits(
  boardId: string,
  mappings: FieldMapping[]
): Promise<
  | { success: true; splits: SplitDecision[]; fetchId: string }
  | { error: string }
> {
  try {
    await requireRole("admin");
    boardIdSchema.parse(boardId);

    const allItems: MondayItem[] = [];
    for await (const page of fetchAllItems(boardId)) {
      allItems.push(...page);
    }

    const fetchId = crypto.randomUUID();
    fetchedItemsCache.set(fetchId, allItems);

    const splits = detectMultiOutletRows(allItems, mappings);

    return { success: true, splits, fetchId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to detect splits" };
  }
}

// =============================================================================
// Server action: runDryImport (MIGR-02)
// =============================================================================

/**
 * Fetches all board items and previews the import — no DB writes.
 * Returns ImportPreview with summary counts and first 20 sample records.
 */
export async function runDryImport(
  boardId: string,
  mappings: FieldMapping[],
  splitDecisions?: SplitDecision[],
  fetchId?: string
): Promise<{ success: true; preview: ImportPreview } | { error: string }> {
  try {
    await requireRole("admin");
    boardIdSchema.parse(boardId);

    // Fetch existing data for duplicate detection and stage lookup
    const [existingKiosks, existingStageRows] = await Promise.all([
      db.select({ kioskId: kiosks.kioskId }).from(kiosks),
      db.select({ id: pipelineStages.id, name: pipelineStages.name }).from(pipelineStages),
    ]);

    const existingKioskIds = new Set(existingKiosks.map((k) => k.kioskId));
    const existingStagesMap = new Map(existingStageRows.map((s) => [s.name, s.id]));

    // Use cached items if available, otherwise fetch fresh
    let rawItems: MondayItem[];
    if (fetchId && fetchedItemsCache.has(fetchId)) {
      rawItems = fetchedItemsCache.get(fetchId)!;
    } else {
      rawItems = [];
      for await (const page of fetchAllItems(boardId)) {
        rawItems.push(...page);
      }
    }

    // Expand split decisions into separate items
    const allItems = splitDecisions?.length
      ? expandSplitItems(rawItems, splitDecisions, mappings)
      : rawItems;

    let mappedCount = 0;
    let warningCount = 0;
    let duplicateCount = 0;
    const newStageNamesSet = new Set<string>();
    const allProductNames = new Set<string>();
    const allProviderNames = new Set<string>();
    const sampleRecords: ImportPreview["sampleRecords"] = [];

    // Build location groups keyed by normalised name for merge conflict detection (D-10)
    const locationGroups = new Map<string, Array<Record<string, unknown>>>();

    for (const item of allItems) {
      const warnings: string[] = [];

      // Map kiosk fields
      const { kioskData, unmappedValues, newStageName } = mapMondayItemToKiosk(
        item,
        mappings,
        existingStagesMap
      );

      // Check for duplicate kiosk (using derived kioskId, not item.name)
      if (kioskData.kioskId && existingKioskIds.has(kioskData.kioskId)) {
        duplicateCount++;
        warnings.push(`Duplicate kiosk ID: ${kioskData.kioskId} — will be skipped`);
      }

      if (newStageName) {
        newStageNamesSet.add(newStageName);
        warnings.push(`Unknown status "${newStageName}" — will be auto-created as a new pipeline stage`);
      }

      if (Object.keys(unmappedValues).length > 0) {
        warnings.push(`${Object.keys(unmappedValues).length} unmapped column(s) will be stored in notes`);
      }

      // Map location fields
      const { locationData } = mapMondayItemToLocation(item, mappings);

      // Group location data by normalised name for conflict detection (D-10)
      const normalisedName = normaliseLocationName(extractLocationName(item));
      if (normalisedName) {
        const existing = locationGroups.get(normalisedName) ?? [];
        existing.push(locationData as Record<string, unknown>);
        locationGroups.set(normalisedName, existing);
      }

      // Parse subitems
      const subitemProducts = mapSubitemsToLocationProducts(item.subitems ?? []);
      for (const sp of subitemProducts) {
        allProductNames.add(sp.productName);
        if (sp.providerName) allProviderNames.add(sp.providerName);
      }

      if (warnings.length === 0) {
        mappedCount++;
      } else {
        warningCount++;
      }

      // Collect sample records (first 20)
      if (sampleRecords.length < 20) {
        sampleRecords.push({
          mondayName: item.name,
          mappedFields: {
            ...kioskData,
            location: locationData.name,
            products: subitemProducts.map((p) => p.productName),
          },
          warnings,
        });
      }
    }

    // Detect field-level conflicts across merged location rows (D-10)
    const conflicts = detectMergeConflicts(locationGroups);

    return {
      success: true,
      preview: {
        totalItems: allItems.length,
        mappedCount,
        warningCount,
        duplicateCount,
        newStageNames: Array.from(newStageNamesSet),
        sampleRecords,
        productNames: Array.from(allProductNames),
        providerNames: Array.from(allProviderNames),
        conflicts,
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Dry import failed" };
  }
}

// =============================================================================
// Server action: runFullImport (MIGR-01, MIGR-03)
// =============================================================================

/**
 * Starts the full Monday.com → DB import in a detached async.
 * Returns sessionId immediately — client polls getImportProgress() for updates.
 *
 * Import order:
 * 1. Fetch all items (one complete cursor loop — Pitfall 1: avoid interleaving)
 * 2. Deduplicate locations by hotel name, insert unique locations
 * 3. Auto-create pipeline stages for unknown status values (D-04)
 * 4. Insert/upsert products and providers from subitem data (D-14)
 * 5. Insert each kiosk with onConflictDoNothing (D-08, Pitfall 6)
 * 6. Create kiosk_assignment for each kiosk→location link
 * 7. Create location_products from subitem data
 * 8. Unmapped columns → concatenated into notes field (D-09)
 * 9. Per-item errors logged and import continues (D-11)
 */
export async function runFullImport(
  boardId: string,
  mappings: FieldMapping[],
  splitDecisions?: SplitDecision[],
  fetchId?: string,
  mode: "fresh" | "incremental" = "incremental"
): Promise<{ success: true; sessionId: string } | { error: string }> {
  try {
    await requireRole("admin");
    boardIdSchema.parse(boardId);

    const sessionId = crypto.randomUUID();
    const progress: ImportProgress = {
      sessionId,
      status: "running",
      current: 0,
      total: 0,
      log: [],
    };
    importSessions.set(sessionId, progress);

    // Kick off the import in a detached async — do NOT await
    void (async () => {
      const logEntry = (
        level: "info" | "warn" | "error",
        message: string
      ) => {
        progress.log.push({ timestamp: new Date().toISOString(), level, message });
      };

      try {
        logEntry("info", "Fetching all items from Monday.com…");

        // Step 1: Fetch ALL items (use cache if available, otherwise fresh fetch)
        let rawItems: MondayItem[];
        if (fetchId && fetchedItemsCache.has(fetchId)) {
          rawItems = fetchedItemsCache.get(fetchId)!;
          fetchedItemsCache.delete(fetchId); // Clean up cache after use
          logEntry("info", `Using cached items (${rawItems.length} items)`);
        } else {
          rawItems = [];
          for await (const page of fetchAllItems(boardId, ({ page: p, itemCount }) => {
            logEntry("info", `Fetched page ${p} (${itemCount} items)`);
          })) {
            rawItems.push(...page);
          }
        }

        // Expand split decisions into separate items
        const allItems = splitDecisions?.length
          ? expandSplitItems(rawItems, splitDecisions, mappings)
          : rawItems;

        if (allItems.length !== rawItems.length) {
          logEntry("info", `Expanded ${rawItems.length} rows → ${allItems.length} kiosks (outlet code splitting)`);
        }

        progress.total = allItems.length;
        logEntry("info", `Total items to process: ${allItems.length}`);

        // Fresh mode: wipe all imported data before reimporting
        if (mode === "fresh") {
          logEntry("info", "Fresh import — wiping existing data…");
          // TRUNCATE CASCADE handles all FK dependencies in one statement
          await db.execute(sql`TRUNCATE TABLE location_products, installation_kiosks, kiosk_assignments, kiosks, locations, products, providers CASCADE`);
          logEntry("info", "All existing kiosks, locations, assignments, products, providers, and product configs deleted");
        }

        // Fetch existing stages and kiosk IDs for conflict checks
        const [existingStageRows, existingKioskRows] = await Promise.all([
          db.select({ id: pipelineStages.id, name: pipelineStages.name }).from(pipelineStages),
          db.select({ kioskId: kiosks.kioskId }).from(kiosks),
        ]);

        const existingStagesMap = new Map(existingStageRows.map((s) => [s.name, s.id]));
        const existingKioskIds = new Set(existingKioskRows.map((k) => k.kioskId));

        // Step 2: Deduplicate locations by normalised hotel name (D-03 / MIGR-09)
        logEntry("info", "Deduplicating locations…");
        const uniqueLocations = new Map<
          string,
          ReturnType<typeof mapMondayItemToLocation>["locationData"]
        >();
        for (const item of allItems) {
          const rawName = extractLocationName(item);
          const dedupeKey = normaliseLocationName(rawName);
          if (dedupeKey && !uniqueLocations.has(dedupeKey)) {
            const { locationData } = mapMondayItemToLocation(item, mappings);
            locationData.name = dedupeKey;
            uniqueLocations.set(dedupeKey, locationData);
          }
        }

        // Insert unique locations in batch
        const locationIdMap = new Map<string, string>(); // name → DB uuid
        const locValues = [...uniqueLocations.entries()].map(([hotelName, locData]) => ({
          name: hotelName,
          ...locData,
        }));

        if (locValues.length > 0) {
          try {
            // Batch insert — skip conflicts
            await db.insert(locations).values(locValues).onConflictDoNothing();
          } catch (err) {
            logEntry("warn", `Batch location insert error: ${err instanceof Error ? err.message : String(err)}`);
            // Fall back to one-by-one for partial success
            for (const val of locValues) {
              try {
                await db.insert(locations).values(val).onConflictDoNothing();
              } catch (innerErr) {
                logEntry("warn", `Failed to insert location "${val.name}": ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`);
              }
            }
          }

          // Resolve all location IDs in one query
          const allLocs = await db
            .select({ id: locations.id, name: locations.name })
            .from(locations);
          for (const loc of allLocs) {
            locationIdMap.set(loc.name, loc.id);
          }
        }
        logEntry("info", `Inserted/resolved ${locationIdMap.size} locations`);

        // Step 3: Auto-create pipeline stages for unknown status values (D-04)
        const newStageNames = new Set<string>();
        for (const item of allItems) {
          const { newStageName } = mapMondayItemToKiosk(item, mappings, existingStagesMap);
          if (newStageName) newStageNames.add(newStageName);
        }

        if (newStageNames.size > 0) {
          logEntry("info", `Auto-creating ${newStageNames.size} new pipeline stage(s)…`);
          const maxPositionRow = await db
            .select({ position: pipelineStages.position })
            .from(pipelineStages)
            .orderBy(pipelineStages.position);
          let nextPosition = (maxPositionRow[maxPositionRow.length - 1]?.position ?? 0) + 1;

          for (const stageName of newStageNames) {
            try {
              const [newStage] = await db
                .insert(pipelineStages)
                .values({ name: stageName, position: nextPosition++, isDefault: false })
                .returning({ id: pipelineStages.id, name: pipelineStages.name });
              if (newStage) {
                existingStagesMap.set(newStage.name, newStage.id);
                logEntry("info", `Created pipeline stage: "${stageName}"`);
              }
            } catch (err) {
              logEntry("warn", `Failed to create stage "${stageName}": ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }

        // Step 4: Insert/upsert products and providers (D-14)
        const allProductNames = new Set<string>();
        const allProviderNames = new Set<string>();

        for (const item of allItems) {
          const subitemData = mapSubitemsToLocationProducts(item.subitems ?? []);
          for (const sp of subitemData) {
            allProductNames.add(sp.productName);
            if (sp.providerName) allProviderNames.add(sp.providerName);
          }
        }

        const productIdMap = new Map<string, string>(); // name → DB uuid
        const providerIdMap = new Map<string, string>(); // name → DB uuid

        if (allProductNames.size > 0) {
          const productRows = await db
            .insert(products)
            .values([...allProductNames].map((name) => ({ name })))
            .onConflictDoNothing()
            .returning({ id: products.id, name: products.name });

          for (const p of productRows) productIdMap.set(p.name, p.id);

          // Fetch any that already existed and weren't returned
          const missing = [...allProductNames].filter((n) => !productIdMap.has(n));
          if (missing.length > 0) {
            const existing = await db
              .select({ id: products.id, name: products.name })
              .from(products)
              .where(inArray(products.name, missing));
            for (const p of existing) productIdMap.set(p.name, p.id);
          }
          logEntry("info", `Resolved ${productIdMap.size} products`);
        }

        if (allProviderNames.size > 0) {
          const providerRows = await db
            .insert(providers)
            .values([...allProviderNames].map((name) => ({ name })))
            .onConflictDoNothing()
            .returning({ id: providers.id, name: providers.name });

          for (const p of providerRows) providerIdMap.set(p.name, p.id);

          const missingProviders = [...allProviderNames].filter((n) => !providerIdMap.has(n));
          if (missingProviders.length > 0) {
            const existing = await db
              .select({ id: providers.id, name: providers.name })
              .from(providers)
              .where(inArray(providers.name, missingProviders));
            for (const p of existing) providerIdMap.set(p.name, p.id);
          }
          logEntry("info", `Resolved ${providerIdMap.size} providers`);
        }

        // Steps 5-7: Prepare all records in memory, then batch insert
        logEntry("info", "Preparing kiosk records…");
        let skipped = 0;
        let errors = 0;

        // Phase A: Prepare kiosk values and per-item metadata
        const kioskValues: (typeof kiosks.$inferInsert)[] = [];
        // Track which item index maps to which hotel name (for assignments after insert)
        const kioskItemMeta: Array<{ hotelName: string; item: MondayItem }> = [];

        for (const item of allItems) {
          progress.current++;

          const { kioskData, unmappedValues, newStageName } = mapMondayItemToKiosk(
            item,
            mappings,
            existingStagesMap
          );

          if (kioskData.kioskId && existingKioskIds.has(kioskData.kioskId)) {
            skipped++;
            continue;
          }

          if (newStageName) {
            kioskData.pipelineStageId = existingStagesMap.get(newStageName);
          }

          if (Object.keys(unmappedValues).length > 0) {
            const notesExtra = Object.entries(unmappedValues)
              .map(([id, val]) => `${id}: ${val}`)
              .join("\n");
            kioskData.notes = kioskData.notes
              ? `${kioskData.notes}\n${notesExtra}`
              : notesExtra;
          }

          kioskValues.push(kioskData as typeof kiosks.$inferInsert);
          kioskItemMeta.push({ hotelName: normaliseLocationName(extractLocationName(item)), item });
          if (kioskData.kioskId) existingKioskIds.add(kioskData.kioskId);
        }

        // Phase B: Batch insert kiosks
        logEntry("info", `Inserting ${kioskValues.length} kiosks…`);
        let kiosksCreated = 0;
        const kioskIdMap = new Map<string, string>(); // kioskId text → DB uuid

        if (kioskValues.length > 0) {
          try {
            const inserted = await db
              .insert(kiosks)
              .values(kioskValues)
              .onConflictDoNothing()
              .returning({ id: kiosks.id, kioskId: kiosks.kioskId });
            for (const k of inserted) kioskIdMap.set(k.kioskId, k.id);
            kiosksCreated = inserted.length;
          } catch (err) {
            logEntry("warn", `Batch kiosk insert failed, falling back to one-by-one: ${err instanceof Error ? err.message : String(err)}`);
            for (const val of kioskValues) {
              try {
                const [ins] = await db.insert(kiosks).values(val).onConflictDoNothing().returning({ id: kiosks.id, kioskId: kiosks.kioskId });
                if (ins) { kioskIdMap.set(ins.kioskId, ins.id); kiosksCreated++; }
              } catch (innerErr) {
                logEntry("error", `Failed to insert kiosk "${val.kioskId}": ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`);
                errors++;
              }
            }
          }
        }
        logEntry("info", `Inserted ${kiosksCreated} kiosks`);

        // Phase C: Batch insert assignments
        const assignmentValues: (typeof kioskAssignments.$inferInsert)[] = [];
        for (const meta of kioskItemMeta) {
          const locationId = locationIdMap.get(meta.hotelName);
          const kioskDbId = kioskIdMap.get(
            kioskValues[kioskItemMeta.indexOf(meta)]?.kioskId ?? ""
          );
          if (locationId && kioskDbId) {
            assignmentValues.push({
              kioskId: kioskDbId,
              locationId,
              assignedBy: "system",
              assignedByName: "Data Migration",
            });
          }
        }

        let assignmentsCreated = 0;
        if (assignmentValues.length > 0) {
          try {
            await db.insert(kioskAssignments).values(assignmentValues).onConflictDoNothing();
            assignmentsCreated = assignmentValues.length;
          } catch (err) {
            logEntry("warn", `Batch assignment insert error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        logEntry("info", `Created ${assignmentsCreated} assignments`);

        // Phase D: Batch insert location_products
        const locProductValues: (typeof locationProducts.$inferInsert)[] = [];
        const processedLocationProducts = new Set<string>(); // dedupe by locationId+productId
        for (const meta of kioskItemMeta) {
          const locationId = locationIdMap.get(meta.hotelName);
          if (!locationId) continue;

          const subitemData = mapSubitemsToLocationProducts(meta.item.subitems ?? []);
          for (const sp of subitemData) {
            const productId = productIdMap.get(sp.productName);
            if (!productId) continue;

            const dedupeKey = `${locationId}:${productId}`;
            if (processedLocationProducts.has(dedupeKey)) continue;
            processedLocationProducts.add(dedupeKey);

            const providerId = sp.providerName ? providerIdMap.get(sp.providerName) : undefined;
            locProductValues.push({
              locationId,
              productId,
              providerId: providerId ?? null,
              availability: sp.availability,
              commissionTiers: sp.commissionTiers.length > 0 ? sp.commissionTiers : null,
            });
          }
        }

        let locationProductsCreated = 0;
        if (locProductValues.length > 0) {
          try {
            await db.insert(locationProducts).values(locProductValues).onConflictDoNothing();
            locationProductsCreated = locProductValues.length;
          } catch (err) {
            logEntry("warn", `Batch location_products insert error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        logEntry("info", `Created ${locationProductsCreated} product configs`);

        progress.status = "complete";
        progress.result = {
          kiosksCreated,
          locationsCreated: locationIdMap.size,
          assignmentsCreated,
          productsCreated: productIdMap.size,
          providersCreated: providerIdMap.size,
          locationProductsCreated,
          skipped,
          errors,
        };
        logEntry(
          "info",
          `Import complete: ${kiosksCreated} kiosks, ${locationIdMap.size} locations, ${assignmentsCreated} assignments, ${locationProductsCreated} product configs, ${errors} errors, ${skipped} skipped`
        );
      } catch (err) {
        progress.status = "error";
        progress.log.push({
          timestamp: new Date().toISOString(),
          level: "error",
          message: `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();

    return { success: true, sessionId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to start import" };
  }
}

// =============================================================================
// Server action: getImportProgress
// =============================================================================

/**
 * Reads import progress from the module-level sessions Map.
 * Client polls this every 1-2s to update the progress UI (D-07).
 */
export async function getImportProgress(
  sessionId: string
): Promise<ImportProgress | { error: string }> {
  try {
    await requireRole("admin");

    const session = importSessions.get(sessionId);
    if (!session) {
      return { error: "Session not found" };
    }

    return session;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to get progress" };
  }
}
