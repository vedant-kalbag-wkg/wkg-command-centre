import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ScoreWeights } from "@/lib/analytics/types";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * UI-facing weights. Each value is an integer percent (0–100).
 * The five keys must sum to exactly 100 before the edit buffer (`pending`)
 * can be applied to the live `weights`.
 */
export interface HeatmapWeights {
  revenue: number;
  transactions: number;
  revenuePerRoom: number;
  txnPerKiosk: number;
  basketValue: number;
}

/** Default preset — matches the previous fixed weights (30/20/25/15/10). */
export const DEFAULT_WEIGHTS: HeatmapWeights = {
  revenue: 30,
  transactions: 20,
  revenuePerRoom: 25,
  txnPerKiosk: 15,
  basketValue: 10,
};

export const WEIGHT_KEYS: (keyof HeatmapWeights)[] = [
  "revenue",
  "transactions",
  "revenuePerRoom",
  "txnPerKiosk",
  "basketValue",
];

// ─── Store ────────────────────────────────────────────────────────────────────

interface HeatmapWeightsState {
  /** Currently-applied weights (consumed by the heat-map query). */
  weights: HeatmapWeights;
  /** Edit buffer — mutated as the user drags/types. */
  pending: HeatmapWeights;
  /** True when `pending` differs from `weights`. */
  isDirty: boolean;
  /** Update a single pending weight (integer percent 0–100). */
  setPending: (key: keyof HeatmapWeights, value: number) => void;
  /** Copy `pending` → `weights` iff sum(pending) === 100. Returns true on success. */
  apply: () => boolean;
  /** Restore both `weights` and `pending` to `DEFAULT_WEIGHTS`. */
  reset: () => void;
  /** Sum of the current pending weights. */
  sum: () => number;
}

function clampToPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value);
  if (rounded < 0) return 0;
  if (rounded > 100) return 100;
  return rounded;
}

function sumWeights(w: HeatmapWeights): number {
  return (
    w.revenue +
    w.transactions +
    w.revenuePerRoom +
    w.txnPerKiosk +
    w.basketValue
  );
}

function weightsEqual(a: HeatmapWeights, b: HeatmapWeights): boolean {
  return (
    a.revenue === b.revenue &&
    a.transactions === b.transactions &&
    a.revenuePerRoom === b.revenuePerRoom &&
    a.txnPerKiosk === b.txnPerKiosk &&
    a.basketValue === b.basketValue
  );
}

export const useHeatmapWeightsStore = create<HeatmapWeightsState>()(
  persist(
    (set, get) => ({
      weights: { ...DEFAULT_WEIGHTS },
      pending: { ...DEFAULT_WEIGHTS },
      isDirty: false,

      setPending: (key, value) => {
        const next = { ...get().pending, [key]: clampToPercent(value) };
        set({ pending: next, isDirty: !weightsEqual(next, get().weights) });
      },

      apply: () => {
        const { pending } = get();
        if (sumWeights(pending) !== 100) return false;
        set({ weights: { ...pending }, isDirty: false });
        return true;
      },

      reset: () => {
        set({
          weights: { ...DEFAULT_WEIGHTS },
          pending: { ...DEFAULT_WEIGHTS },
          isDirty: false,
        });
      },

      sum: () => sumWeights(get().pending),
    }),
    {
      name: "heatmap-weights",
      version: 1,
      // Persist only the applied weights — pending is re-hydrated from weights.
      partialize: (state) => ({ weights: state.weights }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.pending = { ...state.weights };
          state.isDirty = false;
        }
      },
    },
  ),
);

// ─── Adapter: UI percents → backend fractions ────────────────────────────────

/**
 * Convert UI integer percents (0–100, summing to 100) into the fraction-based
 * `ScoreWeights` shape consumed by `getHeatMapData`.
 */
export function toScoreWeights(w: HeatmapWeights): ScoreWeights {
  return {
    revenue: w.revenue / 100,
    transactions: w.transactions / 100,
    revenuePerRoom: w.revenuePerRoom / 100,
    txnPerKiosk: w.txnPerKiosk / 100,
    basketValue: w.basketValue / 100,
  };
}
