import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// ─── Types ────────────────────────────────────────────────────────────────────

export type PerformerThresholdKey = "greenCutoff" | "redCutoff";

export type PerformerThresholdState = {
  greenCutoff: number; // % of outlets considered "green" (top performers)
  redCutoff: number; // % of outlets considered "red" (bottom performers)
  set: (key: PerformerThresholdKey, value: number) => void;
  reset: () => void;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_GREEN_CUTOFF = 30;
export const DEFAULT_RED_CUTOFF = 30;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

export function isValidCutoffPair(green: number, red: number): boolean {
  return green >= 0 && red >= 0 && green + red <= 100;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const usePerformerThresholdStore = create<PerformerThresholdState>()(
  persist(
    (set) => ({
      greenCutoff: DEFAULT_GREEN_CUTOFF,
      redCutoff: DEFAULT_RED_CUTOFF,
      set: (key, value) => set({ [key]: clamp(value) } as Partial<PerformerThresholdState>),
      reset: () =>
        set({
          greenCutoff: DEFAULT_GREEN_CUTOFF,
          redCutoff: DEFAULT_RED_CUTOFF,
        }),
    }),
    {
      name: "wkg:performer-threshold",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          // SSR no-op storage
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return window.localStorage;
      }),
      partialize: (state) => ({
        greenCutoff: state.greenCutoff,
        redCutoff: state.redCutoff,
      }),
    },
  ),
);
