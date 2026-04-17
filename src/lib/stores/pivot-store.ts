import { create } from "zustand";
import type { PivotValueConfig } from "@/lib/analytics/types";

// ─── Available Fields ───────────────────────────────────────────────────────

export type FieldDefinition = {
  id: string;
  label: string;
  type: "dimension" | "metric";
};

export const AVAILABLE_FIELDS: readonly FieldDefinition[] = [
  { id: "product_name", label: "Product", type: "dimension" },
  { id: "outlet_code", label: "Outlet Code", type: "dimension" },
  { id: "hotel_name", label: "Hotel", type: "dimension" },
  { id: "hotel_group", label: "Hotel Group", type: "dimension" },
  { id: "region", label: "Region", type: "dimension" },
  { id: "location_group", label: "Location Group", type: "dimension" },
  { id: "sale_month", label: "Month", type: "dimension" },
  { id: "sale_year", label: "Year", type: "dimension" },
  { id: "sale_hour", label: "Hour", type: "dimension" },
  { id: "gross_amount", label: "Revenue", type: "metric" },
  { id: "quantity", label: "Quantity", type: "metric" },
  { id: "booking_fee", label: "Booking Fee", type: "metric" },
] as const;

export const DIMENSION_FIELDS = AVAILABLE_FIELDS.filter(
  (f) => f.type === "dimension",
);
export const METRIC_FIELDS = AVAILABLE_FIELDS.filter(
  (f) => f.type === "metric",
);

// ─── Store Types ────────────────────────────────────────────────────────────

type PivotStoreState = {
  rowFields: string[];
  columnFields: string[];
  values: PivotValueConfig[];
  periodComparison: "mom" | "yoy" | null;

  addRowField: (field: string) => void;
  removeRowField: (field: string) => void;
  addColumnField: (field: string) => void;
  removeColumnField: (field: string) => void;
  addValue: (config: PivotValueConfig) => void;
  removeValue: (index: number) => void;
  updateValueAggregation: (
    index: number,
    aggregation: PivotValueConfig["aggregation"],
  ) => void;
  setPeriodComparison: (mode: "mom" | "yoy" | null) => void;
  clearAll: () => void;
};

// ─── Store ──────────────────────────────────────────────────────────────────

export const usePivotStore = create<PivotStoreState>((set) => ({
  rowFields: [],
  columnFields: [],
  values: [],
  periodComparison: null,

  addRowField: (field) =>
    set((state) => {
      if (state.rowFields.includes(field)) return state;
      // Remove from columns if present
      const columnFields = state.columnFields.filter((f) => f !== field);
      return { rowFields: [...state.rowFields, field], columnFields };
    }),

  removeRowField: (field) =>
    set((state) => ({
      rowFields: state.rowFields.filter((f) => f !== field),
    })),

  addColumnField: (field) =>
    set((state) => {
      if (state.columnFields.includes(field)) return state;
      // Remove from rows if present
      const rowFields = state.rowFields.filter((f) => f !== field);
      return { columnFields: [...state.columnFields, field], rowFields };
    }),

  removeColumnField: (field) =>
    set((state) => ({
      columnFields: state.columnFields.filter((f) => f !== field),
    })),

  addValue: (config) =>
    set((state) => {
      // Prevent duplicate field+agg combos
      const exists = state.values.some(
        (v) => v.field === config.field && v.aggregation === config.aggregation,
      );
      if (exists) return state;
      return { values: [...state.values, config] };
    }),

  removeValue: (index) =>
    set((state) => ({
      values: state.values.filter((_, i) => i !== index),
    })),

  updateValueAggregation: (index, aggregation) =>
    set((state) => ({
      values: state.values.map((v, i) =>
        i === index ? { ...v, aggregation } : v,
      ),
    })),

  setPeriodComparison: (mode) => set({ periodComparison: mode }),

  clearAll: () =>
    set({
      rowFields: [],
      columnFields: [],
      values: [],
      periodComparison: null,
    }),
}));
