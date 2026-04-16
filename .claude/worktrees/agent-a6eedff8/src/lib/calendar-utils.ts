import type { InstallationWithRelations } from "@/app/(app)/installations/actions";
import type { KioskListItem } from "@/app/(app)/kiosks/actions";
import { REGION_COLORS } from "@/lib/region-colors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarEventData {
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  type: "installation" | "milestone" | "trial-expiry";
  regionColor: string;
  regionSlug: string;
  /** For popover navigation link */
  entityId: string;
  entityType: "installation" | "kiosk";
  /** Additional detail for popover */
  status?: string;
  milestoneName?: string;
  milestoneType?: string;
  /** Parent installation name (for milestone events) */
  installationName?: string;
  /** Kiosk display ID (for trial-expiry events) */
  kioskDisplayId?: string;
}

export interface CalendarFiltersInput {
  region: string | null;
  status: string | null;
  hotelGroup: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isWithin30Days(date: Date): boolean {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 30;
}

function getRegionColor(region: string | null | undefined): string {
  if (!region) return REGION_COLORS.default;
  return REGION_COLORS[region] ?? REGION_COLORS.default;
}

function regionToSlug(region: string | null | undefined): string {
  if (!region) return "default";
  return region.toLowerCase().replace(/\s+/g, "-");
}

// ---------------------------------------------------------------------------
// Build calendar events from data
// ---------------------------------------------------------------------------

export function buildCalendarEvents(
  installations: InstallationWithRelations[],
  kiosks: KioskListItem[]
): CalendarEventData[] {
  const events: CalendarEventData[] = [];

  for (const inst of installations) {
    // Installation span event (multi-day block)
    if (inst.plannedStart && inst.plannedEnd) {
      const startDate =
        inst.plannedStart instanceof Date
          ? inst.plannedStart
          : new Date(inst.plannedStart);
      const endDate =
        inst.plannedEnd instanceof Date
          ? inst.plannedEnd
          : new Date(inst.plannedEnd);

      events.push({
        id: `inst-${inst.id}`,
        title: inst.name,
        start: startDate,
        end: endDate,
        allDay: true,
        type: "installation",
        regionColor: getRegionColor(inst.region),
        regionSlug: regionToSlug(inst.region),
        entityId: inst.id,
        entityType: "installation",
        status: inst.status,
      });
    }

    // Milestone events (single-day diamond markers)
    for (const ms of inst.milestones) {
      const targetDate =
        ms.targetDate instanceof Date ? ms.targetDate : new Date(ms.targetDate);

      events.push({
        id: `ms-${ms.id}`,
        title: ms.name,
        start: targetDate,
        end: targetDate,
        allDay: true,
        type: "milestone",
        regionColor: getRegionColor(inst.region),
        regionSlug: regionToSlug(inst.region),
        entityId: inst.id,
        entityType: "installation",
        status: inst.status,
        milestoneName: ms.name,
        milestoneType: ms.type,
        installationName: inst.name,
      });
    }
  }

  // Trial expiry events (single-day dot markers from kiosk data)
  for (const kiosk of kiosks) {
    if (kiosk.freeTrialEndDate) {
      const expiryDate =
        kiosk.freeTrialEndDate instanceof Date
          ? kiosk.freeTrialEndDate
          : new Date(kiosk.freeTrialEndDate);

      const dotColor = isWithin30Days(expiryDate) ? "#F4BA1E" : "#ADADAD";

      events.push({
        id: `trial-${kiosk.id}`,
        title: `${kiosk.kioskId} — trial ends`,
        start: expiryDate,
        end: expiryDate,
        allDay: true,
        type: "trial-expiry",
        regionColor: dotColor,
        regionSlug: regionToSlug(kiosk.regionGroup),
        entityId: kiosk.id,
        entityType: "kiosk",
        kioskDisplayId: kiosk.kioskId,
      });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Filter calendar events
// ---------------------------------------------------------------------------

export function filterCalendarEvents(
  events: CalendarEventData[],
  filters: CalendarFiltersInput
): CalendarEventData[] {
  return events.filter((event) => {
    // Region filter: match on regionSlug
    if (filters.region) {
      const filterSlug = regionToSlug(filters.region);
      if (event.regionSlug !== filterSlug) return false;
    }

    // Status filter: only applies to installation and milestone events
    if (filters.status && event.status) {
      if (event.status !== filters.status) return false;
    }

    // Hotel group filter: trial-expiry events are associated with kiosk regionGroup
    // For installation/milestone events this filter is not applicable (pass through)
    if (filters.hotelGroup) {
      if (event.type === "trial-expiry") {
        const filterSlug = regionToSlug(filters.hotelGroup);
        if (event.regionSlug !== filterSlug) return false;
      }
    }

    return true;
  });
}
