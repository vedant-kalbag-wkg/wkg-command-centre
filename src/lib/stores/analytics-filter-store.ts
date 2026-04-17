import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { toLocalISODate } from "@/lib/analytics/formatters";
import type { DatePreset, AnalyticsFilters } from "@/lib/analytics/types";

// ─── Types ────────────────────────────────────────────────────────────────────

type FilterDimensionKey =
  | "hotelFilter"
  | "regionFilter"
  | "productFilter"
  | "hotelGroupFilter"
  | "locationGroupFilter";

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

  setDateRange: (range: FilterDateRange) => void;
  applyPreset: (preset: DatePreset) => void;
  setFilter: (dimension: FilterDimensionKey, values: string[]) => void;
  resetDimensionFilters: () => void;
  clearAllFilters: () => void;
};

// ─── Store Factory ────────────────────────────────────────────────────────────

function createFullFilterStore() {
  return create<FilterState>((set) => ({
    dateRange: getCurrentMonthRange(),
    hotelFilter: [],
    regionFilter: [],
    productFilter: [],
    hotelGroupFilter: [],
    locationGroupFilter: [],

    setDateRange: (range) => set({ dateRange: range }),
    applyPreset: (preset) => set({ dateRange: getPresetRange(preset) }),
    setFilter: (dimension, values) => set({ [dimension]: values }),
    resetDimensionFilters: () =>
      set({
        hotelFilter: [],
        regionFilter: [],
        productFilter: [],
        hotelGroupFilter: [],
        locationGroupFilter: [],
      }),
    clearAllFilters: () =>
      set({
        dateRange: getCurrentMonthRange(),
        hotelFilter: [],
        regionFilter: [],
        productFilter: [],
        hotelGroupFilter: [],
        locationGroupFilter: [],
      }),
  }));
}

// ─── Stores ───────────────────────────────────────────────────────────────────

export const useAnalyticsFilterStore = createFullFilterStore();
export const usePivotFilterStore = createFullFilterStore();

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

  return params;
}

export function searchParamsToFilters(params: URLSearchParams): Partial<Pick<FilterState, "dateRange" | "hotelFilter" | "regionFilter" | "productFilter" | "hotelGroupFilter" | "locationGroupFilter">> | null {
  const hasFilterParams =
    params.has("from") || params.has("hotels") || params.has("regions") ||
    params.has("products") || params.has("hgroups") || params.has("lgroups");
  if (!hasFilterParams) return null;

  const result: Record<string, unknown> = {};

  const from = params.get("from");
  const to = params.get("to");
  if (from && to) {
    result.dateRange = { from: new Date(from), to: new Date(to) };
  }

  const hotels = params.get("hotels");
  if (hotels) result.hotelFilter = hotels.split(",");

  const regions = params.get("regions");
  if (regions) result.regionFilter = regions.split(",");

  const products = params.get("products");
  if (products) result.productFilter = products.split(",");

  const hgroups = params.get("hgroups");
  if (hgroups) result.hotelGroupFilter = hgroups.split(",");

  const lgroups = params.get("lgroups");
  if (lgroups) result.locationGroupFilter = lgroups.split(",");

  return result as ReturnType<typeof searchParamsToFilters>;
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
  };
}

export function useAnalyticsFilters(): AnalyticsFilters {
  return useAnalyticsFilterStore(
    useShallow((state) => storeStateToAnalyticsFilters(state)),
  );
}

export function usePivotFilters(): AnalyticsFilters {
  return usePivotFilterStore(
    useShallow((state) => storeStateToAnalyticsFilters(state)),
  );
}
