---
phase: 02-core-entities-and-views
plan: "03"
subsystem: table-views
tags: [tanstack-table, zustand, saved-views, view-engine, toolbar, column-visibility, grouping, sorting, playwright]
dependency_graph:
  requires: ["02-01", "02-02"]
  provides: ["kiosk-table", "location-table", "view-engine-store", "saved-views", "view-toolbar"]
  affects: ["02-04", "02-05"]
tech_stack:
  added: []
  patterns:
    - "Factory createViewEngineStore: separate store instance per entity type prevents filter state bleed between /kiosks and /locations"
    - "Updater<T> pattern: store setters accept TanStack Table's Updater<T> (value or function) via resolveUpdater helper"
    - "SavedViewsBar always renders (no null guard during loading) — Save view button visible immediately"
    - "base-ui Select requires items prop for SelectValue to show label text instead of raw value"
    - "base-ui Checkbox does not support 'mixed' checked value — use boolean only"
key_files:
  created:
    - src/lib/stores/view-engine-store.ts
    - src/components/kiosks/kiosk-columns.tsx
    - src/components/kiosks/kiosk-table.tsx
    - src/components/locations/location-columns.tsx
    - src/components/locations/location-table.tsx
    - src/components/table/view-toolbar.tsx
    - src/components/table/saved-views-bar.tsx
    - src/app/(app)/kiosks/views-actions.ts
    - src/app/(app)/locations/views-actions.ts
  modified:
    - src/app/(app)/kiosks/actions.ts
    - src/app/(app)/kiosks/page.tsx
    - src/app/(app)/locations/page.tsx
    - tests/kiosks/table-view.spec.ts
    - tests/kiosks/saved-views.spec.ts
decisions:
  - "Separate useKioskViewStore and useLocationViewStore instances — Zustand stores are module singletons; factory function ensures independent state per entity"
  - "Store setters accept Updater<T> (value or function) — TanStack Table passes functional updaters; wrapping with resolveUpdater handles both cases cleanly"
  - "base-ui Select needs items prop — SelectValue renders item label via items lookup; without it, raw value string is shown"
  - "SavedViewsBar returns full JSX (not null) during loading — Save view button must be visible immediately for tests and UX"
metrics:
  duration: "~15 minutes"
  completed_date: "2026-03-19"
  tasks_completed: 2
  tasks_total: 2
  files_created: 9
  files_modified: 5
---

# Phase 02 Plan 03: TanStack Table View Engine Summary

TanStack Table v8 for kiosks and locations powered by a Zustand View Engine — with search, filter, group-by, column visibility, saved views (DB-persisted), and 10 passing Playwright E2E tests.

## What Was Built

**Task 1 — View Engine store, server actions, shared toolbar and saved views bar** (`929f48c`)
- `src/lib/stores/view-engine-store.ts`: `createViewEngineStore` factory returns separate store instances for kiosk and location. Setters accept TanStack's `Updater<T>` pattern via `resolveUpdater`. Exports `useKioskViewStore` and `useLocationViewStore`.
- `src/app/(app)/kiosks/views-actions.ts` and `src/app/(app)/locations/views-actions.ts`: Server actions for `saveView`, `listSavedViews`, `updateView`, `deleteView` — all with user ownership verification.
- `src/components/table/view-toolbar.tsx`: Search (300ms debounce, updates globalFilter), Filter popover (text/select inputs per column), Group By select (with `items` prop for correct label), Columns visibility popover (checkbox list). Export CSV placeholder (wired in Plan 02-05).
- `src/components/table/saved-views-bar.tsx`: Pill bar with view pills (click to apply), hover dropdown (Update, Delete), Save view popover with name input. Always renders Save view button regardless of loading state.
- Updated `KioskListItem` type and `listKiosks()` to include: hardwareModel, softwareVersion, cmsConfigStatus, installationDate, maintenanceFee, freeTrialStatus, pipelineStageName, pipelineStageColor, venueName.

**Task 2 — Table components and page wiring** (`fafa278`)
- `src/components/kiosks/kiosk-columns.tsx`: 13 columns — select checkbox, kiosk ID (linked, azure), outlet code, venue, region (Badge), stage (colored dot + name), CMS config (success/muted), install date, hardware, software, fee, free trial, created. Default hidden: hardware, software, fee, free trial, created.
- `src/components/kiosks/kiosk-table.tsx`: `useKioskViewStore` for all state, `useReactTable` with all row models, ViewToolbar + SavedViewsBar, group row expansion, row click navigates to `/kiosks/[id]`, pagination at 50 rows, empty states.
- `src/components/locations/location-columns.tsx`: 8 columns — select, name (linked), address, hotel group, star rating (★ icons), rooms, kiosk count, created (hidden).
- `src/components/locations/location-table.tsx`: Same pattern as kiosk table using `useLocationViewStore`.
- `src/app/(app)/kiosks/page.tsx`: Server component with Table + Kanban tabs. Table renders KioskTable with server data. Kanban is a placeholder for Plan 02-04.
- `src/app/(app)/locations/page.tsx`: Server component with Table-only tab. LocationTable with server data.
- `tests/kiosks/table-view.spec.ts`: 5 E2E tests passing (VIEW-01 × 3, VIEW-02 × 2, VIEW-03 × 1)
- `tests/kiosks/saved-views.spec.ts`: 4 E2E tests passing (VIEW-04 × 2, VIEW-05 × 2)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] base-ui Checkbox does not support 'mixed' checked value**
- **Found during:** Task 2 TypeScript compilation
- **Issue:** The plan used `table.getIsSomePageRowsSelected() ? "mixed" : false` for the select-all checkbox, but `@base-ui/react/checkbox` `checked` prop is `boolean | undefined` only — `"mixed"` is not accepted
- **Fix:** Changed to `checked={table.getIsAllPageRowsSelected()}` — simplified boolean only
- **Files modified:** src/components/kiosks/kiosk-columns.tsx, src/components/locations/location-columns.tsx

**2. [Rule 1 - Bug] Zustand store setters must accept TanStack Updater<T> pattern**
- **Found during:** Task 2 TypeScript compilation
- **Issue:** TanStack Table's `OnChangeFn<T>` passes `Updater<T>` (either `T` or `(old: T) => T`) but the store setters only accepted direct values `T`
- **Fix:** Added `resolveUpdater<T>(updater: Updater<T>, current: T): T` helper in view-engine-store.ts; all setters now accept `Updater<T>` and resolve via the helper
- **Files modified:** src/lib/stores/view-engine-store.ts

**3. [Rule 1 - Bug] base-ui Select requires items prop for SelectValue label display**
- **Found during:** Task 2 visual verification — Group By showed raw `"__none__"` instead of "No grouping"
- **Issue:** base-ui `SelectPrimitive.Root` needs `items` prop to map values to labels for `SelectValue` display (same as InlineEditField bug from Plan 02-01)
- **Fix:** Added `items={[{ value: "__none__", label: "No grouping" }, ...groupableColumns.map(c => ({ value: c.id, label: c.label }))]}` to the Select root in view-toolbar.tsx
- **Files modified:** src/components/table/view-toolbar.tsx

**4. [Rule 3 - Blocking] base-ui Popover/Dropdown Trigger does not support asChild prop**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** Used `asChild` pattern from Radix UI but this project uses base-ui which uses `render={}` prop instead
- **Fix:** Replaced `asChild` pattern with `render={<button ... />}` pattern matching the base-ui API (same pattern as user-table.tsx)
- **Files modified:** src/components/table/view-toolbar.tsx, src/components/table/saved-views-bar.tsx

**5. [Rule 1 - Bug] SavedViewsBar returned null during loading, hiding Save view button**
- **Found during:** Task 2 Playwright run — "Save view" button not found
- **Issue:** `if (loading) return null` meant the entire bar including Save view button was hidden until server action fetch completed
- **Fix:** Removed early return; loading state only gates the views list (pills), Save view button always renders
- **Files modified:** src/components/table/saved-views-bar.tsx

## Self-Check: PASSED
