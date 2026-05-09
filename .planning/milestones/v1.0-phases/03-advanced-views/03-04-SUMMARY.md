---
phase: 03-advanced-views
plan: 04
subsystem: ui
tags: [react-big-calendar, date-fns, zustand, calendar, typescript, next-js]

# Dependency graph
requires:
  - phase: 03-advanced-views
    plan: 01
    provides: installations table, milestones table, all 11 server actions
  - phase: 03-advanced-views
    plan: 02
    provides: InstallationWithRelations type, KioskWithRelations type (freeTrialEndDate)

provides:
  - CalendarView client component wrapping react-big-calendar with 3 event types
  - CalendarToolbar with month/week/day toggle and region/status/hotel-group filters
  - CalendarEventPopover with installation/milestone/trial-expiry detail variants
  - useCalendarStore Zustand store (filters + viewMode)
  - buildCalendarEvents + filterCalendarEvents utility functions in calendar-utils.ts
  - REGION_COLORS palette (locally defined — gantt-utils.ts may not exist yet)
  - WeKnow brand CSS overrides in globals.css scoped to .rbc-calendar-wk
  - CalendarTab wrapper for Plan 03-05 server-to-client data handoff

affects:
  - 03-05 (Integration: CalendarTab imported into kiosks page, data fetched server-side)

# Tech tracking
tech-stack:
  added:
    - react-big-calendar@1.19.4
    - "@types/react-big-calendar@1.16.3"
  patterns:
    - "dateFnsLocalizer with named import { enUS } from 'date-fns/locale' — required for date-fns v4 (CommonJS require fails)"
    - "react-big-calendar requires explicit height on container: h-[700px] wrapper with style={{ height: '100%' }} on Calendar"
    - "eventPropGetter returns className + style per event type; transparent bg for milestone/trial-expiry, region colour at 80% for installation"
    - "Custom components.event component switches on event.type for shape rendering (block / diamond / dot)"
    - "CalendarEventPopover is a controlled overlay (not anchored Popover) — avoids base-ui Popover anchor complexity for programmatic open"
    - "REGION_COLORS defined locally in calendar-utils.ts — safe parallel execution guard if gantt-utils.ts not yet present"

key-files:
  created:
    - src/lib/calendar-utils.ts
    - src/lib/stores/calendar-store.ts
    - src/components/calendar/calendar-view.tsx
    - src/components/calendar/calendar-toolbar.tsx
    - src/components/calendar/calendar-event-popover.tsx
    - src/app/(app)/kiosks/calendar-tab.tsx
  modified:
    - src/app/globals.css
    - package.json
    - package-lock.json

key-decisions:
  - "REGION_COLORS defined locally in calendar-utils.ts, not imported from gantt-utils.ts — gantt-utils.ts may not exist during parallel Plan 03-03 execution; avoids import error"
  - "CalendarEventPopover implemented as fixed overlay (not base-ui Popover) — react-big-calendar's onSelectEvent fires without a DOM anchor element; a fixed overlay anchored top-right of the calendar container is simpler and more reliable than a Popover requiring an anchor"
  - "hotelGroup filter uses kiosk.regionGroup — KioskWithRelations has no hotelGroup field (hotelGroup is on locations table); regionGroup is the closest kiosk-level grouping field available"

patterns-established:
  - "Calendar overlay pattern: controlled open/onClose state in CalendarView; CalendarEventPopover renders as absolute-positioned div inside the calendar container"
  - "react-big-calendar event typing: eventPropGetter and components.event both receive event as object; cast to CalendarEventData for type safety"

requirements-completed:
  - CAL-01
  - CAL-02

# Metrics
duration: 5min
completed: 2026-03-19
---

# Phase 3 Plan 04: Calendar View Summary

**react-big-calendar Calendar view with installation spans (coloured blocks), milestone diamonds, trial expiry dots, month/week/day view switching, and region/status/hotel-group client-side filters**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-19T12:02:23Z
- **Completed:** 2026-03-19T12:07:30Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Installed react-big-calendar@1.19.4 with @types/react-big-calendar
- Created calendar-utils.ts: CalendarEventData type, buildCalendarEvents (3 event types), filterCalendarEvents, REGION_COLORS, isWithin30Days helper
- Created calendar-store.ts: Zustand store for filters (region, status, hotelGroup) and viewMode with setFilter/setViewMode/clearFilters
- Appended WeKnow CSS overrides to globals.css scoped to .rbc-calendar-wk (after .gantt-wk block — parallel execution safe)
- CalendarView: dateFnsLocalizer with date-fns v4 named locale import, custom event renderers per type, eventPropGetter, h-[700px] height guard, empty state
- CalendarToolbar: Azure-highlighted view toggle buttons, three filter Selects, clear filters link
- CalendarEventPopover: Escape-to-close overlay, three content variants (installation/milestone/trial-expiry) with "View installation" and "View kiosk" navigation links
- CalendarTab: thin "use client" wrapper for Plan 03-05 integration
- TypeScript compiles with zero errors

## Task Commits

1. **Task 1: Install react-big-calendar, calendar utils + store + CSS overrides** - `e1e0f3b` (feat)
2. **Task 2: CalendarView + CalendarToolbar + CalendarEventPopover components** - `5e00cfa` (feat)

## Files Created/Modified

- `src/lib/calendar-utils.ts` - REGION_COLORS, CalendarEventData type, buildCalendarEvents, filterCalendarEvents, isWithin30Days
- `src/lib/stores/calendar-store.ts` - useCalendarStore Zustand store (filters + viewMode)
- `src/app/globals.css` - .rbc-calendar-wk brand overrides + .cal-event--milestone + .cal-event--trial-expiry appended at end
- `src/components/calendar/calendar-view.tsx` - Main client Calendar component with react-big-calendar
- `src/components/calendar/calendar-toolbar.tsx` - Month/week/day toggle + filter dropdowns
- `src/components/calendar/calendar-event-popover.tsx` - Controlled event detail overlay
- `src/app/(app)/kiosks/calendar-tab.tsx` - Wrapper for Plan 03-05 integration
- `package.json` - Added react-big-calendar + @types/react-big-calendar
- `package-lock.json` - Updated lockfile

## Decisions Made

- **REGION_COLORS defined locally**: gantt-utils.ts does not exist during parallel Plan 03-03 execution. Defining REGION_COLORS in calendar-utils.ts directly avoids a broken import. If gantt-utils.ts is later created by 03-03, the two definitions will be consistent (same values) and can be unified in 03-05 if desired.
- **CalendarEventPopover as overlay, not Popover primitive**: react-big-calendar's `onSelectEvent` fires without providing a DOM anchor element. The base-ui Popover component requires an anchor (PopoverTrigger with children). A simple `absolute`-positioned div inside the calendar container is simpler, avoids the anchor problem, and provides equivalent UX.
- **hotelGroup filter uses kiosk.regionGroup**: The `KioskWithRelations` type has no `hotelGroup` field. The `hotelGroup` column exists on `locations`, not `kiosks`. `regionGroup` is the best available grouping field on kiosks and is used for the "Hotel group" filter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] npm install without --save didn't add react-big-calendar to package.json**
- **Found during:** Task 2 (TypeScript compilation check)
- **Issue:** Initial `npm install react-big-calendar @types/react-big-calendar` ran successfully and showed in `npm ls` but TypeScript failed with "Cannot find module 'react-big-calendar'". Inspection showed the package was not in package.json (npm didn't save it). Subsequent `npm ls` after checking package.json confirmed the package wasn't persisted.
- **Fix:** Re-ran `npm install react-big-calendar @types/react-big-calendar --save` to persist to package.json; packages then available in node_modules and TypeScript resolved correctly.
- **Files modified:** package.json, package-lock.json
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** e1e0f3b (Task 1 commit — package.json staged)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix necessary for package to be persisted. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviation above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- CalendarView is fully self-contained and ready for integration in Plan 03-05
- CalendarTab wrapper is ready to receive installations + kiosks data from server
- calendar-utils.ts exports buildCalendarEvents and filterCalendarEvents for use in Plan 03-05's server component
- No blockers

---
*Phase: 03-advanced-views*
*Completed: 2026-03-19*
