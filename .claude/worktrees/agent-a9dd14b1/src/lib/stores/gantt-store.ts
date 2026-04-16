import { create } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingChange {
  taskId: string;
  installationName: string;
  originalStart: Date;
  originalEnd: Date;
  newStart: Date;
  newEnd: Date;
  duration: number;
}

interface GanttState {
  pendingChange: PendingChange | null;
  groupBy: "region" | "status";
  zoom: "day" | "week" | "month";
  setPendingChange: (change: PendingChange | null) => void;
  setGroupBy: (groupBy: "region" | "status") => void;
  setZoom: (zoom: "day" | "week" | "month") => void;
  clearPending: () => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useGanttStore = create<GanttState>((set) => ({
  pendingChange: null,
  groupBy: "region",
  zoom: "month",
  setPendingChange: (pendingChange) => set({ pendingChange }),
  setGroupBy: (groupBy) => set({ groupBy }),
  setZoom: (zoom) => set({ zoom }),
  clearPending: () => set({ pendingChange: null }),
}));
