"use client";

import { useGanttStore } from "@/lib/stores/gantt-store";

const ZOOM_OPTIONS: Array<{ value: "day" | "week" | "month"; label: string }> =
  [
    { value: "day", label: "Day" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
  ];

export function GanttToolbar() {
  const groupBy = useGanttStore((s) => s.groupBy);
  const zoom = useGanttStore((s) => s.zoom);
  const setGroupBy = useGanttStore((s) => s.setGroupBy);
  const setZoom = useGanttStore((s) => s.setZoom);

  return (
    <div className="flex items-center gap-3 bg-muted rounded-lg px-4 py-2 mb-3">
      {/* Grouping select */}
      <div className="flex items-center gap-2">
        <label
          htmlFor="gantt-group-by"
          className="text-xs font-medium text-muted-foreground whitespace-nowrap"
        >
          Group by
        </label>
        <select
          id="gantt-group-by"
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as "region" | "status")}
          className="text-sm bg-white border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="region">Region</option>
          <option value="status">Status</option>
        </select>
      </div>

      <div className="w-px h-5 bg-border mx-1" aria-hidden="true" />

      {/* Zoom controls */}
      <div className="flex items-center gap-1">
        {ZOOM_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            onClick={() => setZoom(value)}
            className={
              zoom === value
                ? "px-3 py-1 rounded text-xs font-medium bg-primary text-primary-foreground"
                : "px-3 py-1 rounded text-xs font-medium text-foreground hover:bg-white transition-colors"
            }
            aria-pressed={zoom === value}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
