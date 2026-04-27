import { describe, expect, it } from "vitest";
import { parseUrlFilters, formatDroppedMessage } from "../url-filters";

const VALID_UUID_A = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_B = "22222222-2222-4222-8222-222222222222";

describe("parseUrlFilters", () => {
  it("returns empty filters and no drops when URL has no filter params", () => {
    const sp = new URLSearchParams();
    const result = parseUrlFilters(sp);
    expect(result.filters).toEqual({});
    expect(result.dropped).toEqual([]);
    expect(result.hasFilterParams).toBe(false);
  });

  it("keeps valid UUIDs and drops the bad ones in mixed lists", () => {
    const sp = new URLSearchParams();
    sp.set("hotels", `${VALID_UUID_A},not-a-uuid,${VALID_UUID_B}`);
    const result = parseUrlFilters(sp);
    expect(result.filters.hotelFilter).toEqual([VALID_UUID_A, VALID_UUID_B]);
    expect(result.dropped).toEqual([{ field: "hotels", values: ["not-a-uuid"] }]);
  });

  it("drops the whole hotel filter when every value is invalid", () => {
    const sp = new URLSearchParams();
    sp.set("hotels", "foo,bar");
    const result = parseUrlFilters(sp);
    expect(result.filters.hotelFilter).toBeUndefined();
    expect(result.dropped).toEqual([{ field: "hotels", values: ["foo", "bar"] }]);
  });

  it("validates the maturity bucket against the 5-bucket whitelist", () => {
    const sp = new URLSearchParams();
    sp.set("maturity", "0-1mo,12mo+,9+mo");
    const result = parseUrlFilters(sp);
    expect(result.filters.maturityFilter).toEqual(["0-1mo", "9+mo"]);
    expect(result.dropped).toEqual([{ field: "maturity", values: ["12mo+"] }]);
  });

  it("validates location types against the enum", () => {
    const sp = new URLSearchParams();
    sp.set("types", "hotel,banana,airport");
    const result = parseUrlFilters(sp);
    expect(result.filters.locationTypeFilter).toEqual(["hotel", "airport"]);
    expect(result.dropped).toEqual([{ field: "types", values: ["banana"] }]);
  });

  it("drops the metric mode when it's not in {sales,revenue}", () => {
    const sp = new URLSearchParams();
    sp.set("mode", "wat");
    const result = parseUrlFilters(sp);
    expect(result.filters.metricMode).toBeUndefined();
    expect(result.dropped).toEqual([{ field: "mode", values: ["wat"] }]);
  });

  // D9 / Task 4.6 — `internal=1` is the admin escape hatch that opts back
  // into seeing internal-type locations (e.g. BK 'Customer Service'). Only
  // the truthy strings map to true; everything else gets dropped silently.
  it("maps internal=1 to includeInternalAccounts: true", () => {
    const sp = new URLSearchParams();
    sp.set("internal", "1");
    const result = parseUrlFilters(sp);
    expect(result.filters.includeInternalAccounts).toBe(true);
    expect(result.dropped).toEqual([]);
  });

  it("maps internal=true to includeInternalAccounts: true", () => {
    const sp = new URLSearchParams();
    sp.set("internal", "true");
    const result = parseUrlFilters(sp);
    expect(result.filters.includeInternalAccounts).toBe(true);
  });

  it("drops invalid internal values silently (default-exclude wins)", () => {
    const sp = new URLSearchParams();
    sp.set("internal", "foo");
    const result = parseUrlFilters(sp);
    expect(result.filters.includeInternalAccounts).toBeUndefined();
    expect(result.dropped).toEqual([{ field: "internal", values: ["foo"] }]);
  });

  it("omits includeInternalAccounts when the param is absent", () => {
    const sp = new URLSearchParams();
    sp.set("from", "2026-01-01");
    sp.set("to", "2026-03-31");
    const result = parseUrlFilters(sp);
    expect(result.filters.includeInternalAccounts).toBeUndefined();
  });

  it("accepts both valid date endpoints", () => {
    const sp = new URLSearchParams();
    sp.set("from", "2026-01-01");
    sp.set("to", "2026-03-31");
    const result = parseUrlFilters(sp);
    expect(result.filters.dateRange).toEqual({
      from: new Date("2026-01-01"),
      to: new Date("2026-03-31"),
    });
    expect(result.dropped).toEqual([]);
  });

  it("drops the date range when one endpoint is unparseable", () => {
    const sp = new URLSearchParams();
    sp.set("from", "not-a-date");
    sp.set("to", "2026-03-31");
    const result = parseUrlFilters(sp);
    expect(result.filters.dateRange).toBeUndefined();
    expect(result.dropped[0]?.field).toBe("dateRange");
  });

  it("collects drops from many filters in one pass", () => {
    const sp = new URLSearchParams();
    sp.set("hotels", `${VALID_UUID_A},bad-uuid`);
    sp.set("maturity", "12mo+,3-6mo");
    sp.set("types", "banana");
    const result = parseUrlFilters(sp);
    expect(result.filters.hotelFilter).toEqual([VALID_UUID_A]);
    expect(result.filters.maturityFilter).toEqual(["3-6mo"]);
    expect(result.filters.locationTypeFilter).toBeUndefined();
    expect(result.dropped).toHaveLength(3);
    const fields = result.dropped.map((d) => d.field).sort();
    expect(fields).toEqual(["hotels", "maturity", "types"]);
  });

  it("hasFilterParams is true even when all values get dropped", () => {
    const sp = new URLSearchParams();
    sp.set("hotels", "not-a-uuid");
    const result = parseUrlFilters(sp);
    expect(result.hasFilterParams).toBe(true);
  });
});

describe("formatDroppedMessage", () => {
  it("returns null when nothing was dropped", () => {
    expect(formatDroppedMessage([])).toBeNull();
  });

  it("formats a single-field drop", () => {
    expect(
      formatDroppedMessage([{ field: "hotels", values: ["xxx"] }]),
    ).toBe("Some filter values were ignored — hotels: xxx");
  });

  it("truncates long lists with a +N more suffix", () => {
    const values = ["a", "b", "c", "d", "e"];
    expect(
      formatDroppedMessage([{ field: "hotels", values }]),
    ).toBe("Some filter values were ignored — hotels: a, b, c +2 more");
  });
});
