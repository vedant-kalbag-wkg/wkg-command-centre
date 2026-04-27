import { describe, it, expect, beforeEach } from "vitest";
import {
  useAnalyticsFilterStore,
  storeStateToAnalyticsFilters,
  getPresetRange,
} from "../analytics-filter-store";

// Regression test for Task 3.2 / PR-18b: Pivot Table previously read from a
// parallel `usePivotFilterStore` instance that the global AnalyticsFilterBar
// never wrote to. Both selectors must now reflect the same underlying state.

function resetStore() {
  useAnalyticsFilterStore.setState({
    dateRange: getPresetRange("ytd"),
    hotelFilter: [],
    regionFilter: [],
    productFilter: [],
    hotelGroupFilter: [],
    locationGroupFilter: [],
    maturityFilter: [],
    locationTypeFilter: [],
    metricMode: "sales",
    includeInternalAccounts: false,
  });
}

describe("usePivotFilters consolidation", () => {
  beforeEach(resetStore);

  it("reflects updates made through useAnalyticsFilterStore", () => {
    useAnalyticsFilterStore.getState().setFilter("regionFilter", ["uk"]);

    const filters = storeStateToAnalyticsFilters(useAnalyticsFilterStore.getState());
    expect(filters.regionIds).toEqual(["uk"]);
  });

  it("metricMode set on the global store is observable to pivot consumers", () => {
    useAnalyticsFilterStore.getState().setMetricMode("revenue");

    const filters = storeStateToAnalyticsFilters(useAnalyticsFilterStore.getState());
    expect(filters.metricMode).toBe("revenue");
  });

  it("does not export a separate usePivotFilterStore instance", async () => {
    const mod = await import("../analytics-filter-store");
    expect("usePivotFilterStore" in mod).toBe(false);
  });
});
