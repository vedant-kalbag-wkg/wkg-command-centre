import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { toLocalISODate } from "@/lib/analytics/formatters";
import type {
  DatePreset,
  AnalyticsFilters,
  LocationType,
  MetricMode,
} from "@/lib/analytics/types";
import { parseUrlFilters, type DroppedParam } from "@/lib/analytics/url-filters";

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterDimensionKey =
  | "hotelFilter"
  | "regionFilter"
  | "productFilter"
  | "hotelGroupFilter"
  | "locationGroupFilter"
  | "maturityFilter"
  | "locationTypeFilter";

type FilterDateRange = {
  from: Date;
  to: Date;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCurrentMonthRange(): FilterDateRange {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from, to };
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function getPresetRange(preset: DatePreset): FilterDateRange {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (preset) {
    case "this-month": {
      const from = new Date(year, month, 1);
      const to = new Date(year, month + 1, 0);
      return { from: startOfDay(from), to: endOfDay(to) };
    }
    case "last-month": {
      const from = new Date(year, month - 1, 1);
      const to = new Date(year, month, 0);
      return { from: startOfDay(from), to: endOfDay(to) };
    }
    case "last-3-months": {
      const to = endOfDay(now);
      const from = new Date(now);
      from.setDate(from.getDate() - 89);
      return { from: startOfDay(from), to };
    }
    case "this-quarter": {
      const quarterStart = Math.floor(month / 3) * 3;
      const from = new Date(year, quarterStart, 1);
      const to = new Date(year, quarterStart + 3, 0);
      return { from: startOfDay(from), to: endOfDay(to) };
    }
    case "last-quarter": {
      const quarterStart = Math.floor(month / 3) * 3;
      const prevQuarterStart = quarterStart - 3;
      const from = new Date(year, prevQuarterStart, 1);
      const to = new Date(year, prevQuarterStart + 3, 0);
      return { from: startOfDay(from), to: endOfDay(to) };
    }
    case "ytd": {
      const from = new Date(year, 0, 1);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case "last-year": {
      const from = new Date(year - 1, 0, 1);
      const to = new Date(year - 1, 11, 31);
      return { from: startOfDay(from), to: endOfDay(to) };
    }
  }
}

// ─── Store Types ──────────────────────────────────────────────────────────────

type FilterState = {
  dateRange: FilterDateRange;
  hotelFilter: string[];
  regionFilter: string[];
  productFilter: string[];
  hotelGroupFilter: string[];
  locationGroupFilter: string[];
  maturityFilter: string[];
  locationTypeFilter: string[];
  metricMode: MetricMode;
  // D9 / Task 4.6 — admin escape hatch. Default false → internal-type
  // locations (BK refund-handling) are excluded from leaderboards.
  includeInternalAccounts: boolean;

  setDateRange: (range: FilterDateRange) => void;
  applyPreset: (preset: DatePreset) => void;
  setFilter: (dimension: FilterDimensionKey, values: string[]) => void;
  setMetricMode: (mode: MetricMode) => void;
  setIncludeInternalAccounts: (v: boolean) => void;
  resetDimensionFilters: () => void;
  clearAllFilters: () => void;
};

// ─── Store Factory ────────────────────────────────────────────────────────────

function createFullFilterStore() {
  return create<FilterState>((set) => ({
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

    setDateRange: (range) => set({ dateRange: range }),
    applyPreset: (preset) => set({ dateRange: getPresetRange(preset) }),
    setFilter: (dimension, values) => set({ [dimension]: values }),
    setMetricMode: (mode) => set({ metricMode: mode }),
    setIncludeInternalAccounts: (v) => set({ includeInternalAccounts: v }),
    resetDimensionFilters: () =>
      set({
        hotelFilter: [],
        regionFilter: [],
        productFilter: [],
        hotelGroupFilter: [],
        locationGroupFilter: [],
        maturityFilter: [],
        locationTypeFilter: [],
      }),
    clearAllFilters: () =>
      set({
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
      }),
  }));
}

// ─── Stores ───────────────────────────────────────────────────────────────────

export const useAnalyticsFilterStore = createFullFilterStore();

// ─── URL Sync Utilities ──────────────────────────────────────────────────────

export function filtersToSearchParams(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("from", toLocalISODate(state.dateRange.from));
  params.set("to", toLocalISODate(state.dateRange.to));

  if (state.hotelFilter.length > 0) params.set("hotels", state.hotelFilter.join(","));
  if (state.regionFilter.length > 0) params.set("regions", state.regionFilter.join(","));
  if (state.productFilter.length > 0) params.set("products", state.productFilter.join(","));
  if (state.hotelGroupFilter.length > 0) params.set("hgroups", state.hotelGroupFilter.join(","));
  if (state.locationGroupFilter.length > 0) params.set("lgroups", state.locationGroupFilter.join(","));
  if (state.maturityFilter.length > 0) params.set("maturity", state.maturityFilter.join(","));
  if (state.locationTypeFilter.length > 0) params.set("types", state.locationTypeFilter.join(","));
  // Only serialize when non-default so URLs stay clean for the common case.
  if (state.metricMode === "revenue") params.set("mode", "revenue");
  if (state.includeInternalAccounts) params.set("internal", "1");

  return params;
}

export type SearchParamsToFiltersResult = {
  state: Partial<
    Pick<
      FilterState,
      | "dateRange"
      | "hotelFilter"
      | "regionFilter"
      | "productFilter"
      | "hotelGroupFilter"
      | "locationGroupFilter"
      | "maturityFilter"
      | "locationTypeFilter"
      | "metricMode"
      | "includeInternalAccounts"
    >
  >;
  dropped: DroppedParam[];
};

// Boundary parser for the FilterBar URL hydration. Delegates value-level
// validation to parseUrlFilters (Zod) and adapts the result to the store
// shape — `maturityFilter`/`locationTypeFilter` widen to string[] because
// the store keys are typed as such; the schema has already proved each
// element belongs to its enum so the cast is sound.
export function searchParamsToFilters(
  params: URLSearchParams,
): SearchParamsToFiltersResult | null {
  const { filters, dropped, hasFilterParams } = parseUrlFilters(params);
  if (!hasFilterParams) return null;

  const state: SearchParamsToFiltersResult["state"] = {};
  if (filters.dateRange) state.dateRange = filters.dateRange;
  if (filters.hotelFilter) state.hotelFilter = filters.hotelFilter;
  if (filters.regionFilter) state.regionFilter = filters.regionFilter;
  if (filters.productFilter) state.productFilter = filters.productFilter;
  if (filters.hotelGroupFilter) state.hotelGroupFilter = filters.hotelGroupFilter;
  if (filters.locationGroupFilter) state.locationGroupFilter = filters.locationGroupFilter;
  if (filters.maturityFilter) state.maturityFilter = filters.maturityFilter as string[];
  if (filters.locationTypeFilter) state.locationTypeFilter = filters.locationTypeFilter as string[];
  if (filters.metricMode) state.metricMode = filters.metricMode;
  if (filters.includeInternalAccounts) state.includeInternalAccounts = filters.includeInternalAccounts;

  return { state, dropped };
}

export function storeStateToAnalyticsFilters(state: FilterState): AnalyticsFilters {
  return {
    dateFrom: toLocalISODate(state.dateRange.from),
    dateTo: toLocalISODate(state.dateRange.to),
    hotelIds: state.hotelFilter.length > 0 ? state.hotelFilter : undefined,
    regionIds: state.regionFilter.length > 0 ? state.regionFilter : undefined,
    productIds: state.productFilter.length > 0 ? state.productFilter : undefined,
    hotelGroupIds: state.hotelGroupFilter.length > 0 ? state.hotelGroupFilter : undefined,
    locationGroupIds: state.locationGroupFilter.length > 0 ? state.locationGroupFilter : undefined,
    maturityBuckets: state.maturityFilter.length > 0 ? state.maturityFilter : undefined,
    locationTypes:
      state.locationTypeFilter.length > 0
        ? (state.locationTypeFilter as LocationType[])
        : undefined,
    // D9 — only set when true; undefined applies the default-exclude.
    includeInternalAccounts: state.includeInternalAccounts ? true : undefined,
    metricMode: state.metricMode,
  };
}

export function useAnalyticsFilters(): AnalyticsFilters {
  return useAnalyticsFilterStore(
    useShallow((state) => storeStateToAnalyticsFilters(state)),
  );
}

// Alias kept so pivot-table callers don't need to rename; reads the same
// global store the AnalyticsFilterBar writes to.
export function usePivotFilters(): AnalyticsFilters {
  return useAnalyticsFilterStore(
    useShallow((state) => storeStateToAnalyticsFilters(state)),
  );
}
