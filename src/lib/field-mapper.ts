// Field mapping engine for Monday.com → Drizzle schema transformation
// Converts Monday.com board column values into database-compatible records.

import type { MondayItem, MondaySubitem, MondayColumnValue, BoardColumn } from "./monday-client";
import type { kiosks, locations } from "@/db/schema";

// =============================================================================
// Types
// =============================================================================

export interface FieldMapping {
  mondayColumnId: string;
  mondayTitle: string;
  mondayType: string;
  targetTable: "kiosk" | "location" | null;
  targetField: string | null;
  status: "mapped" | "unmapped";
}

export type MergeConflict = {
  locationName: string;
  field: string;
  values: string[]; // distinct values found across rows
};

export interface ImportPreview {
  totalItems: number;
  mappedCount: number;
  warningCount: number;
  duplicateCount: number;
  newStageNames: string[];
  sampleRecords: Array<{
    mondayName: string;
    mappedFields: Record<string, unknown>;
    warnings: string[];
  }>;
  productNames: string[];
  providerNames: string[];
  conflicts: MergeConflict[];
}

export interface ImportProgress {
  sessionId: string;
  status: "idle" | "running" | "complete" | "error";
  current: number;
  total: number;
  log: Array<{ timestamp: string; level: "info" | "warn" | "error"; message: string }>;
  result?: {
    kiosksCreated: number;
    locationsCreated: number;
    assignmentsCreated: number;
    productsCreated: number;
    providersCreated: number;
    locationProductsCreated: number;
    skipped: number;
    errors: number;
  };
}

export interface SplitDecision {
  mondayItemId: string;
  mondayItemName: string;
  outletCodes: string[];
  ssmCount: number;
  decision: "split" | "keep";
}

// =============================================================================
// Known field mappings (from reference project + RESEARCH.md)
// =============================================================================

export const KNOWN_FIELD_MAP: Record<string, { table: "kiosk" | "location"; field: string }> = {
  // Kiosk fields
  "Outlet Code": { table: "kiosk", field: "outletCode" },
  "Cust_cd (RPS)": { table: "location", field: "customerCode" },
  "Location Group": { table: "location", field: "locationGroup" },  // D-22: was kiosk.regionGroup
  "SSM Location Group": { table: "location", field: "locationGroup" },
  "Live Date": { table: "kiosk", field: "installationDate" },
  "Region": { table: "kiosk", field: "regionGroup" },  // also cross-populates location.region
  "Status": { table: "kiosk", field: "pipelineStageId" },  // also cross-populates location.status
  "Launch Phase": { table: "kiosk", field: "deploymentPhaseTags" },
  "SSM Group": { table: "kiosk", field: "regionGroup" },
  "CMS Config": { table: "kiosk", field: "cmsConfigStatus" },
  "CMS": { table: "kiosk", field: "cmsConfigStatus" },
  "Maintenance Fee Ex VAT": { table: "location", field: "maintenanceFee" },
  "Maintenance Fee": { table: "location", field: "maintenanceFee" },
  "Free Trial End Date": { table: "location", field: "freeTrialEndDate" },
  "Assets": { table: "kiosk", field: "hardwareSerialNumber" },  // MIGR-05: was location.hardwareAssets
  "Asset": { table: "kiosk", field: "hardwareSerialNumber" },
  "Asset ID": { table: "kiosk", field: "hardwareSerialNumber" },
  "Serial Number": { table: "kiosk", field: "hardwareSerialNumber" },
  "Hardware Model": { table: "kiosk", field: "hardwareModel" },
  "Model": { table: "kiosk", field: "hardwareModel" },
  "Software Version": { table: "kiosk", field: "softwareVersion" },
  "Version": { table: "kiosk", field: "softwareVersion" },
  "Number of SSMs": { table: "location", field: "_ssmCount" },
  "Subitems": { table: "location", field: "_subitems" },
  // Location fields
  "Hotel's Number of Rooms": { table: "location", field: "roomCount" },
  "Hotel Star Rating": { table: "location", field: "starRating" },
  "Hotel Address": { table: "location", field: "address" },
  "Hotel": { table: "location", field: "_hotelName" },
  "Hotel Group": { table: "location", field: "hotelGroup" },
  "Contract Value": { table: "location", field: "contractValue" },
  "Contract Start Date": { table: "location", field: "contractStartDate" },
  "Contract End Date": { table: "location", field: "contractEndDate" },
  "Contract Terms": { table: "location", field: "contractTerms" },
  "Banking Details": { table: "location", field: "bankingDetails" },
  "Bank Details": { table: "location", field: "bankingDetails" },
  "Key Contact Name": { table: "location", field: "internalPoc" },  // MIGR-08: was keyContactName
  "Key Contact": { table: "location", field: "internalPoc" },       // MIGR-08: alias
  "Key Contact Email": { table: "location", field: "keyContactEmail" },
  "Additional Contact Email": { table: "location", field: "additionalContactEmail" },
  "Finance Contact": { table: "location", field: "financeContact" },
  "Sourced By": { table: "location", field: "sourcedBy" },
  "Hotel Status": { table: "location", field: "status" },
  "Notes": { table: "location", field: "notes" },
};

// =============================================================================
// Auto-detect field mappings from board columns (D-02)
// =============================================================================

/**
 * For each Monday.com board column, attempt exact then case-insensitive partial
 * matching against KNOWN_FIELD_MAP and persisted custom fields. Returns a mapping entry per column.
 */
export function autoDetectMappings(
  columns: BoardColumn[],
  customFields?: Array<{ value: string; label: string; table: "kiosk" | "location" }>
): FieldMapping[] {
  return columns.map((col) => {
    // 1. Exact match against KNOWN_FIELD_MAP
    const exactMatch = KNOWN_FIELD_MAP[col.title];
    if (exactMatch) {
      return {
        mondayColumnId: col.id,
        mondayTitle: col.title,
        mondayType: col.type,
        targetTable: exactMatch.table,
        targetField: exactMatch.field,
        status: "mapped",
      };
    }

    // 2. Case-insensitive includes match against KNOWN_FIELD_MAP
    const lowerTitle = col.title.toLowerCase();
    const fuzzyKey = Object.keys(KNOWN_FIELD_MAP).find((key) =>
      key.toLowerCase().includes(lowerTitle) ||
      lowerTitle.includes(key.toLowerCase())
    );
    if (fuzzyKey) {
      const fuzzyMatch = KNOWN_FIELD_MAP[fuzzyKey];
      return {
        mondayColumnId: col.id,
        mondayTitle: col.title,
        mondayType: col.type,
        targetTable: fuzzyMatch.table,
        targetField: fuzzyMatch.field,
        status: "mapped",
      };
    }

    // 3. Fuzzy match against persisted custom fields
    if (customFields?.length) {
      const customMatch = customFields.find((cf) => {
        // Extract the human name from label like "Kiosk — Contract Reference (custom)"
        const namePart = cf.label.replace(/^(Kiosk|Location)\s*—\s*/, "").replace(/\s*\(custom\)$/, "").toLowerCase();
        return namePart.includes(lowerTitle) || lowerTitle.includes(namePart);
      });
      if (customMatch) {
        const [table, ...fieldParts] = customMatch.value.split(":") as [string, ...string[]];
        return {
          mondayColumnId: col.id,
          mondayTitle: col.title,
          mondayType: col.type,
          targetTable: table as "kiosk" | "location",
          targetField: fieldParts.join(":"),
          status: "mapped",
        };
      }
    }

    // 4. Unmapped
    return {
      mondayColumnId: col.id,
      mondayTitle: col.title,
      mondayType: col.type,
      targetTable: null,
      targetField: null,
      status: "unmapped",
    };
  });
}

// =============================================================================
// Kiosk field extractor
// =============================================================================

/**
 * Maps a Monday.com item to a kiosk DB record using the confirmed mappings.
 * - Item name is used as kioskId
 * - Status label is returned as newStageName if no matching stage exists (D-04)
 * - Unmapped column values are collected for the notes field (D-09)
 */
export function mapMondayItemToKiosk(
  item: MondayItem,
  mappings: FieldMapping[],
  existingStages: Map<string, string> // stage name → stage id
): {
  kioskData: Partial<typeof kiosks.$inferInsert>;
  unmappedValues: Record<string, string>;
  newStageName?: string;
  locationCrossFields: { region?: string; status?: string };
} {
  // Derive kioskId: region + outlet code (MIGR-04 / D-17), falls back to item name
  // The Monday.com kiosks board uses item.name AS the asset identifier
  // (typically WKG-POS-XXX, though occasionally a hotel name if the data is messy upstream).
  let region = "";
  const regionMapping = mappings.find(
    (m) => m.targetField === "regionGroup" && m.status === "mapped"
  );
  if (regionMapping) {
    const regionCol = item.column_values.find((cv) => cv.id === regionMapping.mondayColumnId);
    if (regionCol) region = getColumnDisplayValue(regionCol);
  }
  let outletVal = "";
  const outletMapping = mappings.find(
    (m) => m.targetField === "outletCode" && m.status === "mapped"
  );
  if (outletMapping) {
    const outletCol = item.column_values.find((cv) => cv.id === outletMapping.mondayColumnId);
    outletVal = outletCol ? getColumnDisplayValue(outletCol) : "";
  }
  // If an Assets column is explicitly mapped, prefer it for the asset ID (rare; most boards don't have one).
  let assetVal = "";
  const assetMapping = mappings.find(
    (m) => m.targetField === "hardwareSerialNumber" && m.status === "mapped"
  );
  if (assetMapping) {
    const assetCol = item.column_values.find((cv) => cv.id === assetMapping.mondayColumnId);
    assetVal = assetCol ? getColumnDisplayValue(assetCol) : "";
  }

  const derivedKioskId = outletVal
    ? (region ? `${region}-${outletVal}` : outletVal)
    : item.name;

  const kioskData: Partial<typeof kiosks.$inferInsert> = {
    kioskId: derivedKioskId,
    // Asset ID: explicit Assets column value if present, else Monday.com item name.
    hardwareSerialNumber: assetVal || item.name,
  };
  const unmappedValues: Record<string, string> = {};
  let newStageName: string | undefined;
  const locationCrossFields: { region?: string; status?: string } = {};

  // Build a lookup of columnId → mapping
  const mappingById = new Map<string, FieldMapping>(
    mappings.map((m) => [m.mondayColumnId, m])
  );

  for (const colVal of item.column_values) {
    const mapping = mappingById.get(colVal.id);

    // Truly unmapped: no mapping found or explicitly unmapped — collect into notes (MIGR-07)
    if (!mapping || mapping.status === "unmapped") {
      const displayValue = getColumnDisplayValue(colVal);
      if (displayValue) {
        unmappedValues[colVal.id] = displayValue;
      }
      continue;
    }

    // Mapped to location or other non-kiosk table: skip (don't dump into kiosk notes)
    if (mapping.targetTable !== "kiosk") continue;

    const field = mapping.targetField!;
    const displayValue = getColumnDisplayValue(colVal);

    if (!displayValue) continue;

    if (field === "pipelineStageId") {
      const label = colVal.label ?? colVal.text;
      if (label) {
        const stageId = existingStages.get(label);
        if (stageId) {
          kioskData.pipelineStageId = stageId;
        } else {
          newStageName = label;
        }
        locationCrossFields.status = label;  // cross-populate location.status
      }
    } else if (field === "installationDate") {
      const dateStr = colVal.date ?? colVal.text;
      if (dateStr) {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          kioskData.installationDate = parsed;
        }
      }
    } else if (field === "outletCode") {
      kioskData.outletCode = displayValue;
    } else if (field === "regionGroup") {
      kioskData.regionGroup = displayValue;
      locationCrossFields.region = displayValue;  // cross-populate location.region
    } else if (field === "deploymentPhaseTags") {
      kioskData.deploymentPhaseTags = displayValue
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    } else if (field === "cmsConfigStatus") {
      kioskData.cmsConfigStatus = displayValue;
    } else if (field === "hardwareSerialNumber") {
      kioskData.hardwareSerialNumber = displayValue;
    } else if (field === "hardwareModel") {
      kioskData.hardwareModel = displayValue;
    } else if (field === "softwareVersion") {
      kioskData.softwareVersion = displayValue;
    } else if (field === "maintenanceFee") {
      const parsed = parseNumericField(displayValue);
      if (parsed !== null) kioskData.maintenanceFee = String(parsed);
    } else if (field === "freeTrialEndDate") {
      const dateStr = colVal.date ?? colVal.text;
      if (dateStr) {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) kioskData.freeTrialEndDate = parsed;
      }
    } else if (field === "freeTrialStatus") {
      kioskData.freeTrialStatus = displayValue.toLowerCase() === "true" || displayValue === "1";
    } else if (field === "notes") {
      kioskData.notes = kioskData.notes
        ? `${kioskData.notes}\n${displayValue}`
        : displayValue;
    } else if (field.startsWith("custom:")) {
      const customKey = field.slice(7);
      kioskData.customFields = {
        ...(kioskData.customFields as Record<string, string> | undefined),
        [customKey]: displayValue,
      };
    }
  }

  return { kioskData, unmappedValues, newStageName, locationCrossFields };
}

// =============================================================================
// Location field extractor
// =============================================================================

/**
 * Maps a Monday.com item to a location DB record using the confirmed mappings.
 * Item name is used as the location name.
 */
export function mapMondayItemToLocation(
  item: MondayItem,
  mappings: FieldMapping[]
): { locationData: Partial<typeof locations.$inferInsert>; ssmCount: number; internalPocName?: string; hotelName?: string } {
  const locationData: Partial<typeof locations.$inferInsert> = {
    name: item.name,
  };
  let internalPocName: string | undefined;
  let hotelName: string | undefined;

  const mappingById = new Map<string, FieldMapping>(
    mappings.map((m) => [m.mondayColumnId, m])
  );

  // Composite keyContacts collectors
  let keyContactEmail = "";
  let additionalContactEmail = "";
  let financeContact = "";
  let ssmCount = 0;

  for (const colVal of item.column_values) {
    const mapping = mappingById.get(colVal.id);

    if (!mapping || mapping.status === "unmapped" || mapping.targetTable !== "location") {
      continue;
    }

    const field = mapping.targetField!;
    const displayValue = getColumnDisplayValue(colVal);
    if (!displayValue) continue;

    if (field === "address") {
      locationData.address = displayValue;
    } else if (field === "hotelGroup") {
      locationData.hotelGroup = displayValue.split(",")[0].trim();
    } else if (field === "roomCount") {
      const parsed = parseInt(displayValue, 10);
      if (!isNaN(parsed)) locationData.roomCount = parsed;
    } else if (field === "starRating") {
      const parsed = parseInt(displayValue, 10);
      if (!isNaN(parsed)) locationData.starRating = parsed;
    } else if (field === "customerCode") {
      // May be comma-separated repeats — take first unique value
      const codes = [...new Set(displayValue.split(",").map((c) => c.trim()).filter(Boolean))];
      locationData.customerCode = codes[0] ?? displayValue;
    } else if (field === "sourcedBy") {
      locationData.sourcedBy = displayValue;
    } else if (field === "contractValue") {
      const parsed = parseNumericField(displayValue);
      if (parsed !== null) locationData.contractValue = parsed;
    } else if (field === "contractStartDate") {
      const dateStr = colVal.date ?? colVal.text;
      if (dateStr) {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) locationData.contractStartDate = parsed;
      }
    } else if (field === "contractEndDate") {
      const dateStr = colVal.date ?? colVal.text;
      if (dateStr) {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) locationData.contractEndDate = parsed;
      }
    } else if (field === "contractTerms") {
      locationData.contractTerms = displayValue;
    } else if (field === "bankingDetails") {
      try {
        locationData.bankingDetails = JSON.parse(displayValue);
      } catch {
        locationData.bankingDetails = { raw: displayValue };
      }
    } else if (field === "maintenanceFee") {
      const parsed = parseNumericField(displayValue);
      if (parsed !== null) locationData.maintenanceFee = parsed;
    } else if (field === "freeTrialEndDate") {
      const dateStr = colVal.date ?? colVal.text;
      if (dateStr) {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) locationData.freeTrialEndDate = parsed;
      }
    } else if (field === "hardwareAssets") {
      locationData.hardwareAssets = displayValue;
    } else if (field === "_ssmCount") {
      const parsed = parseInt(displayValue, 10);
      if (!isNaN(parsed)) ssmCount = parsed;
    } else if (field === "notes") {
      locationData.notes = locationData.notes
        ? `${locationData.notes}\n${displayValue}`
        : displayValue;
    } else if (field === "internalPoc") {
      internalPocName = displayValue;  // collected separately — resolved to user ID during import
    } else if (field === "_hotelName") {
      hotelName = displayValue;  // extracted separately — used as location name
    } else if (field === "locationGroup") {
      locationData.locationGroup = displayValue;
    } else if (field === "region") {
      locationData.region = displayValue;
    } else if (field === "status") {
      locationData.status = displayValue;
    } else if (field === "keyContactEmail") {
      keyContactEmail = displayValue;
    } else if (field === "additionalContactEmail") {
      additionalContactEmail = displayValue;
    } else if (field === "financeContact") {
      financeContact = displayValue;
    } else if (field.startsWith("custom:")) {
      const customKey = field.slice(7);
      locationData.customFields = {
        ...(locationData.customFields as Record<string, string> | undefined),
        [customKey]: displayValue,
      };
    }
  }

  // Build composite keyContacts from collected fields
  const contacts: Array<{ name: string; role: string; email: string; phone: string }> = [];
  if (keyContactEmail) {
    contacts.push({ name: "", role: "Primary", email: keyContactEmail, phone: "" });
  }
  if (additionalContactEmail) {
    contacts.push({ name: "", role: "Additional", email: additionalContactEmail, phone: "" });
  }
  if (financeContact) {
    contacts.push({ name: "", role: "Finance", email: financeContact, phone: "" });
  }
  if (contacts.length > 0) {
    locationData.keyContacts = contacts;
  }

  return { locationData, ssmCount, internalPocName, hotelName };
}

// =============================================================================
// Location name extractor (for deduplication key — D-03)
// =============================================================================

/**
 * Extract the hotel/location name from a Monday.com item for deduplication.
 * Prefers the "Hotel" column value if mapped; falls back to item.name.
 */
export function extractLocationName(item: MondayItem, mappings?: FieldMapping[]): string {
  if (mappings) {
    const hotelMapping = mappings.find(
      (m) => m.targetField === "_hotelName" && m.status === "mapped"
    );
    if (hotelMapping) {
      const hotelCol = item.column_values.find((cv) => cv.id === hotelMapping.mondayColumnId);
      if (hotelCol) {
        const val = getColumnDisplayValue(hotelCol);
        if (val) return val;
      }
    }
  }
  return item.name;
}

/**
 * Strips outlet code suffix appended by expandSplitItems (" [CODE]") to get canonical hotel name.
 * Used as deduplication key: two items with same normalised name → same location record.
 * Example: "Grand Hotel [ABC123]" → "Grand Hotel" (MIGR-09 / D-09)
 */
export function normaliseLocationName(rawName: string): string {
  return rawName.replace(/\s*\[[^\]]+\]$/, "").trim();
}

// =============================================================================
// Merge conflict detection (D-10)
// =============================================================================

/**
 * Detects field-level conflicts when multiple rows normalise to the same hotel name.
 * Returns an array of conflicts where two or more rows disagree on the same field value.
 * Used by dry-run preview so admin can resolve before import (D-10).
 */
export function detectMergeConflicts(
  locationGroups: Map<string, Array<Record<string, unknown>>>
): MergeConflict[] {
  const conflicts: MergeConflict[] = [];
  for (const [locName, rows] of locationGroups) {
    if (rows.length < 2) continue;
    // Compare field values across all rows for this location
    const fieldKeys = new Set(rows.flatMap((r) => Object.keys(r)));
    for (const field of fieldKeys) {
      if (field === "name") continue; // name is the merge key, skip
      const distinctValues = [
        ...new Set(rows.map((r) => String(r[field] ?? "")).filter((v) => v !== "")),
      ];
      if (distinctValues.length > 1) {
        conflicts.push({ locationName: locName, field, values: distinctValues });
      }
    }
  }
  return conflicts;
}

// =============================================================================
// Subitem parser — product/provider/commission (D-13, D-17)
// =============================================================================

/**
 * Maps Monday.com subitems to location product records.
 *
 * Per D-17: Subitem column IDs:
 *   label2__1              → Provider name (e.g. "Uber", "WeKnow")
 *   color5__1              → Availability ("Yes"/"No"/"Unavailable")
 *   dup__of_commission9__1 → Commission rate for <£3000pm revenue
 *   numeric_mkse455j       → Commission rate for >£3000pm revenue
 */
export function mapSubitemsToLocationProducts(
  subitems: MondaySubitem[]
): Array<{
  productName: string;
  providerName: string | null;
  availability: "yes" | "no" | "unavailable";
  commissionTiers: Array<{ minRevenue: number; maxRevenue: number | null; rate: number }>;
}> {
  return subitems.map((sub) => {
    const colById = new Map<string, MondayColumnValue>(
      sub.column_values.map((cv) => [cv.id, cv])
    );

    const providerCol = colById.get("label2__1");
    const availCol = colById.get("color5__1");
    const commissionLowCol = colById.get("dup__of_commission9__1");
    const commissionHighCol = colById.get("numeric_mkse455j");

    // Provider
    const providerName = providerCol?.text?.trim() || null;

    // Availability — normalise to lowercase "yes"/"no"/"unavailable"
    const availRaw = (availCol?.text ?? availCol?.label ?? "").toLowerCase().trim();
    let availability: "yes" | "no" | "unavailable" = "unavailable";
    if (availRaw === "yes") availability = "yes";
    else if (availRaw === "no") availability = "no";

    // Commission tiers (D-13)
    const commissionTiers: Array<{ minRevenue: number; maxRevenue: number | null; rate: number }> = [];

    const lowRate = parseCommissionRate(commissionLowCol?.text ?? commissionLowCol?.value);
    const highRate = parseCommissionRate(commissionHighCol?.text ?? commissionHighCol?.value);

    if (lowRate !== null && highRate !== null) {
      commissionTiers.push({ minRevenue: 0, maxRevenue: 3000, rate: lowRate });
      commissionTiers.push({ minRevenue: 3000, maxRevenue: null, rate: highRate });
    } else if (lowRate !== null) {
      commissionTiers.push({ minRevenue: 0, maxRevenue: null, rate: lowRate });
    } else if (highRate !== null) {
      commissionTiers.push({ minRevenue: 0, maxRevenue: null, rate: highRate });
    }

    return {
      productName: sub.name,
      providerName,
      availability,
      commissionTiers,
    };
  });
}

// =============================================================================
// Outlet code splitting detection
// =============================================================================

/**
 * Detects Monday.com rows with comma-separated outlet codes (potential multi-kiosk).
 * Pre-selects "split" when SSM count > 1 or matches the number of outlet codes.
 */
export function detectMultiOutletRows(
  items: MondayItem[],
  mappings: FieldMapping[]
): SplitDecision[] {
  const decisions: SplitDecision[] = [];

  // Find the outlet code mapping to identify the right column
  const outletMapping = mappings.find(
    (m) => m.targetField === "outletCode" && m.status === "mapped"
  );
  if (!outletMapping) return decisions;

  for (const item of items) {
    const outletCol = item.column_values.find((cv) => cv.id === outletMapping.mondayColumnId);
    const outletValue = outletCol ? getColumnDisplayValue(outletCol) : "";

    if (!outletValue || !outletValue.includes(",")) continue;

    const codes = outletValue.split(",").map((c) => c.trim()).filter(Boolean);
    if (codes.length <= 1) continue;

    // Extract SSM count from location mapping
    const { ssmCount } = mapMondayItemToLocation(item, mappings);

    // Always split multi-outlet rows — one outlet code = one kiosk
    decisions.push({
      mondayItemId: item.id,
      mondayItemName: item.name,
      outletCodes: codes,
      ssmCount,
      decision: "split",
    });
  }

  return decisions;
}

/**
 * Expands items based on split decisions. A "split" row becomes N items,
 * one per outlet code. Each clone gets a unique kiosk ID suffix.
 */
export function expandSplitItems(
  items: MondayItem[],
  splitDecisions: SplitDecision[],
  mappings: FieldMapping[]
): MondayItem[] {
  if (splitDecisions.length === 0) return items;

  const splitMap = new Map(splitDecisions.map((sd) => [sd.mondayItemId, sd]));
  const outletMapping = mappings.find(
    (m) => m.targetField === "outletCode" && m.status === "mapped"
  );

  const expanded: MondayItem[] = [];

  for (const item of items) {
    const sd = splitMap.get(item.id);

    if (!sd || sd.decision === "keep" || !outletMapping) {
      expanded.push(item);
      continue;
    }

    // Clone the item once per outlet code
    for (const code of sd.outletCodes) {
      const clone: MondayItem = {
        ...item,
        // Unique kiosk ID per split: "HotelName [ABC123]"
        name: `${item.name} [${code}]`,
        column_values: item.column_values.map((cv) => {
          if (cv.id === outletMapping.mondayColumnId) {
            return { ...cv, text: code, value: code, label: code };
          }
          return cv;
        }),
        subitems: item.subitems,
      };
      expanded.push(clone);
    }
  }

  return expanded;
}

// =============================================================================
// Internal helpers
// =============================================================================

/** Get the best display value from a column value (text > label > display_value > value) */
function getColumnDisplayValue(col: MondayColumnValue): string {
  return (
    col.label ??
    (col.text?.trim() || null) ??
    col.display_value ??
    (col.value ? String(col.value) : null) ??
    ""
  );
}

/** Parse a numeric field — strips currency symbols/commas, validates as a number, returns string or null */
function parseNumericField(raw: string): string | null {
  const cleaned = raw.replace(/[£$€,\s]/g, "").trim();
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return null;
  return String(parsed);
}

/** Parse a commission rate string — strips % and returns a float, or null if invalid */
function parseCommissionRate(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/%/g, "").trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}
