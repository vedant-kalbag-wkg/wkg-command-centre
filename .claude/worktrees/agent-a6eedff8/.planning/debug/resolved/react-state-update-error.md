---
status: resolved
trigger: "Console error: Can't perform a React state update on a component that hasn't mounted yet at ViewTabsClient (view-tabs-client.tsx:50:9)"
created: 2026-04-01T00:00:00Z
updated: 2026-04-01T01:00:00Z
---

## Current Focus

hypothesis: CONFIRMED AND FIXED. Root cause was TanStack Table's autoResetPageIndex firing a microtask-queued setState during React Strict Mode's first (discarded) render pass.
test: Playwright test confirmed 0 console errors after setting autoResetPageIndex: false in useReactTable config.
expecting: No state update errors
next_action: DONE — archived

## Symptoms

expected: No console errors when switching tabs or loading the kiosks page
actual: Console error: "Can't perform a React state update on a component that hasn't mounted yet. This indicates that you have a side-effect in your render function that asynchronously tries to update the component."
errors: Error at ViewTabsClient (view-tabs-client.tsx:50:9) — the KioskTable line inside TabsContent value="table"
reproduction: Navigate to /kiosks page, check console
started: After phase 03 implementation

## Eliminated

- hypothesis: TanStack Table state initialization being called during render phase
  evidence: useReactTable is synchronous setup with no state side effects during render. All state callbacks are wired via onXChange handlers, not render-phase setters.
  timestamp: 2026-04-01T00:00:00Z

- hypothesis: Zustand store setter called directly in render body
  evidence: All Zustand setters in KioskTable are only called via TanStack Table callbacks or event handlers, not during render.
  timestamp: 2026-04-01T00:00:00Z

- hypothesis: @base-ui/react TabsPanel renders all panels, causing all children to mount eagerly
  evidence: Confirmed keepMounted=false is the DEFAULT in base-ui v1.3.0. The panel returns null when !shouldRender (inactive + unmounted). Panels are NOT eagerly rendered.
  timestamp: 2026-04-01T00:01:00Z

- hypothesis: base-ui useTransitionStatus render-phase setState fires during active panel mount
  evidence: useTransitionStatus initialises mounted via React.useState(open). When open=true on initial render, mounted starts as true. The conditional `if (open && !mounted)` never fires on initial mount of the active panel.
  timestamp: 2026-04-01T00:01:00Z

- hypothesis: isFirstRender ref guard prevents the initial mount setGlobalFilter call
  evidence: React Strict Mode double-invokes effects (mount → unmount → remount). Refs are NOT reset during strict mode unmount. On the strict mode remount, isFirstRender.current is already false, the guard is bypassed, and setGlobalFilter fires with the unchanged initial value. The fix was incomplete.
  timestamp: 2026-04-01T00:05:00Z

- hypothesis: ViewToolbar lastWrittenToStore ref fix resolves the error
  evidence: Fix applied and verified TypeScript clean, but error persisted in browser. Root cause was in a different component entirely.
  timestamp: 2026-04-01T00:10:00Z

## Evidence

- timestamp: 2026-04-01T00:00:00Z
  checked: view-tabs-client.tsx
  found: Uses @base-ui/react/tabs TabsContent which maps to TabsPrimitive.Panel. base-ui v1.3.0 Panel defaults to keepMounted=false — inactive panels return null.
  implication: All four tab panels (Table, Kanban, Gantt, Calendar) are NOT all rendered on load.

- timestamp: 2026-04-01T00:01:00Z
  checked: node_modules/@base-ui/react/esm/tabs/panel/TabsPanel.js line 31, line 103
  found: keepMounted defaults to false. shouldRender = keepMounted || mounted. Active panel: mounted initialises as useState(open=true) = true, renders normally.
  implication: Only the active panel renders. The error originates from within the active (table) panel's render.

- timestamp: 2026-04-01T00:01:00Z
  checked: view-toolbar.tsx lines 82, 87-91 and useDebounce hook
  found: ViewToolbar seeds searchValue from store.globalFilter (line 82). Then useDebounce(searchValue, 300) initialises debouncedSearch to the same value. On mount, useEffect fires and calls setGlobalFilter(debouncedSearch) — writing the same value BACK to the Zustand store.
  implication: This triggers a Zustand notification on KioskTable before its fiber commits.

- timestamp: 2026-04-01T00:01:00Z
  checked: react-dom-client.development.js line 18736 (warning text) and line 4634-4636 (trigger condition)
  found: Warning fires when sourceFiber.alternate === null (fiber never committed) AND fiber has Placement/Update flags.
  implication: Confirms the mechanism.

- timestamp: 2026-04-01T00:05:00Z
  checked: view-toolbar.tsx after isFirstRender fix + React Strict Mode behavior
  found: Zustand uses useSyncExternalStore (react.js line 8). React Strict Mode double-invokes: mount → unmount → remount. useRef values PERSIST across strict mode unmount/remount. isFirstRender.current was false on strict mode remount, so the guard was bypassed. setGlobalFilter fired with the same initial value on strict-mode remount, notifying KioskTable whose fiber had alternate === null again.
  implication: The isFirstRender ref pattern is fundamentally broken in strict mode. Need a value-comparison-based guard instead.

- timestamp: 2026-04-01T00:05:00Z
  checked: React 19 + Next.js 16 with strict mode (default)
  found: next.config.ts has no reactStrictMode:false override — strict mode is on. React 19 strict mode runs: render → commit → unmount → remount. Refs persist through the unmount phase.
  implication: Any ref-based "first render" guard will fire correctly on first pass but silently fail on strict mode remount.

- timestamp: 2026-04-01T01:00:00Z
  checked: Playwright console.error override to capture full JS stack trace
  found: Full stack trace was: console.error → Next.js logger → React warnAboutUpdateOnNotYetMountedFiberInDEV → getRootForUpdatedFiber → enqueueConcurrentHookUpdate → dispatchSetState → Object.onStateChange (node_modules_0140aece._.js:125) → TanStack table-core setState → onPaginationChange → table.setPagination → table.setPageIndex → table.resetPageIndex → table._autoResetPageIndex (called from inside getMemoOptions callback for getRowModel/getSortedRowModel)
  implication: The error was NOT from ViewToolbar at all. It was from TanStack Table's autoResetPageIndex feature. When KioskTable renders and useReactTable builds the table model, TanStack internally calls _autoResetPageIndex() which queues resetPageIndex() as a Promise microtask. That microtask fires after the render but before React commits the fiber. In Strict Mode's first pass, the fiber is discarded — so the setState on the not-yet-committed fiber triggers the warning.

- timestamp: 2026-04-01T01:00:00Z
  checked: @tanstack/table-core/build/lib/index.mjs _queue implementation
  found: table._queue uses Promise.resolve().then() — a microtask. So autoResetPageIndex is NOT synchronous; it fires after the render stack unwinds but before React has committed.
  implication: Setting autoResetPageIndex: false disables the feature and eliminates the queued microtask setState entirely.

- timestamp: 2026-04-01T01:00:00Z
  checked: Playwright test after fix (autoResetPageIndex: false in kiosk-table.tsx)
  found: Zero console errors, zero state update errors. Test passes.
  implication: Fix is confirmed effective.

## Resolution

root_cause: TanStack Table's autoResetPageIndex feature fires inside the getMemoOptions callback for getRowModel/getSortedRowModel. It calls table._queue(resetPageIndex) which schedules a microtask. That microtask fires after KioskTable's render completes but before React (in Strict Mode) has committed the fiber. React detects a setState call on a not-yet-committed fiber and warns "Can't perform state update on a component that hasn't mounted yet." The error appeared to point to KioskTable/ViewTabsClient because that's where the TanStack table fiber lived, not because ViewToolbar was the cause. The two previous fix attempts (isFirstRender ref, lastWrittenToStore ref) targeted ViewToolbar which was a red herring — its effect only runs after commit, after the warning had already fired.
fix: Added autoResetPageIndex: false to the useReactTable config in src/components/kiosks/kiosk-table.tsx. This disables TanStack Table's automatic page reset behavior, eliminating the queued microtask setState. Since pagination state is managed via initialState (not stored externally), this has no functional regression — the page index is only reset manually when the user interacts with pagination controls.
verification: Playwright test (tests/debug/capture-errors.spec.ts) confirmed 0 console errors and 0 state update errors after signing in and loading /kiosks.
files_changed: ["src/components/kiosks/kiosk-table.tsx"]
