"use client";

import "react-big-calendar/lib/css/react-big-calendar.css";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Calendar, dateFnsLocalizer, type View } from "react-big-calendar";
import {
  format,
  parse,
  startOfWeek,
  endOfWeek,
  getDay,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
} from "date-fns";
import { enUS } from "date-fns/locale";
import { useCalendarStore } from "@/lib/stores/calendar-store";
import {
  buildCalendarEvents,
  filterCalendarEvents,
  type CalendarEventData,
} from "@/lib/calendar-utils";
import { createCalendarToolbar } from "./calendar-toolbar";
import { CalendarEventPopover } from "./calendar-event-popover";
import type { InstallationWithRelations } from "@/app/(app)/installations/actions";
import type { KioskListItem } from "@/app/(app)/kiosks/actions";

// ---------------------------------------------------------------------------
// date-fns v4 localizer — MUST use named import (not CommonJS require)
// ---------------------------------------------------------------------------
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { "en-US": enUS },
});

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CalendarViewProps {
  installations: InstallationWithRelations[];
  kiosks: KioskListItem[];
}

// ---------------------------------------------------------------------------
// Custom event sub-components
// ---------------------------------------------------------------------------

function InstallationBlockEvent({ event }: { event: CalendarEventData }) {
  return (
    <span
      className="block truncate text-xs font-medium px-1"
      title={event.title}
    >
      {event.title}
    </span>
  );
}

function MilestoneDiamondEvent({ event }: { event: CalendarEventData }) {
  return (
    <span
      className="flex items-center gap-1"
      role="img"
      aria-label={`${event.milestoneName ?? event.title} milestone — ${format(event.start, "d MMM yyyy")}`}
    >
      {/* 12×12px rotated square = diamond */}
      <span
        style={{
          display: "inline-block",
          width: 12,
          height: 12,
          backgroundColor: event.regionColor,
          transform: "rotate(45deg)",
          flexShrink: 0,
        }}
      />
      <span className="text-xs text-foreground truncate">{event.title}</span>
    </span>
  );
}

function TrialExpiryDotEvent({ event }: { event: CalendarEventData }) {
  return (
    <span className="flex items-center gap-1">
      {/* 8px filled dot */}
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: event.regionColor,
          flexShrink: 0,
        }}
      />
      <span className="text-xs text-foreground truncate">{event.title}</span>
    </span>
  );
}

function CalendarEvent({ event }: { event: CalendarEventData }) {
  if (event.type === "milestone") return <MilestoneDiamondEvent event={event} />;
  if (event.type === "trial-expiry") return <TrialExpiryDotEvent event={event} />;
  return <InstallationBlockEvent event={event} />;
}

// ---------------------------------------------------------------------------
// eventPropGetter — per-event CSS class and inline style
// ---------------------------------------------------------------------------

function eventPropGetter(event: CalendarEventData) {
  const ev = event;
  return {
    className: `cal-event--${ev.type}`,
    style: {
      backgroundColor:
        ev.type === "installation"
          ? `${ev.regionColor}cc` // 80% opacity hex suffix
          : "transparent",
      color: ev.type === "installation" ? "white" : "var(--color-wk-graphite)",
      border: ev.type === "installation" ? "none" : undefined,
      borderRadius: ev.type === "installation" ? "4px" : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Main CalendarView
// ---------------------------------------------------------------------------

export function CalendarView({ installations, kiosks }: CalendarViewProps) {
  const { filters, viewMode, setViewMode } = useCalendarStore();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [visibleRange, setVisibleRange] = useState<{ start: Date; end: Date } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(52);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventData | null>(
    null
  );

  // Build all events from data
  const allEvents = useMemo(
    () => buildCalendarEvents(installations, kiosks),
    [installations, kiosks]
  );

  // Apply filters
  const filteredEvents = useMemo(
    () => filterCalendarEvents(allEvents, filters),
    [allEvents, filters]
  );

  // Measure the toolbar height so the empty-state overlay doesn't cover it
  useEffect(() => {
    const container = toolbarRef.current;
    if (!container) return;
    const toolbar = container.querySelector<HTMLElement>(".rbc-toolbar");
    if (!toolbar) return;
    const ro = new ResizeObserver(([entry]) => {
      setToolbarHeight(entry.contentRect.height);
    });
    ro.observe(toolbar);
    return () => ro.disconnect();
  }, []);

  // Compute initial visible range on mount (onRangeChange doesn't fire until first navigation)
  useEffect(() => {
    if (visibleRange) return; // already set by onRangeChange
    const d = currentDate;
    if (viewMode === "month") {
      setVisibleRange({ start: startOfWeek(startOfMonth(d)), end: endOfWeek(endOfMonth(d)) });
    } else if (viewMode === "week") {
      setVisibleRange({ start: startOfWeek(d), end: endOfWeek(d) });
    } else {
      setVisibleRange({ start: startOfDay(d), end: endOfDay(d) });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Empty state — true when no filtered events overlap the currently visible date range
  const visibleRangeEmpty = useMemo(() => {
    if (!visibleRange) return false; // range not yet known
    return !filteredEvents.some(
      (ev) =>
        ev.start != null &&
        ev.end != null &&
        ev.start <= visibleRange.end &&
        ev.end >= visibleRange.start
    );
  }, [filteredEvents, visibleRange]);

  const handleEventClick = useCallback((event: CalendarEventData) => {
    setSelectedEvent(event);
    setPopoverOpen(true);
  }, []);

  const handleClosePopover = useCallback(() => {
    setPopoverOpen(false);
    setSelectedEvent(null);
  }, []);

  const handleViewChange = useCallback(
    (view: View) => {
      if (view === "month" || view === "week" || view === "day") {
        setViewMode(view);
      }
    },
    [setViewMode]
  );

  const handleNavigate = useCallback((date: Date) => {
    setCurrentDate(date);
  }, []);

  const handleRangeChange = useCallback(
    (range: Date[] | { start: Date; end: Date }) => {
      if (Array.isArray(range)) {
        // Day view returns [date], week returns [sun..sat] — use endOfDay on last entry
        setVisibleRange({
          start: range[0],
          end: endOfDay(range[range.length - 1]),
        });
      } else {
        setVisibleRange(range);
      }
    },
    []
  );

  // Custom toolbar replaces the built-in rbc toolbar (merges nav + view mode + filters)
  const CustomToolbar = useMemo(
    () => createCalendarToolbar({ installations, kiosks }),
    [installations, kiosks]
  );

  return (
    <div className="rbc-calendar-wk">
      <div className="h-[700px] relative" ref={toolbarRef}>
        <Calendar<CalendarEventData>
          localizer={localizer}
          events={filteredEvents}
          startAccessor="start"
          endAccessor="end"
          date={currentDate}
          onNavigate={handleNavigate}
          view={viewMode}
          onView={handleViewChange}
          onRangeChange={handleRangeChange}
          views={["month", "week", "day"]}
          components={{ event: CalendarEvent, toolbar: CustomToolbar }}
          eventPropGetter={eventPropGetter}
          onSelectEvent={handleEventClick}
          style={{ height: "100%" }}
        />

        {/* Event detail popover */}
        <CalendarEventPopover
          event={selectedEvent}
          open={popoverOpen}
          onClose={handleClosePopover}
        />

        {/* Empty state — overlays only the grid area, not the toolbar */}
        {visibleRangeEmpty && (
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded pointer-events-none" style={{ top: toolbarHeight }}>
            <div className="text-center px-6 py-8 rounded-lg bg-card shadow-sm border border-border max-w-sm pointer-events-auto">
              <p className="text-base font-semibold text-foreground">
                Nothing scheduled for this period
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Add installations and milestones to see them here. Trial expiry
                dates appear automatically from your kiosk records.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
