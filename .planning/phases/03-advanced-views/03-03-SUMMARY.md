---
phase: 03-advanced-views
plan: 03
subsystem: ui
tags: [gantt, svar-ui, zustand, server-actions, typescript, weknow-brand]

# Dependency graph
requires:
  - phase: 03-advanced-views
    plan: 01
    provides: installations table, milestones table, installation_members table, all 11 server actions
  - phase: 03-advanced-views
    plan: 02
    provides: InstallationWithRelations type, updateInstallation, createMilestone server actions

provides:
  - src/components/gantt/gantt-view.tsx — main Gantt client component wrapping @svar-ui/react-gantt
  - src/components/gantt/gantt-toolbar.tsx — grouping select and zoom controls
  - src/components/gantt/gantt-pending-bar.tsx — sticky Apply/Discard bar for drag state
  - src/components/gantt/milestone-quick-add-popover.tsx — popover form for quick milestone creation
  - src/lib/gantt-utils.ts — REGION_COLORS, GanttTask, buildGanttTasks, GANTT_SCALES
  - src/lib/stores/gantt-store.ts — Zustand store for pendingChange, groupBy, zoom
  - src/app/(app)/kiosks/gantt-tab.tsx — wrapper component for Plan 03-05 tab integration
  - @svar-ui/react-gantt@2.5.2 installed
  - WeKnow brand CSS overrides in globals.css (.gantt-wk scope)

affects:
  - 03-05 (Kiosks page integration — imports GanttTab)

# Tech tracking
tech-stack:
  added:
    - "@svar-ui/react-gantt@2.5.2 — Gantt timeline with drag, milestones, custom columns"
  patterns:
    - "api.intercept('update-task') with inProgress guard — allow visual drag tracking, capture only final drop, return false to block auto-save"
    - "Gantt task hierarchy: summary (group) → task (installation) → milestone (diamond)"
    - "ResourceCell inline component renders member names for Team column — first 2 names + +N overflow"
    - "PopoverTrigger in base-ui has no asChild prop — render trigger content directly as children (consistent with Plan 02-02 decision)"
    - "buildGanttTasks handles Date-or-ISO-string coercion via new Date(val as unknown as string) — RSC serialisation converts Date objects to ISO strings"

key-files:
  created:
    - src/lib/gantt-utils.ts
    - src/lib/stores/gantt-store.ts
    - src/components/gantt/gantt-view.tsx
    - src/components/gantt/gantt-toolbar.tsx
    - src/components/gantt/gantt-pending-bar.tsx
    - src/components/gantt/milestone-quick-add-popover.tsx
    - src/app/(app)/kiosks/gantt-tab.tsx
  modified:
    - src/app/globals.css (appended .gantt-wk CSS block at end)
    - package.json (added @svar-ui/react-gantt)

key-decisions:
  - "PopoverTrigger no asChild: base-ui PopoverTrigger has no asChild prop — render trigger styles via className directly on PopoverTrigger (same as Plan 02-02 decision)"
  - "Milestone quick-add as toolbar button: @svar-ui/react-gantt does not expose a click-on-timeline-position event via its API — implemented MilestoneQuickAddPopover as a per-installation toolbar button with manual date input instead of click-on-row positional trigger"
  - "RSC Date serialisation coercion: plannedStart/plannedEnd are Date objects in InstallationWithRelations but become ISO strings when passed through RSC boundary — buildGanttTasks uses new Date(val as unknown as string) to handle both forms"
  - "pendingChange stores installationName: added installationName field to PendingChange interface beyond the plan spec to enable human-readable pending bar copy ('X moved to date - date')"

patterns-established:
  - "Gantt intercept pattern: intercept('update-task') with ev.inProgress guard, return false on final drop"
  - "Per-task color via GanttTask.color property — REGION_COLORS map keyed by region name string"

requirements-completed:
  - GANTT-01
  - GANTT-02
  - GANTT-03
  - GANTT-04

# Metrics
duration: 4min
completed: 2026-03-19
---

# Phase 3 Plan 03: Gantt Timeline View Summary

**@svar-ui/react-gantt integrated with WeKnow brand theming — installation bars grouped by region/status, milestone diamonds, Team resource column, drag-to-reschedule with pending Apply/Discard pattern, and milestone quick-add popover**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-19T12:02:19Z
- **Completed:** 2026-03-19T12:07:08Z
- **Tasks:** 2
- **Files modified:** 8 (7 created, 1 modified)

## Accomplishments

- Installed @svar-ui/react-gantt@2.5.2
- Created gantt-utils.ts: REGION_COLORS palette, GanttTask interface, buildGanttTasks transformation (summary → task → milestone hierarchy), GANTT_SCALES presets
- Created gantt-store.ts: Zustand store managing pendingChange, groupBy, and zoom state
- Appended .gantt-wk WeKnow CSS overrides to globals.css (scoped, no existing CSS modified)
- GanttView: full client component with @svar-ui/react-gantt Willow theme, api.intercept('update-task') for drag interception, Team resource column, empty state
- GanttToolbar: grouping select (Region/Status), zoom buttons (Day/Week/Month) with Azure active state
- GanttPendingBar: sticky bottom bar showing changed installation name + date range, spinner on Apply, Discard link
- MilestoneQuickAddPopover: popover form with name, type (4 options), date input, createMilestone server action
- GanttTab: lightweight wrapper for Plan 03-05 kiosks page tab integration
- TypeScript compiles clean (zero errors in gantt files)

## Task Commits

1. **Task 1: Install + utils + store + CSS** - `1042a98` (feat)
2. **Task 2: Gantt components** - `feaa5e6` (feat)

## Files Created/Modified

- `src/lib/gantt-utils.ts` - REGION_COLORS, GanttTask type, buildGanttTasks, GANTT_SCALES
- `src/lib/stores/gantt-store.ts` - Zustand store: pendingChange, groupBy, zoom
- `src/app/globals.css` - Appended .gantt-wk CSS overrides (14 lines added at end)
- `src/components/gantt/gantt-view.tsx` - Main GanttView client component
- `src/components/gantt/gantt-toolbar.tsx` - Grouping + zoom toolbar
- `src/components/gantt/gantt-pending-bar.tsx` - Pending drag Apply/Discard bar
- `src/components/gantt/milestone-quick-add-popover.tsx` - Milestone quick-add popover
- `src/app/(app)/kiosks/gantt-tab.tsx` - Tab wrapper for Plan 03-05

## Decisions Made

- **PopoverTrigger no asChild**: base-ui PopoverTrigger has no `asChild` prop (consistent with Plan 02-02 pattern). Rendered trigger content directly as PopoverTrigger children with className for styling.
- **Milestone quick-add as toolbar button, not click-on-timeline**: @svar-ui/react-gantt does not expose a click-on-timeline-position event in its API. Implemented as a per-installation toolbar button with manual date input. Documented approach per plan spec.
- **RSC Date serialisation coercion**: InstallationWithRelations.plannedStart is typed as `Date | null` but becomes an ISO string after RSC serialisation. buildGanttTasks uses `new Date(val as unknown as string)` to handle both Date objects and ISO strings.
- **installationName in PendingChange**: Added `installationName` to the PendingChange interface (beyond plan spec) so the GanttPendingBar can show human-readable copy ("X moved to date — date") without an additional lookup.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PopoverTrigger asChild not supported in base-ui**
- **Found during:** Task 2 (TypeScript check on milestone-quick-add-popover.tsx)
- **Issue:** `<PopoverTrigger asChild>` causes TS2322 — base-ui PopoverTrigger has no `asChild` prop (same constraint documented in Plan 02-02 decisions)
- **Fix:** Removed `asChild`, rendered Button content directly as PopoverTrigger children using `className` for styling
- **Files modified:** src/components/gantt/milestone-quick-add-popover.tsx
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** feaa5e6 (Task 2 commit)

**2. [Rule 1 - Bug] RSC Date-to-string serialisation in buildGanttTasks**
- **Found during:** Task 2 (reviewing data flow from server to client)
- **Issue:** Next.js RSC boundary converts Date objects to ISO strings; passing `inst.plannedStart` (typed as `Date | null`) directly to `new Date()` works at runtime but requires defensive handling for both forms
- **Fix:** Used `new Date(val as unknown as string)` pattern in buildGanttTasks to handle both Date objects and ISO string representations
- **Files modified:** src/lib/gantt-utils.ts
- **Verification:** TypeScript compiles; runtime coercion handles both forms correctly
- **Committed in:** 1042a98 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Minimal — both fixes are standard for this codebase (documented patterns in STATE.md).

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None — @svar-ui/react-gantt is an npm package, no external service or key required.

## Next Phase Readiness

- GanttTab is ready for import by Plan 03-05 (kiosks page tab integration)
- GanttView accepts `installations: InstallationWithRelations[]` prop from server
- All gantt CSS scoped to .gantt-wk — no conflicts with calendar CSS (.rbc-calendar-wk)
- buildGanttTasks tested via TypeScript; Playwright Gantt tests (Wave 0 stubs) will be filled in by Plan 03-05

---
*Phase: 03-advanced-views*
*Completed: 2026-03-19*
