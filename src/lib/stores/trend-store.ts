import { create } from "zustand";
import type {
  TrendMetric,
  SeriesConfig,
  SeriesFilters,
  TrendGranularity,
} from "@/lib/analytics/types";

// ─── Constants ───────────────────────────────────────────────────────────────

export const CHART_COLORS: string[] = [
  "#00A6D3",
  "#121212",
  "#4BC8E8",
  "#006080",
  "#80D3E9",
  "#333333",
  "#B3E5F2",
  "#666666",
];

export const EVENT_CATEGORIES = [
  { name: "Promotion", color: "#00A6D3" },
  { name: "Holiday", color: "#4BC8E8" },
  { name: "Operational Change", color: "#121212" },
  { name: "Market Event", color: "#006080" },
] as const;

const MAX_SERIES = 6;

const METRIC_DISPLAY_NAMES: Record<TrendMetric, string> = {
  revenue: "Revenue",
  transactions: "Transactions",
  avg_basket_value: "Avg Basket Value",
  booking_fee: "Booking Fee",
};

// ─── Label Generator ─────────────────────────────────────────────────────────

export function generateSeriesLabel(
  metric: TrendMetric,
  filters: SeriesFilters,
): string {
  const metricName = METRIC_DISPLAY_NAMES[metric];
  const allValues: string[] = [
    ...(filters.productIds ?? []),
    ...(filters.locationIds ?? []),
    ...(filters.hotelGroupIds ?? []),
    ...(filters.regionIds ?? []),
    ...(filters.locationGroupIds ?? []),
  ];
  if (allValues.length === 0) return `${metricName} | All`;
  return `${metricName} | ${allValues.join(", ")}`;
}

// ─── Presets ─────────────────────────────────────────────────────────────────

type Preset = {
  name: string;
  series: Pick<SeriesConfig, "metric" | "filters">[];
};

const PRESETS: Preset[] = [
  {
    name: "Revenue vs Transactions",
    series: [
      { metric: "revenue", filters: {} },
      { metric: "transactions", filters: {} },
    ],
  },
  {
    name: "Category Comparison",
    series: [
      { metric: "revenue", filters: {} },
      { metric: "avg_basket_value", filters: {} },
      { metric: "booking_fee", filters: {} },
    ],
  },
];

export { PRESETS as TREND_PRESETS };

// ─── ID Generator ────────────────────────────────────────────────────────────

let nextId = 1;
function genId(): string {
  return `series-${nextId++}`;
}

// ─── Default Series ──────────────────────────────────────────────────────────

function makeDefaultSeries(): SeriesConfig {
  return {
    id: genId(),
    metric: "revenue",
    filters: {},
    color: CHART_COLORS[0],
    label: generateSeriesLabel("revenue", {}),
    hidden: false,
  };
}

// ─── Store Types ─────────────────────────────────────────────────────────────

type TrendState = {
  // Pending = edits in progress; Applied = active on chart
  pendingSeries: SeriesConfig[];
  appliedSeries: SeriesConfig[];
  granularity: TrendGranularity;
  showWeather: boolean;
  showEvents: boolean;
  showYoY: boolean;
  activeEventCategories: string[];

  // Actions — pending series editing
  addSeries: () => void;
  removeSeries: (id: string) => void;
  updateSeries: (id: string, patch: Partial<SeriesConfig>) => void;

  // Apply pending → applied
  applyChanges: () => void;

  // Toggle visibility of applied series (no re-fetch)
  toggleAppliedHidden: (id: string) => void;

  // Granularity
  setGranularity: (g: TrendGranularity) => void;

  // Overlays
  setShowWeather: (v: boolean) => void;
  setShowEvents: (v: boolean) => void;
  setShowYoY: (v: boolean) => void;
  toggleEventCategory: (name: string) => void;

  // Presets & saved views
  loadPreset: (presetIndex: number) => void;
  loadSavedView: (config: {
    series: SeriesConfig[];
    granularity: TrendGranularity;
    showWeather: boolean;
    showEvents: boolean;
    activeEventCategories: string[];
  }) => void;

  // Reset
  resetAll: () => void;
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useTrendStore = create<TrendState>((set, get) => {
  const initial = makeDefaultSeries();

  return {
    pendingSeries: [initial],
    appliedSeries: [initial],
    granularity: "auto",
    showWeather: false,
    showEvents: false,
    showYoY: false,
    activeEventCategories: EVENT_CATEGORIES.map((c) => c.name),

    addSeries: () =>
      set((state) => {
        if (state.pendingSeries.length >= MAX_SERIES) return state;
        const colorIndex = state.pendingSeries.length % CHART_COLORS.length;
        const newSeries: SeriesConfig = {
          id: genId(),
          metric: "revenue",
          filters: {},
          color: CHART_COLORS[colorIndex],
          label: generateSeriesLabel("revenue", {}),
          hidden: false,
        };
        return { pendingSeries: [...state.pendingSeries, newSeries] };
      }),

    removeSeries: (id) =>
      set((state) => ({
        pendingSeries: state.pendingSeries.filter((s) => s.id !== id),
      })),

    updateSeries: (id, patch) =>
      set((state) => ({
        pendingSeries: state.pendingSeries.map((s) => {
          if (s.id !== id) return s;
          const updated = { ...s, ...patch };
          // Auto-update label if metric or filters changed AND user hasn't manually edited
          if (
            !updated.labelEdited &&
            (patch.metric !== undefined || patch.filters !== undefined)
          ) {
            updated.label = generateSeriesLabel(
              updated.metric,
              updated.filters,
            );
          }
          return updated;
        }),
      })),

    applyChanges: () =>
      set((state) => ({
        appliedSeries: state.pendingSeries.map((s) => ({ ...s })),
      })),

    toggleAppliedHidden: (id) =>
      set((state) => ({
        appliedSeries: state.appliedSeries.map((s) =>
          s.id === id ? { ...s, hidden: !s.hidden } : s,
        ),
      })),

    setGranularity: (g) => set({ granularity: g }),

    setShowWeather: (v) => set({ showWeather: v }),
    setShowEvents: (v) => set({ showEvents: v }),
    setShowYoY: (v) => set({ showYoY: v }),
    toggleEventCategory: (name) =>
      set((state) => {
        const cats = state.activeEventCategories;
        const next = cats.includes(name)
          ? cats.filter((c) => c !== name)
          : [...cats, name];
        return { activeEventCategories: next };
      }),

    loadPreset: (presetIndex) => {
      const preset = PRESETS[presetIndex];
      if (!preset) return;
      const series: SeriesConfig[] = preset.series.map((s, i) => ({
        id: genId(),
        metric: s.metric,
        filters: s.filters,
        color: CHART_COLORS[i % CHART_COLORS.length],
        label: generateSeriesLabel(s.metric, s.filters),
        hidden: false,
      }));
      set({
        pendingSeries: series,
        appliedSeries: series.map((s) => ({ ...s })),
      });
    },

    loadSavedView: (config) =>
      set({
        pendingSeries: config.series.map((s) => ({ ...s })),
        appliedSeries: config.series.map((s) => ({ ...s })),
        granularity: config.granularity,
        showWeather: config.showWeather,
        showEvents: config.showEvents,
        activeEventCategories: [...config.activeEventCategories],
      }),

    resetAll: () => {
      const fresh = makeDefaultSeries();
      set({
        pendingSeries: [fresh],
        appliedSeries: [fresh],
        granularity: "auto",
        showWeather: false,
        showEvents: false,
        showYoY: false,
        activeEventCategories: EVENT_CATEGORIES.map((c) => c.name),
      });
    },
  };
});
