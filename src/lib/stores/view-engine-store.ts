import { create } from "zustand";
import type {
  ColumnFiltersState,
  ColumnSizingState,
  SortingState,
  VisibilityState,
  Updater,
} from "@tanstack/react-table";

// Resolve a TanStack Table Updater to its value
function resolveUpdater<T>(updater: Updater<T>, current: T): T {
  return typeof updater === "function"
    ? (updater as (old: T) => T)(current)
    : updater;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ViewConfig {
  columnFilters?: ColumnFiltersState;
  sorting?: SortingState;
  grouping?: string[];
  columnVisibility?: VisibilityState;
  columnSizing?: ColumnSizingState;
  columnOrder?: string[];
  // Gantt-specific
  ganttGroupBy?: "region" | "status";
  ganttZoom?: "day" | "week" | "month";
  // Calendar-specific
  calendarView?: "month" | "week" | "day";
  calendarFilters?: { region?: string; status?: string; hotelGroup?: string };
}

interface ViewEngineState {
  entityType: string;
  columnFilters: ColumnFiltersState;
  sorting: SortingState;
  grouping: string[];
  columnVisibility: VisibilityState;
  columnSizing: ColumnSizingState;
  columnOrder: string[];
  globalFilter: string;
  rowSelection: Record<string, boolean>;
  // Actions — accept TanStack Table Updater<T> pattern
  setColumnFilters: (updater: Updater<ColumnFiltersState>) => void;
  setSorting: (updater: Updater<SortingState>) => void;
  setGrouping: (updater: Updater<string[]>) => void;
  setColumnVisibility: (updater: Updater<VisibilityState>) => void;
  setColumnSizing: (updater: Updater<ColumnSizingState>) => void;
  setColumnOrder: (updater: Updater<string[]>) => void;
  setGlobalFilter: (filter: string) => void;
  setRowSelection: (updater: Updater<Record<string, boolean>>) => void;
  applyView: (config: ViewConfig) => void;
  resetToDefaults: () => void;
  getCurrentConfig: () => ViewConfig;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createViewEngineStore(entityType: string) {
  const defaultState = {
    entityType,
    columnFilters: [] as ColumnFiltersState,
    sorting: [{ id: "createdAt", desc: true }] as SortingState,
    grouping: [] as string[],
    columnVisibility: {} as VisibilityState,
    columnSizing: {} as ColumnSizingState,
    columnOrder: [] as string[],
    globalFilter: "",
    rowSelection: {} as Record<string, boolean>,
  };

  return create<ViewEngineState>((set, get) => ({
    ...defaultState,

    setColumnFilters: (updater) =>
      set((state) => ({ columnFilters: resolveUpdater(updater, state.columnFilters) })),
    setSorting: (updater) =>
      set((state) => ({ sorting: resolveUpdater(updater, state.sorting) })),
    setGrouping: (updater) =>
      set((state) => ({ grouping: resolveUpdater(updater, state.grouping) })),
    setColumnVisibility: (updater) =>
      set((state) => ({ columnVisibility: resolveUpdater(updater, state.columnVisibility) })),
    setColumnSizing: (updater) =>
      set((state) => ({ columnSizing: resolveUpdater(updater, state.columnSizing) })),
    setColumnOrder: (updater) =>
      set((state) => ({ columnOrder: resolveUpdater(updater, state.columnOrder) })),
    setGlobalFilter: (globalFilter) => set({ globalFilter }),
    setRowSelection: (updater) =>
      set((state) => ({ rowSelection: resolveUpdater(updater, state.rowSelection) })),

    applyView: (config) => {
      set({
        ...(config.columnFilters !== undefined && { columnFilters: config.columnFilters }),
        ...(config.sorting !== undefined && { sorting: config.sorting }),
        ...(config.grouping !== undefined && { grouping: config.grouping }),
        ...(config.columnVisibility !== undefined && { columnVisibility: config.columnVisibility }),
        ...(config.columnSizing !== undefined && { columnSizing: config.columnSizing }),
        ...(config.columnOrder !== undefined && { columnOrder: config.columnOrder }),
        // Reset row selection when applying a view
        rowSelection: {},
      });
    },

    resetToDefaults: () => {
      set({
        columnFilters: [],
        sorting: [{ id: "createdAt", desc: true }],
        grouping: [],
        columnVisibility: {},
        columnSizing: {},
        columnOrder: [],
        globalFilter: "",
        rowSelection: {},
      });
    },

    getCurrentConfig: () => {
      const state = get();
      return {
        columnFilters: state.columnFilters,
        sorting: state.sorting,
        grouping: state.grouping,
        columnVisibility: state.columnVisibility,
        columnSizing: state.columnSizing,
        columnOrder: state.columnOrder,
      };
    },
  }));
}

// ---------------------------------------------------------------------------
// Pre-created store instances (one per entity type — prevents state bleed)
// ---------------------------------------------------------------------------

export const useKioskViewStore = createViewEngineStore("kiosk");
export const useLocationViewStore = createViewEngineStore("location");
export const useGanttViewStore = createViewEngineStore("installation-gantt");
export const useCalendarViewStore = createViewEngineStore("installation-calendar");
