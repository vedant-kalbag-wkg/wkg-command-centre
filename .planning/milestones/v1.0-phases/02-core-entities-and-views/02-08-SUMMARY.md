---
phase: 02-core-entities-and-views
plan: 08
subsystem: ui
tags: [react, tanstack-table, inline-editing, column-filters, next.js, server-actions]

# Dependency graph
requires:
  - phase: 02-core-entities-and-views
    provides: kiosk-table.tsx and location-table.tsx with TanStack Table, kiosk/location actions with updateKioskField/updateLocationField

provides:
  - EditableCell reusable component (click-to-edit with stopPropagation, blur/Enter save, Escape revert via table.options.meta.updateField)
  - ColumnHeaderFilter reusable component (sort toggle + debounced 300ms per-column filter input)
  - Kiosk table inline editing for outletCode, regionGroup, hardwareModel, softwareVersion
  - Location table inline editing for address, hotelGroup, roomCount
  - Column header filters for kioskId, venueName, regionGroup, pipelineStageName (kiosks) and name, hotelGroup (locations)
  - TableMeta declaration merging with updateField callback pattern

affects: [phase-03-gantt-calendar, future-table-components]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TableMeta augmentation via declare module '@tanstack/react-table' with RowData generic constraint"
    - "EditableCell stopPropagation pattern — cell click stops row navigation, edit is isolated"
    - "meta.updateField callback passed from table parent to cell renderer — avoids prop drilling through column defs"
    - "ColumnHeaderFilter debounce — local state + 300ms setTimeout before column.setFilterValue"
    - "Row-level onClick removed from data rows — navigation via entity identifier link column (clean separation)"

key-files:
  created:
    - src/components/table/editable-cell.tsx
    - src/components/table/column-header-filter.tsx
  modified:
    - src/components/kiosks/kiosk-columns.tsx
    - src/components/kiosks/kiosk-table.tsx
    - src/components/locations/location-columns.tsx
    - src/components/locations/location-table.tsx

key-decisions:
  - "TableMeta declaration merging requires TData extends RowData (not object) — matches tanstack/table-core interface signature"
  - "Removed row-level onClick from data rows — navigation handled exclusively via Kiosk ID and Location Name link columns; avoids click conflict with editable cells"
  - "meta.updateField injected at table level, accessed in cells via table.options.meta — avoids passing callbacks through column def props"
  - "regionGroup shown as editable plain text (not Badge) in table — Badge rendering deferred to future enhancement"

patterns-established:
  - "Inline cell editing pattern: EditableCell component with table.options.meta.updateField callback"
  - "ColumnHeaderFilter pattern: sort toggle + filter input in single header component with e.stopPropagation to prevent TableHead sort handler conflict"

requirements-completed: [VIEW-01, VIEW-02]

# Metrics
duration: 8min
completed: 2026-03-19
---

# Phase 02 Plan 08: Inline Cell Editing and Column Header Filters Summary

**EditableCell and ColumnHeaderFilter components added to kiosk and location tables — click-to-edit non-critical fields, per-column filter inputs in headers, sort indicators, all without row-navigation regression**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-19T10:33:01Z
- **Completed:** 2026-03-19T10:41:04Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created `EditableCell` — generic TanStack Table cell component: click enters edit mode (stopPropagation prevents row navigation), blur/Enter commits via `table.options.meta.updateField`, Escape reverts
- Created `ColumnHeaderFilter` — column header with sort indicator (ChevronUp/Down/ChevronsUpDown) and debounced 300ms filter input when `column.getCanFilter()` is true
- Wired both components into kiosk table (outletCode, regionGroup, hardwareModel, softwareVersion editable; kioskId/venueName/regionGroup/pipelineStageName with header filters)
- Wired both components into location table (address, hotelGroup, roomCount editable; name/hotelGroup with header filters)
- Added `meta.updateField` to both kiosk-table and location-table calling respective server actions
- Removed row-level onClick from data rows in both tables (navigation via identifier link column)
- 19 E2E tests pass — no regression in table views, kiosk CRUD, or location CRUD

## Task Commits

Each task was committed atomically:

1. **Task 1: Create reusable EditableCell and ColumnHeaderFilter components** - `8088d55` (feat)
2. **Task 2: Wire inline editing and header filters into kiosk and location tables** - `605dbb0` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/components/table/editable-cell.tsx` - Generic inline editable cell with click-to-edit, blur/Enter save, Escape revert, TableMeta updateField integration
- `src/components/table/column-header-filter.tsx` - Column header with sort toggle and debounced per-column filter input
- `src/components/kiosks/kiosk-columns.tsx` - Updated with EditableCell on 4 fields, ColumnHeaderFilter on 4 header columns
- `src/components/kiosks/kiosk-table.tsx` - Added meta.updateField calling updateKioskField, removed row onClick
- `src/components/locations/location-columns.tsx` - Updated with EditableCell on 3 fields, ColumnHeaderFilter on 2 header columns
- `src/components/locations/location-table.tsx` - Added meta.updateField calling updateLocationField, removed row onClick

## Decisions Made
- `TableMeta` declaration merging requires `TData extends RowData` (not `object`) to match tanstack/table-core interface — TypeScript error `TS2428` identified and fixed
- Row-level onClick removed from data rows — navigation handled exclusively by the entity identifier link column (Kiosk ID and Location Name); cleaner than trying to filter click targets
- `meta.updateField` injected at the table instance level, accessed in EditableCell via `table.options.meta` — no prop drilling through column defs required
- `regionGroup` rendered as plain EditableCell text rather than Badge during editing — Badge display deferred; focus is on editability not presentation

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TableMeta declaration merging TypeScript error**
- **Found during:** Task 1 (EditableCell component creation)
- **Issue:** `declare module "@tanstack/react-table" { interface TableMeta<TData extends object>` caused TS2428 — all declarations must have identical type parameters; actual interface uses `TData extends RowData`
- **Fix:** Changed type parameter constraint from `object` to `RowData`, imported `RowData` from `@tanstack/react-table`
- **Files modified:** src/components/table/editable-cell.tsx
- **Verification:** `npx tsc --noEmit` — no errors
- **Committed in:** 8088d55 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - TypeScript type parameter bug)
**Impact on plan:** Required for correct TypeScript compilation. No scope creep.

## Issues Encountered
None beyond the TypeScript auto-fix above.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- UAT gaps 11 and 14 closed: kiosk and location tables now have inline editing for non-critical fields and header-based filters/sort
- Both EditableCell and ColumnHeaderFilter are fully generic and reusable for any future TanStack Table instances
- No regressions — existing saved views, bulk ops, CSV export, grouping, column visibility all still work
- Phase 02 plans 06 and 07 remain (UAT gap closure for other gaps)

---
*Phase: 02-core-entities-and-views*
*Completed: 2026-03-19*
