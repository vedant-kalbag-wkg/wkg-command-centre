# Phase 3 UAT Diagnosis Handoff

**Date:** 2026-04-01
**Branch:** `gsd/phase-03-advanced-views`
**UAT file:** `.planning/phases/03-advanced-views/03-UAT.md`
**Dev server:** `npm run dev -- -p 3003` (port 3000 is used by data-dashboard)

## Summary

Phase 3 (Advanced Views) UAT completed with **10 passed, 4 issues**. All Installation CRUD tests passed. Issues are concentrated in the Gantt view rendering and the ViewTabsClient integration.

## Issues Requiring Diagnosis

### Issue 1: Gantt view — severe visual issues (Tests 7, 9, 10)

**What's wrong:** The Gantt view "does not look right at all" with "severe visual issues." The user did not specify exact details but requested diagnosis using playwright-cli.

**Diagnosis steps:**
1. Start dev server: `npm run dev -- -p 3003`
2. Use `playwright-cli` to open `http://localhost:3003/kiosks?view=gantt` with `--browser=chromium`
3. Screenshot the Gantt tab — compare against expected layout:
   - Toolbar with "Group by" select + Day/Week/Month zoom buttons
   - Timeline area with installation bars grouped by region
   - Team column on the left side
   - Milestone diamond markers on bars
4. Check browser console for errors
5. Inspect @svar-ui/react-gantt CSS — the `.gantt-wk` scoped overrides in `src/app/globals.css` may be conflicting or insufficient
6. Check if the Willow theme CSS is being loaded (import from @svar-ui/react-gantt)

**Key files:**
- `src/components/gantt/gantt-view.tsx` — main component
- `src/components/gantt/gantt-toolbar.tsx` — toolbar controls
- `src/lib/gantt-utils.ts` — data transformation (buildGanttTasks)
- `src/app/globals.css` — `.gantt-wk` CSS overrides (near end of file)

**Likely root causes:**
- Missing @svar-ui/react-gantt CSS import (Willow theme)
- `.gantt-wk` overrides insufficient or conflicting with library defaults
- buildGanttTasks producing malformed hierarchy (summary → task → milestone)
- Container height/overflow issues

### Issue 2: Tab hover/loading state (Test 7)

**What's wrong:** Hovering or clicking on Gantt/Calendar tabs has no visual indication that content is loading. The tab switch feels unresponsive.

**Diagnosis steps:**
1. Navigate to `/kiosks` and click between tabs — observe transition
2. Check if `TabsTrigger` has hover/active styles
3. Check if heavy components (GanttView, CalendarView) cause a visible delay with no loading indicator

**Key files:**
- `src/app/(app)/kiosks/view-tabs-client.tsx` — tab switching logic
- Tab component styles (check if base-ui Tabs has built-in hover states)

**Fix direction:** Add a loading skeleton or Suspense boundary around Gantt/Calendar tab content. Add hover/active styles to TabsTrigger if missing.

### Issue 3: Calendar empty state overlay (Test 7)

**What's wrong:** The "Nothing scheduled for this period" text sits directly on the calendar grid rather than in a semi-transparent overlay. It's not visually distinct from the calendar itself.

**Diagnosis steps:**
1. Navigate to `/kiosks?view=calendar` with no installations that have dates
2. Screenshot the empty state
3. Check `src/components/calendar/calendar-view.tsx` for empty state rendering

**Key file:** `src/components/calendar/calendar-view.tsx`

**Fix direction:** Wrap the empty state in a semi-transparent backdrop overlay positioned over the calendar container (e.g., `absolute inset-0 bg-white/80 flex items-center justify-center`).

### Issue 4: ViewTabsClient React state update error (Test 8)

**What's wrong:** Console error: "Can't perform a React state update on a component that hasn't mounted yet. This indicates that you have a side-effect in your render function that asynchronously tries to update the component."

Error at `ViewTabsClient (view-tabs-client.tsx:50:9)` which is the `<KioskTable>` line inside `<TabsContent value="table">`.

**Diagnosis steps:**
1. Read `src/app/(app)/kiosks/view-tabs-client.tsx`
2. Check if KioskTable, KioskKanban, GanttTab, or CalendarTab trigger state updates during render (e.g., Zustand store writes in render path, or useEffect with immediate setState)
3. Check if the controlled `Tabs value={activeView}` causes a render-time state conflict with child components
4. Test with React strict mode disabled to confirm it's a real issue vs strict mode double-render

**Key files:**
- `src/app/(app)/kiosks/view-tabs-client.tsx:50` — error location
- `src/components/kiosks/kiosk-table.tsx` — the component at the error line
- `src/lib/stores/view-engine-store.ts` — Zustand stores that may write during render

**Likely root cause:** A Zustand store setter or TanStack Table state initialization is being called during the render phase rather than inside a useEffect.

## Deferred Ideas (from UAT feedback)

These are NOT bugs — they are feature requests noted during testing:

1. **Add events from Calendar/Gantt** — ability to create installations/milestones directly from the Calendar or Gantt views (currently requires navigating to /installations/new)
2. **Move Gantt/Calendar to /installations page** — user noted these views are about installations, not individual kiosks, so /installations is a more natural home

## How to Resume

```bash
# Start diagnosis
/clear
/gsd:debug 03

# Or manually:
# 1. Start dev server
npm run dev -- -p 3003

# 2. Use playwright-cli to screenshot issues
# playwright-cli open --browser=chromium http://localhost:3003/kiosks?view=gantt

# 3. After diagnosis, plan fixes
/gsd:plan-phase 03 --gaps
```
