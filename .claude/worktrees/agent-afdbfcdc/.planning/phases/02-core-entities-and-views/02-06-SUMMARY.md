---
phase: 02-core-entities-and-views
plan: 06
subsystem: ui
tags: [layout, viewport, saved-views, key-contacts, ux]

requires:
  - phase: 02-core-entities-and-views
    provides: SavedViewsBar component and KeyContactsEditor component from plans 02-04 and 02-03

provides:
  - Viewport-constrained app layout (h-dvh) — page content never overflows
  - Save view button pinned outside scrollable pills area — always accessible
  - Key contacts editor saves on blur only — no mid-type server round-trips

affects:
  - 02-07 (UAT gap closure — these fixes are dependencies for gap verification)
  - 02-08 (UAT gap closure — viewport fix affects all pages)

tech-stack:
  added: []
  patterns:
    - "h-dvh wrapper on SidebarProvider constrains viewport so AppShell flex-1 + overflow-auto scrolls internally"
    - "Two-sibling layout for scrollable + pinned-button bars: flex-1 overflow-x-auto + shrink-0 sibling"
    - "contactsRef pattern for stale-closure-safe blur handlers in React"

key-files:
  created: []
  modified:
    - src/app/(app)/layout.tsx
    - src/components/table/saved-views-bar.tsx
    - src/components/locations/key-contacts-editor.tsx

key-decisions:
  - "Used h-dvh (not h-screen) on layout wrapper — dvh handles mobile viewport with address bar correctly"
  - "Save view button is a flex sibling of the scrollable div (not a child inside it) — this is the key structural change for pinning"
  - "contactsRef.current = contacts assigned inline each render — ensures blur handler always reads latest state without needing contacts in useCallback deps"
  - "Debounce increased from 500ms to 1000ms for blur-based saves — blur fires less frequently than keystrokes so longer window is safe"
  - "isSaving removed from Input disabled prop — saves happen in background, form stays interactive"

patterns-established:
  - "Blur-based persistence: updateField only calls setContacts; onBlur fires persist via ref-based handler"
  - "Pinned button outside scroll: flex container with flex-1 overflow-x-auto child + shrink-0 sibling button"

requirements-completed: [VIEW-03, LOC-03]

duration: 15min
completed: 2026-03-19
---

# Phase 02 Plan 06: UAT Gap Closure (Viewport, Save View Pin, Key Contacts Blur)

**Three targeted layout and UX fixes closing UAT gaps 2, 8, and 13: viewport overflow constrained with h-dvh, save view button pinned outside scrollable pills, and key contacts saving on blur instead of every keystroke**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-19T10:22:00Z
- **Completed:** 2026-03-19T10:38:21Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- App layout now constrained to viewport height — Add Kiosk button and page controls always accessible without page scroll
- SavedViewsBar restructured so Save view button is always visible regardless of pill count — pills scroll horizontally in their own overflow container
- KeyContactsEditor now only saves to server on field blur — no 500ms debounce firing on every keystroke, form never locks during background saves

## Task Commits

1. **Task 1: Fix viewport overflow — add h-dvh to app layout** - `db20f7a` (fix)
2. **Task 2: Pin save view button outside scrollable pills area** - `f7c6ba8` (fix)
3. **Task 3: Fix key contacts editor to save on blur instead of each keystroke** - `211cff2` (fix)

## Files Created/Modified

- `src/app/(app)/layout.tsx` - Added `<div className="h-dvh">` wrapper around SidebarProvider
- `src/components/table/saved-views-bar.tsx` - Restructured to two-sibling layout: scrollable pills div + pinned Save view button
- `src/components/locations/key-contacts-editor.tsx` - Removed persist from updateField; added contactsRef + handleBlur; onBlur on all four inputs; removed isSaving from disabled; debounce 500→1000ms

## Decisions Made

- Used `h-dvh` rather than `h-screen` — dvh correctly handles mobile viewports where address bar shrinks available height
- Changed `PopoverContent align` from `"start"` to `"end"` for Save view button since it's now on the right side
- Kept `isSaving` state and the "Saving…" indicator visible in the footer — only removed it from Input disabled state

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — test files were located at `tests/kiosks/` and `tests/locations/` (not `tests/e2e/` as in the plan's verify commands). All tests passed on first run after each change.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- UAT gaps 2, 8, and 13 are now closed
- Ready for plans 02-07 and 02-08 to close remaining UAT gaps
- All existing Playwright tests continue to pass (8 kiosk CRUD, 4 saved views, 5 location CRUD)

## Self-Check: PASSED

All three modified files exist. All three task commits verified present (db20f7a, f7c6ba8, 211cff2). SUMMARY.md created. STATE.md, ROADMAP.md updated.

---
*Phase: 02-core-entities-and-views*
*Completed: 2026-03-19*
