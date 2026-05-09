---
phase: 03-advanced-views
plan: 05
subsystem: ui
tags: [integration, next-js, url-params, zustand, saved-views, typescript]

# Dependency graph
requires:
  - phase: 03-advanced-views
    plan: 03
    provides: GanttTab wrapper, GanttView component
  - phase: 03-advanced-views
    plan: 04
    provides: CalendarTab wrapper, CalendarView component

provides:
  - ViewTabsClient: client component with 4-tab URL-synced navigation (Table/Kanban/Gantt/Calendar)
  - Kiosks page with searchParams ?view= support — bookmarkable, server-rendered active tab
  - useGanttViewStore and useCalendarViewStore Zustand instances
  - ViewConfig extended with ganttGroupBy, ganttZoom, calendarView, calendarFilters fields
  - SavedViewsBar extended with viewType prop — Gantt/Calendar saved views are isolated

affects:
  - src/app/(app)/kiosks/page.tsx — now server component with searchParams + 4 data fetches
  - src/components/table/saved-views-bar.tsx — entityType accepts "installation", new viewType prop

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Controlled Tabs value={activeView} onValueChange={router.push} — server-rendered active tab reacts to URL changes on navigation"
    - "listInstallations() error union handled at page boundary: Array.isArray(result) ? result : [] — avoids crashing on auth failure"
    - "viewType param in saveAction/listAction — SavedViewsBar passes viewType to all CRUD calls; server actions filter with eq(userViews.viewType, viewType)"

key-files:
  created:
    - src/app/(app)/kiosks/view-tabs-client.tsx
  modified:
    - src/app/(app)/kiosks/page.tsx
    - src/app/(app)/kiosks/calendar-tab.tsx
    - src/app/(app)/kiosks/actions.ts (KioskListItem + listKiosks — added freeTrialEndDate)
    - src/lib/stores/view-engine-store.ts
    - src/components/table/saved-views-bar.tsx
    - src/app/(app)/kiosks/views-actions.ts
    - src/app/(app)/locations/views-actions.ts
    - src/lib/calendar-utils.ts (KioskWithRelations → KioskListItem)
    - src/components/calendar/calendar-view.tsx (KioskWithRelations → KioskListItem)
    - src/components/calendar/calendar-toolbar.tsx (KioskWithRelations → KioskListItem)

key-decisions:
  - "KioskListItem used for CalendarView instead of KioskWithRelations: listKiosks() returns KioskListItem[]; updating CalendarView to accept KioskListItem[] avoids a second data-fetch just for the calendar. Added freeTrialEndDate to KioskListItem to satisfy the calendar's trial-expiry event rendering."
  - "viewType default is 'table' in views-actions: existing saved views in DB have viewType='table' (schema default). listSavedViews('table') correctly returns them, preserving backward compatibility with existing table SavedViewsBar usages."
  - "locations/views-actions.ts updated for consistency: both kiosk and location actions now accept optional viewType to prevent future type drift and ensure SavedViewsBar interface is satisfied."

patterns-established:
  - "4-tab URL-sync pattern: server component reads searchParams, passes activeView to client component; client uses controlled Tabs + router.push for URL updates without full page reload"
  - "viewType isolation in SavedViewsBar: optional viewType prop flows through all list/save calls — zero behavioral change when viewType is omitted (defaults to 'table')"

requirements-completed:
  - GANTT-01
  - GANTT-02
  - CAL-01
  - CAL-02

# Metrics
duration: 8min
completed: 2026-03-19
---

# Phase 3 Plan 05: Kiosks Page Integration Summary

**4 view tabs (Table / Kanban / Gantt / Calendar) wired into Kiosks page with bookmarkable ?view= URL params, URL-synced controlled navigation, and per-viewType saved view isolation**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-03-19
- **Tasks:** 2
- **Files modified:** 11 (1 created, 10 modified)

## Accomplishments

- Updated KiosksPage server component to read `?view=` searchParams and pass `activeView` to `ViewTabsClient`
- Created `ViewTabsClient`: client component with 4 tabs in controlled mode (`value={activeView}`), `onValueChange` pushes URL via `router.push` with `{ scroll: false }`
- Added `listInstallations()` to the server `Promise.all` data fetch; handles `{ error: string }` union return gracefully
- Added `freeTrialEndDate` to `KioskListItem` and `listKiosks()` query so CalendarView's trial-expiry events work with list data
- Updated `CalendarView`, `CalendarToolbar`, `CalendarTab`, `calendar-utils.ts` to accept `KioskListItem[]` instead of `KioskWithRelations[]`
- Extended `ViewConfig` with Gantt (`ganttGroupBy`, `ganttZoom`) and Calendar (`calendarView`, `calendarFilters`) specific fields
- Added `useGanttViewStore` and `useCalendarViewStore` store instances to `view-engine-store.ts`
- Extended `SavedViewsBar`: `entityType` now accepts `"installation"`, new optional `viewType` prop (`"table" | "kanban" | "gantt" | "calendar"`) passed to all CRUD actions
- Updated `kiosks/views-actions.ts` and `locations/views-actions.ts` `saveView`/`listSavedViews` to accept `viewType` param with `"table"` default; `listSavedViews` now filters with `eq(userViews.viewType, viewType)`
- TypeScript compiles with zero errors throughout

## Task Commits

1. **Task 1: Kiosks page + ViewTabsClient** - `a80faed` (feat)
2. **Task 2: View Engine + SavedViewsBar viewType** - `5ec9dfc` (feat)

## Files Created/Modified

- `src/app/(app)/kiosks/view-tabs-client.tsx` - New client component: 4-tab Tabs with URL sync
- `src/app/(app)/kiosks/page.tsx` - Added searchParams, listInstallations(), ViewTabsClient
- `src/app/(app)/kiosks/calendar-tab.tsx` - Updated to use KioskListItem[]
- `src/app/(app)/kiosks/actions.ts` - Added freeTrialEndDate to KioskListItem + query
- `src/lib/stores/view-engine-store.ts` - Extended ViewConfig + 2 new store instances
- `src/components/table/saved-views-bar.tsx` - entityType + viewType extension
- `src/app/(app)/kiosks/views-actions.ts` - viewType param in saveView/listSavedViews
- `src/app/(app)/locations/views-actions.ts` - Same viewType param for consistency
- `src/lib/calendar-utils.ts` - KioskWithRelations → KioskListItem
- `src/components/calendar/calendar-view.tsx` - KioskWithRelations → KioskListItem
- `src/components/calendar/calendar-toolbar.tsx` - KioskWithRelations → KioskListItem

## Decisions Made

- **KioskListItem for CalendarView**: `listKiosks()` returns `KioskListItem[]`. The calendar was built in 03-04 expecting `KioskWithRelations[]` but the Kiosks page only uses `listKiosks()`. Rather than adding a second DB fetch, updated CalendarView and related files to accept `KioskListItem[]` and added `freeTrialEndDate` to `KioskListItem` (it's a DB column that was just excluded from the list query).
- **viewType defaults to "table"**: Existing saved views have `viewType = "table"` in the DB (schema default). With `listSavedViews("table")` filtering by viewType, existing table views remain visible and the filter correctly isolates Gantt/Calendar views when `viewType="gantt"` or `"calendar"` is passed.
- **locations/views-actions.ts updated for consistency**: Both entity action files now have matching viewType signatures, preventing future SavedViewsBar type errors if locations gets Kanban/Gantt views.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CalendarView/CalendarTab used KioskWithRelations[] but page provides KioskListItem[]**
- **Found during:** Task 1 (TypeScript check after creating page.tsx + view-tabs-client.tsx)
- **Issue:** `CalendarView`, `CalendarToolbar`, `CalendarTab`, and `calendar-utils.ts` were all typed with `KioskWithRelations[]`, but `listKiosks()` returns `KioskListItem[]`. TypeScript reported 4 errors.
- **Fix:** Updated all 4 files to use `KioskListItem[]`. Added `freeTrialEndDate: Date | null` to `KioskListItem` and `listKiosks()` select so calendar trial-expiry events still work.
- **Files modified:** actions.ts, calendar-utils.ts, calendar-view.tsx, calendar-toolbar.tsx, calendar-tab.tsx
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** a80faed (Task 1 commit)

**2. [Rule 1 - Bug] listInstallations() returns InstallationWithRelations[] | { error: string } — not a plain array**
- **Found during:** Task 1 (TypeScript check)
- **Issue:** `Promise.all` assignment tried to pass `InstallationWithRelations[] | { error: string }` as `InstallationWithRelations[]` prop
- **Fix:** Destructure result with `Array.isArray(installationsResult) ? installationsResult : []` at page boundary
- **Files modified:** src/app/(app)/kiosks/page.tsx
- **Verification:** TypeScript compiles clean
- **Committed in:** a80faed (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both type correctness bugs from plan's interface assumptions)
**Impact on plan:** Minimal — type fixes were contained to the calendar stack and page.tsx.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None — no new packages or external services.

## Next Phase Readiness

- Phase 3 is complete: Gantt, Calendar, and Kiosks integration are all done
- All 5 plan requirements (GANTT-01, GANTT-02, CAL-01, CAL-02) are satisfied
- Phase 4 (Data Migration) can begin — schema is stable
- No blockers

## Self-Check: PASSED

All required files found on disk. Both task commits (a80faed, 5ec9dfc) verified in git log.

---
*Phase: 03-advanced-views*
*Completed: 2026-03-19*
