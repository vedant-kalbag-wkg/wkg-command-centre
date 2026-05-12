import { describe, it, expect } from "vitest";

import type { MondayItem } from "@/lib/monday/client";
import {
  extractLocationValue,
  extractDropdownLabels,
  extractMondayStatusLabel,
  extractMondayDate,
  extractMondayNumber,
  extractMondayRating,
  extractLinkedItemId,
  extractMondayText,
} from "@/lib/monday/extractors";

/**
 * Unit tests for the Monday → locations field extractors. Fixtures are real
 * column shapes captured from the Live Estate board (1356570756) and the
 * Heathrow Express SSMs board (1356657751) via
 * `scripts/inspect-monday-board.ts`. Each extractor is pure (no I/O, no DB).
 */

function makeItem(column_values: MondayItem["column_values"]): MondayItem {
  return { id: "1432325425", name: "Marriott London Heathrow Hotel", column_values };
}

describe("extractLocationValue", () => {
  it("returns address text plus lat/lng when LocationValue has all three", () => {
    const item = makeItem([
      {
        id: "location",
        type: "location",
        text: "London Heathrow Marriott Hotel, Airport, Harlington, Hayes, UK",
        // lat/lng come from the LocationValue inline fragment — they are not
        // declared on the base MondayColumnValue type but ride alongside it.
        lat: 51.477,
        lng: -0.451,
      } as MondayItem["column_values"][number] & { lat: number; lng: number },
    ]);
    expect(extractLocationValue(item)).toEqual({
      address: "London Heathrow Marriott Hotel, Airport, Harlington, Hayes, UK",
      latitude: 51.477,
      longitude: -0.451,
    });
  });

  it("returns nulls when the column is absent", () => {
    expect(extractLocationValue(makeItem([]))).toEqual({
      address: null,
      latitude: null,
      longitude: null,
    });
  });

  it("returns address but null lat/lng when fragment did not include coords", () => {
    const item = makeItem([
      { id: "location", type: "location", text: "Friar Street, Reading, UK" },
    ]);
    expect(extractLocationValue(item)).toEqual({
      address: "Friar Street, Reading, UK",
      latitude: null,
      longitude: null,
    });
  });

  it("treats whitespace-only text as null address", () => {
    const item = makeItem([{ id: "location", type: "location", text: "   " }]);
    expect(extractLocationValue(item).address).toBeNull();
  });
});

describe("extractDropdownLabels", () => {
  it("returns the single-label case as a one-element array", () => {
    const item = makeItem([
      { id: "group0", type: "dropdown", text: "Marriott Group" },
    ]);
    expect(extractDropdownLabels(item, "group0")).toEqual(["Marriott Group"]);
  });

  it("returns each comma-separated label, trimmed, for multi-label dropdowns", () => {
    // "Arora, Radisson Hotels" is the canonical multi-group case from prod.
    const item = makeItem([
      { id: "group0", type: "dropdown", text: "Arora, Radisson Hotels" },
    ]);
    expect(extractDropdownLabels(item, "group0")).toEqual([
      "Arora",
      "Radisson Hotels",
    ]);
  });

  it("returns an empty array when the column is absent or empty", () => {
    expect(extractDropdownLabels(makeItem([]), "group0")).toEqual([]);
    expect(
      extractDropdownLabels(
        makeItem([{ id: "group0", type: "dropdown", text: "" }]),
        "group0",
      ),
    ).toEqual([]);
  });
});

describe("extractMondayStatusLabel", () => {
  it("returns the label text for a populated status column", () => {
    const item = makeItem([
      { id: "status_17", type: "status", text: "Phase 0" },
    ]);
    expect(extractMondayStatusLabel(item, "status_17")).toBe("Phase 0");
  });

  it("returns null for unset status columns", () => {
    expect(extractMondayStatusLabel(makeItem([]), "status_17")).toBeNull();
  });
});

describe("extractMondayDate", () => {
  it("parses a date-only string into a UTC midnight Date", () => {
    const item = makeItem([{ id: "live_date", type: "date", text: "2023-08-31" }]);
    const d = extractMondayDate(item, "live_date");
    expect(d).not.toBeNull();
    expect(d!.toISOString().slice(0, 10)).toBe("2023-08-31");
  });

  it("parses a date-with-time string", () => {
    const item = makeItem([
      { id: "live_date", type: "date", text: "2023-08-31 15:06" },
    ]);
    const d = extractMondayDate(item, "live_date");
    expect(d).not.toBeNull();
    expect(d!.toISOString().startsWith("2023-08-31")).toBe(true);
  });

  it("returns null on empty / unparseable values", () => {
    expect(extractMondayDate(makeItem([]), "live_date")).toBeNull();
    expect(
      extractMondayDate(
        makeItem([{ id: "live_date", type: "date", text: "not-a-date" }]),
        "live_date",
      ),
    ).toBeNull();
  });
});

describe("extractMondayNumber", () => {
  it("parses a numeric text value", () => {
    const item = makeItem([
      { id: "number_of_rooms", type: "numbers", text: "393" },
    ]);
    expect(extractMondayNumber(item, "number_of_rooms")).toBe(393);
  });

  it("parses decimal numbers", () => {
    const item = makeItem([
      { id: "numeric", type: "numbers", text: "12.5" },
    ]);
    expect(extractMondayNumber(item, "numeric")).toBe(12.5);
  });

  it("returns null for empty or non-numeric text", () => {
    expect(extractMondayNumber(makeItem([]), "numeric")).toBeNull();
    expect(
      extractMondayNumber(
        makeItem([{ id: "numeric", type: "numbers", text: "" }]),
        "numeric",
      ),
    ).toBeNull();
    expect(
      extractMondayNumber(
        makeItem([{ id: "numeric", type: "numbers", text: "n/a" }]),
        "numeric",
      ),
    ).toBeNull();
  });
});

describe("extractMondayRating", () => {
  it("returns an integer 1-5 for a populated rating column", () => {
    const item = makeItem([{ id: "rating__1", type: "rating", text: "4" }]);
    expect(extractMondayRating(item, "rating__1")).toBe(4);
  });

  it("returns null when the rating is unset", () => {
    expect(extractMondayRating(makeItem([]), "rating__1")).toBeNull();
  });
});

describe("extractLinkedItemId", () => {
  it("returns the first linked item id from a board_relation column", () => {
    const item = makeItem([
      {
        id: "link_to_ssm_groups__1",
        type: "board_relation",
        text: "Heathrow Hilton",
        linked_item_ids: ["1234567890", "9876543210"],
      } as MondayItem["column_values"][number] & { linked_item_ids: string[] },
    ]);
    expect(extractLinkedItemId(item, "link_to_ssm_groups__1")).toBe(
      "1234567890",
    );
  });

  it("returns null when no items are linked", () => {
    expect(
      extractLinkedItemId(makeItem([]), "link_to_ssm_groups__1"),
    ).toBeNull();
    const empty = makeItem([
      {
        id: "link_to_ssm_groups__1",
        type: "board_relation",
        text: "",
        linked_item_ids: [],
      } as MondayItem["column_values"][number] & { linked_item_ids: string[] },
    ]);
    expect(extractLinkedItemId(empty, "link_to_ssm_groups__1")).toBeNull();
  });
});

describe("extractMondayText", () => {
  it("returns trimmed non-empty text", () => {
    const item = makeItem([
      { id: "key_contact_name", type: "text", text: "  Ron Vos  " },
    ]);
    expect(extractMondayText(item, "key_contact_name")).toBe("Ron Vos");
  });

  it("returns null for empty / whitespace-only / absent text", () => {
    expect(extractMondayText(makeItem([]), "key_contact_name")).toBeNull();
    expect(
      extractMondayText(
        makeItem([{ id: "key_contact_name", type: "text", text: "" }]),
        "key_contact_name",
      ),
    ).toBeNull();
    expect(
      extractMondayText(
        makeItem([{ id: "key_contact_name", type: "text", text: "   " }]),
        "key_contact_name",
      ),
    ).toBeNull();
  });
});
