import { create } from "zustand";

interface CalendarFilters {
  region: string | null;
  status: string | null;
  hotelGroup: string | null;
}

interface CalendarState {
  filters: CalendarFilters;
  viewMode: "month" | "week" | "day";
  setFilter: (key: keyof CalendarFilters, value: string | null) => void;
  setViewMode: (mode: "month" | "week" | "day") => void;
  clearFilters: () => void;
}

export const useCalendarStore = create<CalendarState>((set) => ({
  filters: { region: null, status: null, hotelGroup: null },
  viewMode: "month",
  setFilter: (key, value) =>
    set((state) => ({
      filters: { ...state.filters, [key]: value },
    })),
  setViewMode: (viewMode) => set({ viewMode }),
  clearFilters: () =>
    set({ filters: { region: null, status: null, hotelGroup: null } }),
}));
