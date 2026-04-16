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
  appSettings,
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
// Server action: loadBoardIds (MIGR-10)
// =============================================================================

/**
 * Reads saved Monday.com board IDs from appSettings table.
 * Returns empty strings if table doesn't exist yet or values not set.
 */
export async function loadBoardIds(): Promise<{
  kiosks: string;
  hotels: string;
  kioskConfigGroups: string;
}> {
  try {
    await requireRole("admin");
    const rows = await db
      .select({ key: appSettings.key, value: appSettings.value })
      .from(appSettings)
      .where(inArray(appSettings.key, ["boardId.kiosks", "boardId.hotels", "boardId.kioskConfigGroups"]));
    const map = new Map(rows.map(r => [r.key, r.value]));
    return {
      kiosks: map.get("boardId.kiosks") ?? "",
      hotels: map.get("boardId.hotels") ?? "",
      kioskConfigGroups: map.get("boardId.kioskConfigGroups") ?? "",
    };
  } catch {
    return { kiosks: "", hotels: "", kioskConfigGroups: "" };
  }
}

// =============================================================================
// Server action: saveBoardIds (MIGR-10)
// =============================================================================

/**
 * Upserts Monday.com board IDs into appSettings table.
 * Skips empty values — only saves non-empty inputs.
 */
export async function saveBoardIds(ids: {
  kiosks: string;
  hotels: string;
  kioskConfigGroups: string;
}): Promise<{ success: true } | { error: string }> {
  try {
    await requireRole("admin");
    const entries = [
      { key: "boardId.kiosks", value: ids.kiosks },
      { key: "boardId.hotels", value: ids.hotels },
      { key: "boardId.kioskConfigGroups", value: ids.kioskConfigGroups },
    ].filter(e => e.value.trim() !== "");

    for (const entry of entries) {
      await db
        .insert(appSettings)
        .values({ key: entry.key, value: entry.value })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value: entry.value, updatedAt: new Date() },
        });
    }
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save board IDs" };
  }
}

// =============================================================================
// Server action: loadCustomFields / saveCustomFields
// =============================================================================

export type CustomFieldDef = {
  value: string;
  label: string;
  table: "kiosk" | "location";
};

export async function loadCustomFields(): Promise<CustomFieldDef[]> {
  try {
    await requireRole("admin");
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, "import.customFields"));
    if (!row) return [];
    return JSON.parse(row.value) as CustomFieldDef[];
  } catch {
    return [];
  }
}

export async function saveCustomFields(
  fields: CustomFieldDef[]
): Promise<{ success: true } | { error: string }> {
  try {
    await requireRole("admin");
    await db
      .insert(appSettings)
      .values({ key: "import.customFields", value: JSON.stringify(fields) })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: JSON.stringify(fields), updatedAt: new Date() },
      });
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to save custom fields" };
  }
}

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
    const persistedCustomFields = await loadCustomFields();
    const mappings = autoDetectMappings(columns, persistedCustomFields);

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

    // Expand split decisions into separate items.
    // If caller didn't provide decisions, auto-detect (one outlet = one kiosk).
    const effectiveSplits = splitDecisions?.length
      ? splitDecisions
      : detectMultiOutletRows(rawItems, mappings);
    const allItems = effectiveSplits.length
      ? expandSplitItems(rawItems, effectiveSplits, mappings)
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
      const { kioskData, unmappedValues, newStageName, locationCrossFields } = mapMondayItemToKiosk(
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

      // Map location fields + apply cross-fields from kiosk mapping (Region → region, Status → status)
      const { locationData } = mapMondayItemToLocation(item, mappings);
      if (locationCrossFields.region && !locationData.region) locationData.region = locationCrossFields.region;
      if (locationCrossFields.status && !locationData.status) locationData.status = locationCrossFields.status;

      // Group location data by name for conflict detection (D-10)
      // Keep outlet code suffix — dedup deferred until after config groups import
      const locationName = extractLocationName(item, mappings);
      if (locationName) {
        const existing = locationGroups.get(locationName) ?? [];
        existing.push(locationData as Record<string, unknown>);
        locationGroups.set(locationName, existing);
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
  mode: "fresh" | "incremental" = "incremental",
  conflictResolutions?: Record<string, Record<string, string>>
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

        // Expand split decisions into separate items.
        // If caller didn't provide decisions, auto-detect (one outlet = one kiosk).
        const effectiveSplits = splitDecisions?.length
          ? splitDecisions
          : detectMultiOutletRows(rawItems, mappings);
        const allItems = effectiveSplits.length
          ? expandSplitItems(rawItems, effectiveSplits, mappings)
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

        // Step 2: Collect unique locations — keep outlet code suffix for now
        // Dedup (normalising away [outlet_code]) is deferred until after config groups import
        logEntry("info", "Collecting locations…");
        const uniqueLocations = new Map<
          string,
          ReturnType<typeof mapMondayItemToLocation>["locationData"]
        >();
        const locationPocNames = new Map<string, string[]>(); // locationName → POC names (split on comma)
        for (const item of allItems) {
          const rawName = extractLocationName(item, mappings);
          if (rawName && !uniqueLocations.has(rawName)) {
            const { locationData, internalPocName } = mapMondayItemToLocation(item, mappings);
            locationData.name = rawName;
            uniqueLocations.set(rawName, locationData);
            if (internalPocName) {
              // Split comma-separated POC names into individual users
              const names = internalPocName.split(",").map((n) => n.trim()).filter(Boolean);
              if (names.length > 0) locationPocNames.set(rawName, names);
            }
          }
        }

        // Resolve POC names to user IDs (auto-creates users if needed)
        if (locationPocNames.size > 0) {
          const allPocNames = [...locationPocNames.values()].flat();
          const uniquePocNames = [...new Set(allPocNames)];
          logEntry("info", `Resolving ${uniquePocNames.length} internal POC name(s) to users…`);
          const { resolveOrCreateUserByName } = await import("@/lib/user-lookup");
          const pocNameToUserId = new Map<string, string>();
          for (const pocName of uniquePocNames) {
            try {
              const userId = await resolveOrCreateUserByName(pocName);
              pocNameToUserId.set(pocName, userId);
            } catch (err) {
              logEntry("warn", `Failed to resolve POC "${pocName}": ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          // Apply first resolved user ID to location records (schema supports single POC)
          for (const [locName, pocNames] of locationPocNames) {
            const firstUserId = pocNames.map((n) => pocNameToUserId.get(n)).find(Boolean);
            if (firstUserId) {
              const locData = uniqueLocations.get(locName);
              if (locData) locData.internalPocId = firstUserId;
            }
          }
          logEntry("info", `Resolved ${pocNameToUserId.size}/${uniquePocNames.length} POC names`);
        }

        // Insert unique locations in batch
        const locationIdMap = new Map<string, string>(); // name → DB uuid
        const locValues = [...uniqueLocations.entries()].map(([hotelName, locData]) => {
          // Apply admin-selected conflict resolutions for this location's fields
          const resolved = conflictResolutions?.[hotelName];
          if (resolved) {
            const patched = { ...locData } as Record<string, unknown>;
            for (const [field, chosenValue] of Object.entries(resolved)) {
              patched[field] = chosenValue;
            }
            return { name: hotelName, ...patched };
          }
          return { name: hotelName, ...locData };
        });

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

          const { kioskData, unmappedValues, newStageName, locationCrossFields } = mapMondayItemToKiosk(
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

          // Cross-populate location fields from kiosk-targeted columns (Region → location.region, Status → location.status)
          const hotelName = extractLocationName(item, mappings);
          if (hotelName && uniqueLocations.has(hotelName)) {
            const loc = uniqueLocations.get(hotelName)!;
            if (locationCrossFields.region && !loc.region) loc.region = locationCrossFields.region;
            if (locationCrossFields.status && !loc.status) loc.status = locationCrossFields.status;
          }

          kioskValues.push(kioskData as typeof kiosks.$inferInsert);
          kioskItemMeta.push({ hotelName, item });
          if (kioskData.kioskId) existingKioskIds.add(kioskData.kioskId);
        }

        // Phase A.5: Flush cross-populated fields (region, status) to DB
        // The kiosk loop above sets location.region/status on uniqueLocations,
        // but locations were already inserted — push updates now.
        let crossUpdated = 0;
        for (const [locName, locData] of uniqueLocations) {
          const locId = locationIdMap.get(locName);
          if (!locId) continue;
          const patch: Record<string, unknown> = {};
          if (locData.region) patch.region = locData.region;
          if (locData.status) patch.status = locData.status;
          if (Object.keys(patch).length > 0) {
            patch.updatedAt = new Date();
            await db.update(locations).set(patch).where(eq(locations.id, locId));
            crossUpdated++;
          }
        }
        if (crossUpdated > 0) {
          logEntry("info", `Cross-populated region/status for ${crossUpdated} locations`);
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

// =============================================================================
// Post-import location deduplication
// =============================================================================

/**
 * Merges locations that share the same base name after stripping [outlet_code] suffixes.
 * Called after config groups are imported to maintain FK consistency.
 * Re-points kiosk_assignments and location_products to the canonical location before deleting duplicates.
 */
export async function deduplicateLocations(): Promise<
  { success: true; merged: number } | { error: string }
> {
  try {
    await requireRole("admin");

    const allLocs = await db
      .select({ id: locations.id, name: locations.name })
      .from(locations);

    // Group by normalised name (strips [outlet_code] suffix)
    const groups = new Map<string, Array<{ id: string; name: string }>>();
    for (const loc of allLocs) {
      const key = normaliseLocationName(loc.name);
      const arr = groups.get(key) ?? [];
      arr.push(loc);
      groups.set(key, arr);
    }

    let merged = 0;
    for (const [normName, locs] of groups) {
      if (locs.length < 2) continue;

      // First entry is canonical
      const canonical = locs[0];
      const duplicateIds = locs.slice(1).map((l) => l.id);

      // Update canonical location name to normalised (strip suffix)
      await db
        .update(locations)
        .set({ name: normName })
        .where(eq(locations.id, canonical.id));

      // Re-point kiosk_assignments from duplicates to canonical
      await db
        .update(kioskAssignments)
        .set({ locationId: canonical.id })
        .where(inArray(kioskAssignments.locationId, duplicateIds));

      // Re-point location_products from duplicates to canonical
      await db
        .update(locationProducts)
        .set({ locationId: canonical.id })
        .where(inArray(locationProducts.locationId, duplicateIds));

      // Delete duplicate locations
      await db.delete(locations).where(inArray(locations.id, duplicateIds));

      merged += duplicateIds.length;
    }

    return { success: true, merged };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to deduplicate locations" };
  }
}
