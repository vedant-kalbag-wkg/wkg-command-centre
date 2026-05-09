---
phase: 02-core-entities-and-views
plan: "07"
subsystem: ui
tags: [react, nextjs, dnd-kit, shadcn, sheet, kanban]

# Dependency graph
requires:
  - phase: 02-core-entities-and-views
    provides: KioskKanban with PointerSensor drag-to-update, KioskCard, KioskListItem type

provides:
  - KioskDetailSheet component (slide-over Sheet from right, 360px) with kiosk details and link to full detail page
  - onSelect prop on KioskCard / KioskCardContent (backwards-compatible click handler override)
  - selectedKioskId state in KioskKanban wired to KioskDetailSheet

affects:
  - Phase 03 (Gantt/Calendar) if Kanban cards are reused
  - UAT gap 16 closure

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "KioskCard onSelect prop: pass callback to override navigation — forwards to KioskCardContent only when defined, falls back to router.push (backwards compatible)"
    - "buttonVariants used directly on Link for styled anchor without asChild pattern (base-ui Button has no asChild prop)"
    - "Sheet open/onOpenChange controlled from parent state; close on Escape handled by base-ui Dialog.Root natively"

key-files:
  created:
    - src/components/kiosks/kiosk-detail-sheet.tsx
  modified:
    - src/components/kiosks/kiosk-card.tsx
    - src/components/kiosks/kiosk-kanban.tsx
    - tests/kiosks/kanban.spec.ts

key-decisions:
  - "Used buttonVariants directly on Link instead of Button asChild — base-ui/react/button has no asChild prop"
  - "onSelect prop is optional on KioskCard — when absent, falls back to router.push for backwards compatibility"
  - "KioskDetailSheet placed after ManageStagesModal (outside DndContext) to avoid portal nesting issues"

patterns-established:
  - "buttonVariants on Link: cn(buttonVariants({ variant }), 'extra-classes') — use when Button component lacks asChild"

requirements-completed: [KANBAN-01]

# Metrics
duration: 10min
completed: 2026-03-19
---

# Phase 02 Plan 07: Kiosk Detail Sheet Summary

**KioskDetailSheet slide-over component (360px, right side) wired to Kanban card click via onSelect prop — closes UAT gap 16**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-19T09:45:00Z
- **Completed:** 2026-03-19T09:55:00Z
- **Tasks:** 1
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Created KioskDetailSheet: slide-over Sheet showing kiosk ID, venue, region, pipeline stage (with color dot), outlet code, hardware model, CMS config badge, install date, and "View full details" link to `/kiosks/[id]`
- Added optional `onSelect` prop to KioskCard/KioskCardContent — overrides click to open sheet instead of navigating; drag behavior (PointerSensor distance:8) unchanged
- Wired KioskKanban with `selectedKioskId` state, `selectedKiosk` derived value, and `KioskDetailSheet` rendered below ManageStagesModal
- Added 2 new Playwright E2E tests (UAT-16): sheet opens on click, contains field labels and title, closes on Escape — all 8 kanban tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Create KioskDetailSheet component and wire into Kanban** - `7edd2d9` (feat)

**Plan metadata:** (docs commit — see final_commit step)

## Files Created/Modified
- `src/components/kiosks/kiosk-detail-sheet.tsx` - New Sheet overlay with kiosk detail fields and View full details link
- `src/components/kiosks/kiosk-card.tsx` - Added optional onSelect prop; handleClick dispatches to onSelect or router.push
- `src/components/kiosks/kiosk-kanban.tsx` - selectedKioskId state, selectedKiosk derived; KioskDetailSheet rendered; onSelect passed to KioskCard instances
- `tests/kiosks/kanban.spec.ts` - 2 UAT-16 tests for sheet open/content/close behavior

## Decisions Made
- Used `buttonVariants` directly on `<Link>` element — `@base-ui/react/button` has no `asChild` prop so the standard shadcn pattern doesn't apply
- `onSelect` prop is optional and backwards-compatible — any existing usage of KioskCard without `onSelect` continues to navigate directly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed Button asChild TypeScript error**
- **Found during:** Task 1 (KioskDetailSheet creation)
- **Issue:** Button component uses `@base-ui/react/button` which has no `asChild` prop; TS error TS2322
- **Fix:** Replaced `Button asChild` with `Link` styled via `buttonVariants()` utility — same visual result
- **Files modified:** src/components/kiosks/kiosk-detail-sheet.tsx
- **Verification:** `npx tsc --noEmit` shows no errors in modified files
- **Committed in:** 7edd2d9 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed strict mode violation in UAT-16 test**
- **Found during:** Task 1 (Playwright test authoring)
- **Issue:** `getByText("Region")` matched both stage column header "Delivered to Region" and sheet dt label "Region" — strict mode violation
- **Fix:** Added `{ exact: true }` to getByText calls for "Venue", "Region", "Stage"
- **Files modified:** tests/kiosks/kanban.spec.ts
- **Verification:** All 8 kanban tests pass
- **Committed in:** 7edd2d9 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs in implementation)
**Impact on plan:** Both fixes required for TypeScript correctness and test accuracy. No scope creep.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- UAT gap 16 (kiosk card click opens overlay) is now closed
- KioskDetailSheet pattern can be reused for other list-to-detail overlay patterns
- Remaining UAT gaps (06, 08) are in separate plan files

---
*Phase: 02-core-entities-and-views*
*Completed: 2026-03-19*
