"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCalendarStore } from "@/lib/stores/calendar-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InstallationWithRelations } from "@/app/(app)/installations/actions";
import type { KioskListItem } from "@/app/(app)/kiosks/actions";
import type { ToolbarProps } from "react-big-calendar";
import type { CalendarEventData } from "@/lib/calendar-utils";

interface CalendarToolbarProps {
  installations: InstallationWithRelations[];
  kiosks: KioskListItem[];
}

const VIEW_MODES = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
] as const;

const STATUS_OPTIONS = [
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "complete", label: "Complete" },
];

/**
 * Custom toolbar for react-big-calendar. Replaces the built-in toolbar entirely
 * so we have one set of controls: navigation + view mode + filters.
 */
export function createCalendarToolbar({
  installations,
  kiosks,
}: CalendarToolbarProps) {
  return function CustomToolbar(toolbar: ToolbarProps<CalendarEventData, object>) {
    return (
      <CalendarToolbarInner
        toolbar={toolbar}
        installations={installations}
        kiosks={kiosks}
      />
    );
  };
}

function CalendarToolbarInner({
  toolbar,
  installations,
  kiosks,
}: CalendarToolbarProps & { toolbar: ToolbarProps<CalendarEventData, object> }) {
  const { filters, viewMode, setFilter, setViewMode, clearFilters } =
    useCalendarStore();

  const hasActiveFilters =
    filters.region !== null ||
    filters.status !== null ||
    filters.hotelGroup !== null;

  const regions = Array.from(
    new Set(
      installations
        .map((inst) => inst.region)
        .filter((r): r is string => r !== null && r !== "")
    )
  ).sort();

  const hotelGroups = Array.from(
    new Set(
      kiosks
        .map((k) => k.regionGroup)
        .filter((g): g is string => g !== null && g !== "")
    )
  ).sort();

  function handleViewChange(view: "month" | "week" | "day") {
    setViewMode(view);
    toolbar.onView(view);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 bg-wk-light-grey rounded-lg px-4 py-2">
      {/* Navigation: Back / Today / Next */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => toolbar.onNavigate("PREV")}
          className="inline-flex items-center justify-center size-8 rounded-md border border-border bg-white text-wk-graphite hover:bg-wk-azure/10 transition-colors"
          aria-label="Previous"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          onClick={() => toolbar.onNavigate("TODAY")}
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-white text-wk-graphite hover:bg-wk-azure/10 transition-colors"
        >
          Today
        </button>
        <button
          onClick={() => toolbar.onNavigate("NEXT")}
          className="inline-flex items-center justify-center size-8 rounded-md border border-border bg-white text-wk-graphite hover:bg-wk-azure/10 transition-colors"
          aria-label="Next"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Current label (e.g. "April 2026") */}
      <span className="text-sm font-semibold text-wk-graphite min-w-[120px]">
        {toolbar.label}
      </span>

      {/* View mode toggle */}
      <div className="flex items-center rounded-md border border-border overflow-hidden">
        {VIEW_MODES.map((mode) => (
          <button
            key={mode.value}
            onClick={() => handleViewChange(mode.value)}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              viewMode === mode.value
                ? "bg-wk-azure text-white"
                : "bg-white text-wk-graphite hover:bg-wk-azure/10"
            }`}
            aria-pressed={viewMode === mode.value}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-border" />

      {/* Region filter */}
      <Select
        value={filters.region ?? ""}
        items={[
          { value: "", label: "All regions" },
          ...regions.map((r) => ({ value: r, label: r })),
        ]}
        onValueChange={(v) => setFilter("region", v || null)}
      >
        <SelectTrigger size="sm" className="w-36">
          <SelectValue placeholder="All regions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All regions</SelectItem>
          {regions.map((region) => (
            <SelectItem key={region} value={region}>
              {region}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Status filter */}
      <Select
        value={filters.status ?? ""}
        items={[
          { value: "", label: "All statuses" },
          ...STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label })),
        ]}
        onValueChange={(v) => setFilter("status", v || null)}
      >
        <SelectTrigger size="sm" className="w-36">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">All statuses</SelectItem>
          {STATUS_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Hotel group filter */}
      {hotelGroups.length > 0 && (
        <Select
          value={filters.hotelGroup ?? ""}
          items={[
            { value: "", label: "All hotel groups" },
            ...hotelGroups.map((g) => ({ value: g, label: g })),
          ]}
          onValueChange={(v) => setFilter("hotelGroup", v || null)}
        >
          <SelectTrigger size="sm" className="w-40">
            <SelectValue placeholder="All hotel groups" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All hotel groups</SelectItem>
            {hotelGroups.map((group) => (
              <SelectItem key={group} value={group}>
                {group}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          className="text-xs text-wk-night-grey hover:text-wk-graphite transition-colors underline underline-offset-2"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
