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

  return create<ViewEngineState>((set, get) => {
    // TanStack Table calls these setters during render while reconciling its
    // internal state with the controlled zustand state. Zustand notifies
    // subscribers synchronously, which can trigger "setState on a component
    // that hasn't mounted yet" warnings in React 19 / Next 16 when another
    // subscriber is still mid-mount. Defer the update to the next microtask
    // so the current render completes first.
    const deferredSet: typeof set = ((...args: Parameters<typeof set>) => {
      queueMicrotask(() => {
        set(...args);
      });
    }) as typeof set;

    return {
      ...defaultState,

      setColumnFilters: (updater) =>
        deferredSet((state) => ({ columnFilters: resolveUpdater(updater, state.columnFilters) })),
      setSorting: (updater) =>
        deferredSet((state) => ({ sorting: resolveUpdater(updater, state.sorting) })),
      setGrouping: (updater) =>
        deferredSet((state) => ({ grouping: resolveUpdater(updater, state.grouping) })),
      setColumnVisibility: (updater) =>
        deferredSet((state) => ({ columnVisibility: resolveUpdater(updater, state.columnVisibility) })),
      setColumnSizing: (updater) =>
        deferredSet((state) => ({ columnSizing: resolveUpdater(updater, state.columnSizing) })),
      setColumnOrder: (updater) =>
        deferredSet((state) => ({ columnOrder: resolveUpdater(updater, state.columnOrder) })),
      setGlobalFilter: (globalFilter) => deferredSet({ globalFilter }),
      setRowSelection: (updater) =>
        deferredSet((state) => ({ rowSelection: resolveUpdater(updater, state.rowSelection) })),

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
    };
  });
}

// ---------------------------------------------------------------------------
// Pre-created store instances (one per entity type — prevents state bleed)
// ---------------------------------------------------------------------------

export const useKioskViewStore = createViewEngineStore("kiosk");
export const useLocationViewStore = createViewEngineStore("location");
export const useGanttViewStore = createViewEngineStore("installation-gantt");
export const useCalendarViewStore = createViewEngineStore("installation-calendar");
