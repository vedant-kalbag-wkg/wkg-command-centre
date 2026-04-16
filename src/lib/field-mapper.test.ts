import { describe, it, expect } from "vitest";
import {
  mapMondayItemToKiosk,
  mapMondayItemToLocation,
  normaliseLocationName,
  detectMergeConflicts,
  type FieldMapping,
  type MergeConflict,
} from "./field-mapper";
import type { MondayItem } from "./monday-client";

// =============================================================================
// Test helpers
// =============================================================================

function makeItem(overrides: Partial<MondayItem> = {}): MondayItem {
  return {
    id: "item-1",
    name: "Test Hotel",
    group: { id: "group-1", title: "Monday Group Name" },
    column_values: [],
    subitems: [],
    ...overrides,
  };
}

function makeMapping(
  mondayColumnId: string,
  mondayTitle: string,
  targetTable: "kiosk" | "location" | null,
  targetField: string | null,
  status: "mapped" | "unmapped" = "mapped"
): FieldMapping {
  return {
    mondayColumnId,
    mondayTitle,
    mondayType: "text",
    targetTable,
    targetField,
    status,
  };
}

const noStages = new Map<string, string>();

// =============================================================================
// MIGR-05: Assets column maps to kiosk.hardwareSerialNumber
// =============================================================================

describe("MIGR-05: Assets column maps to kiosk.hardwareSerialNumber", () => {
  it("returns hardwareSerialNumber on kioskData when Assets column is present", () => {
    const item = makeItem({
      column_values: [
        { id: "assets_col", type: "text", text: "SN-12345", value: "SN-12345" },
      ],
    });

    const mappings: FieldMapping[] = [
      makeMapping("assets_col", "Assets", "kiosk", "hardwareSerialNumber"),
    ];

    const { kioskData } = mapMondayItemToKiosk(item, mappings, noStages);

    expect(kioskData.hardwareSerialNumber).toBe("SN-12345");
  });

  it("does NOT include Assets value in unmappedValues (location fields excluded from notes)", () => {
    const item = makeItem({
      column_values: [
        { id: "assets_col", type: "text", text: "SN-12345", value: "SN-12345" },
      ],
    });

    const mappings: FieldMapping[] = [
      makeMapping("assets_col", "Assets", "kiosk", "hardwareSerialNumber"),
    ];

    const { unmappedValues } = mapMondayItemToKiosk(item, mappings, noStages);

    expect(unmappedValues).not.toHaveProperty("assets_col");
  });
});

// =============================================================================
// MIGR-04: KioskId derives from Region column value + outlet code
// =============================================================================

describe("MIGR-04: KioskId derived from Region column value + outlet code", () => {
  it("derives kioskId as Region-OutletCode when both are mapped", () => {
    const item = makeItem({
      name: "Some Hotel",
      group: { id: "grp", title: "Monday Group Title (should be ignored)" },
      column_values: [
        { id: "region_col", type: "text", text: "London", value: "London" },
        { id: "outlet_col", type: "text", text: "ABC123", value: "ABC123" },
      ],
    });

    const mappings: FieldMapping[] = [
      makeMapping("region_col", "Region", "kiosk", "regionGroup"),
      makeMapping("outlet_col", "Outlet Code", "kiosk", "outletCode"),
    ];

    const { kioskData } = mapMondayItemToKiosk(item, mappings, noStages);

    expect(kioskData.kioskId).toBe("London-ABC123");
  });

  it("does NOT use item.group.title for region — uses column value instead", () => {
    const item = makeItem({
      group: { id: "grp", title: "WRONG_GROUP_TITLE" },
      column_values: [
        { id: "region_col", type: "text", text: "London", value: "London" },
        { id: "outlet_col", type: "text", text: "ABC123", value: "ABC123" },
      ],
    });

    const mappings: FieldMapping[] = [
      makeMapping("region_col", "Region", "kiosk", "regionGroup"),
      makeMapping("outlet_col", "Outlet Code", "kiosk", "outletCode"),
    ];

    const { kioskData } = mapMondayItemToKiosk(item, mappings, noStages);

    expect(kioskData.kioskId).not.toContain("WRONG_GROUP_TITLE");
    expect(kioskData.kioskId).toBe("London-ABC123");
  });

  it("falls back to item.name when no outlet code is mapped", () => {
    const item = makeItem({ name: "Fallback Hotel" });
    const { kioskData } = mapMondayItemToKiosk(item, [], noStages);
    expect(kioskData.kioskId).toBe("Fallback Hotel");
  });
});

// =============================================================================
// MIGR-07: Kiosk notes do NOT contain location-targeted columns
// =============================================================================

describe("MIGR-07: Location-targeted columns are NOT dumped into kiosk notes", () => {
  it("excludes location-mapped columns (Hotel Address, Star Rating) from unmappedValues", () => {
    const item = makeItem({
      column_values: [
        { id: "addr_col", type: "text", text: "123 Main St", value: "123 Main St" },
        { id: "star_col", type: "text", text: "5", value: "5" },
        { id: "truly_unmapped", type: "text", text: "random data", value: "random data" },
      ],
    });

    const mappings: FieldMapping[] = [
      makeMapping("addr_col", "Hotel Address", "location", "address"),
      makeMapping("star_col", "Hotel Star Rating", "location", "starRating"),
      // truly_unmapped has no mapping entry — this is fine, no entry needed
    ];

    const { unmappedValues } = mapMondayItemToKiosk(item, mappings, noStages);

    // Location-mapped columns must NOT appear in kiosk notes
    expect(unmappedValues).not.toHaveProperty("addr_col");
    expect(unmappedValues).not.toHaveProperty("star_col");
    // Truly unmapped columns MUST appear
    expect(unmappedValues).toHaveProperty("truly_unmapped", "random data");
  });
});

// =============================================================================
// MIGR-08: Key Contact Name maps to location.internalPoc
// =============================================================================

describe("MIGR-08: Key Contact Name maps to location.internalPoc", () => {
  it("returns internalPocName when Key Contact Name is mapped", () => {
    const item = makeItem({
      column_values: [
        { id: "kc_col", type: "text", text: "Jane Smith", value: "Jane Smith" },
      ],
    });

    const mappings: FieldMapping[] = [
      makeMapping("kc_col", "Key Contact Name", "location", "internalPoc"),
    ];

    const { internalPocName } = mapMondayItemToLocation(item, mappings);

    expect(internalPocName).toBe("Jane Smith");
  });

  it("does NOT write to keyContactName field", () => {
    const item = makeItem({
      column_values: [
        { id: "kc_col", type: "text", text: "Jane Smith", value: "Jane Smith" },
      ],
    });

    const mappings: FieldMapping[] = [
      makeMapping("kc_col", "Key Contact Name", "location", "internalPoc"),
    ];

    const { locationData } = mapMondayItemToLocation(item, mappings);

    expect((locationData as Record<string, unknown>).keyContactName).toBeUndefined();
  });
});

// =============================================================================
// MIGR-06: CMS Config imported as the label string (not raw JSON)
// =============================================================================

describe("MIGR-06: CMS Config imported as human-readable status label", () => {
  it("returns the label string for CMS Config status column", () => {
    const item = makeItem({
      column_values: [
        {
          id: "cms_col",
          type: "status",
          text: "Configured",
          value: '{"index":1,"post_id":null,"changed_at":"..."}',
          label: "Configured",
        },
      ],
    });

    const mappings: FieldMapping[] = [
      makeMapping("cms_col", "CMS Config", "kiosk", "cmsConfigStatus"),
    ];

    const { kioskData } = mapMondayItemToKiosk(item, mappings, noStages);

    // Should be the human-readable label, not raw JSON
    expect(kioskData.cmsConfigStatus).toBe("Configured");
    expect(kioskData.cmsConfigStatus).not.toContain("{");
  });
});

// =============================================================================
// MIGR-09: normaliseLocationName strips outlet code suffixes
// =============================================================================

describe("MIGR-09: normaliseLocationName strips outlet code suffix", () => {
  it("strips [outlet_code] suffix from hotel name", () => {
    expect(normaliseLocationName("Grand Hotel [ABC123]")).toBe("Grand Hotel");
  });

  it("returns unchanged name when no outlet code suffix present", () => {
    expect(normaliseLocationName("Grand Hotel")).toBe("Grand Hotel");
  });

  it("strips suffix with space before bracket", () => {
    expect(normaliseLocationName("Marriott London [UK-001]")).toBe("Marriott London");
  });

  it("handles empty string gracefully", () => {
    expect(normaliseLocationName("")).toBe("");
  });

  it("does not strip brackets that are not at the end", () => {
    expect(normaliseLocationName("The [Big] Hotel")).toBe("The [Big] Hotel");
  });
});

// =============================================================================
// D-10: detectMergeConflicts — field-level conflict detection
// =============================================================================

describe("D-10: detectMergeConflicts", () => {
  it("returns conflicts when two rows for the same location have different address values", () => {
    const locationGroups = new Map<string, Array<Record<string, unknown>>>([
      [
        "Grand Hotel",
        [
          { address: "123 Main St", starRating: "5" },
          { address: "456 Other Ave", starRating: "5" },
        ],
      ],
    ]);

    const conflicts: MergeConflict[] = detectMergeConflicts(locationGroups);

    expect(conflicts.length).toBe(1);
    expect(conflicts[0].locationName).toBe("Grand Hotel");
    expect(conflicts[0].field).toBe("address");
    expect(conflicts[0].values).toContain("123 Main St");
    expect(conflicts[0].values).toContain("456 Other Ave");
  });

  it("returns empty array when merged rows have identical field values", () => {
    const locationGroups = new Map<string, Array<Record<string, unknown>>>([
      [
        "Grand Hotel",
        [
          { address: "123 Main St", starRating: "5" },
          { address: "123 Main St", starRating: "5" },
        ],
      ],
    ]);

    const conflicts: MergeConflict[] = detectMergeConflicts(locationGroups);

    expect(conflicts).toHaveLength(0);
  });

  it("returns empty array for a single row (no merge possible)", () => {
    const locationGroups = new Map<string, Array<Record<string, unknown>>>([
      ["Solo Hotel", [{ address: "99 Lone St" }]],
    ]);

    const conflicts: MergeConflict[] = detectMergeConflicts(locationGroups);

    expect(conflicts).toHaveLength(0);
  });

  it("skips the name field when detecting conflicts", () => {
    const locationGroups = new Map<string, Array<Record<string, unknown>>>([
      [
        "Grand Hotel",
        [
          { name: "Grand Hotel [ABC]", address: "Same St" },
          { name: "Grand Hotel [DEF]", address: "Same St" },
        ],
      ],
    ]);

    const conflicts: MergeConflict[] = detectMergeConflicts(locationGroups);

    // name differences should not be reported
    const nameConflicts = conflicts.filter((c) => c.field === "name");
    expect(nameConflicts).toHaveLength(0);
  });
});
