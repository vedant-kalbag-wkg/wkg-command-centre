# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## react-state-update-error — TanStack Table autoResetPageIndex microtask triggers React strict mode warning
- **Date:** 2026-04-01
- **Error patterns:** Can't perform state update, hasn't mounted, state update on unmounted, ViewTabsClient, KioskTable, useReactTable, strict mode
- **Root cause:** TanStack Table's autoResetPageIndex calls table._queue(resetPageIndex) which schedules a Promise microtask. In React Strict Mode, the microtask fires after render but before React commits the fiber (discarded first pass), triggering "Can't perform state update on a component that hasn't mounted yet." The component stack pointing to ViewTabsClient/KioskTable is where the TanStack table fiber lives — not a Zustand/ViewToolbar issue.
- **Fix:** Add `autoResetPageIndex: false` to the `useReactTable()` config options. This disables the queued microtask entirely. Safe when pagination state is managed via `initialState` (not externally controlled).
- **Files changed:** src/components/kiosks/kiosk-table.tsx
---

## gantt-visual-issues — Missing @svar-ui/react-gantt CSS import causes blank/broken Gantt render
- **Date:** 2026-04-01
- **Error patterns:** gantt visual issues, not look right, gantt view broken, svar-ui gantt, wx-gantt, willow theme
- **Root cause:** @svar-ui/react-gantt has `sideEffects: false` so its stylesheet is never auto-injected. gantt-view.tsx had no explicit CSS import, leaving the Gantt completely unstyled — no layout, no dimensions, no visual rendering.
- **Fix:** Added `import "@svar-ui/react-gantt/style.css"` immediately after `import { Gantt, Willow } from "@svar-ui/react-gantt"` in src/components/gantt/gantt-view.tsx. The style.css export (dist/index.css) contains all component layout CSS plus Willow theme variable definitions.
- **Files changed:** src/components/gantt/gantt-view.tsx
---

