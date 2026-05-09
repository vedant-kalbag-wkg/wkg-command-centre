---
status: resolved
trigger: "The Gantt view has severe visual issues — it does not look right at all."
created: 2026-04-01T08:04:00Z
updated: 2026-04-01T08:20:00Z
---

## Current Focus

hypothesis: The @svar-ui/react-gantt CSS stylesheet is never imported, so the Gantt renders with zero library styling.
test: Add `import "@svar-ui/react-gantt/style.css"` to gantt-view.tsx and verify the Gantt renders correctly.
expecting: Gantt chart renders with proper layout, grid columns, timeline bars, and milestone diamonds.
next_action: Apply CSS import fix to gantt-view.tsx

## Symptoms

expected: A properly rendered Gantt chart with toolbar (Group by + Day/Week/Month zoom), timeline bars grouped by region, Team column on left, milestone diamond markers on bars.
actual: Gantt view has "severe visual issues" — layout/rendering is broken
errors: None specified
reproduction: Navigate to /kiosks?view=gantt
started: After phase 03 implementation

## Eliminated

- hypothesis: Missing @svar-ui/react-gantt CSS import is not the cause
  evidence: Confirmed it IS the cause — unlike calendar-view.tsx which imports "react-big-calendar/lib/css/react-big-calendar.css", gantt-view.tsx has NO CSS import from the @svar-ui/react-gantt package
  timestamp: 2026-04-01T08:08:00Z

- hypothesis: buildGanttTasks produces malformed hierarchy
  evidence: Code reads cleanly — summary -> task -> milestone hierarchy is correct, parent IDs chain correctly
  timestamp: 2026-04-01T08:08:00Z

- hypothesis: .gantt-wk CSS overrides are conflicting
  evidence: Overrides are well-scoped and minimal; cannot cause layout breakage without base styles
  timestamp: 2026-04-01T08:09:00Z

## Evidence

- timestamp: 2026-04-01T08:06:00Z
  checked: globals.css - all @import statements
  found: Only imports tailwindcss, tw-animate-css, shadcn/tailwind.css — no @svar-ui CSS
  implication: The Gantt library CSS is never loaded

- timestamp: 2026-04-01T08:06:00Z
  checked: src/components/calendar/calendar-view.tsx
  found: Has `import "react-big-calendar/lib/css/react-big-calendar.css"` at the top
  implication: Calendar has its CSS, Gantt does not — inconsistency confirms the missing import

- timestamp: 2026-04-01T08:07:00Z
  checked: src/components/gantt/gantt-view.tsx - all imports
  found: No CSS import whatsoever — only JS/TS imports
  implication: The entire Gantt stylesheet is absent

- timestamp: 2026-04-01T08:08:00Z
  checked: @svar-ui/react-gantt/package.json exports
  found: CSS is exported as "./style.css" -> dist/index.css (also ./all.css -> dist-full/index.css)
  implication: Must explicitly import "@svar-ui/react-gantt/style.css" — package has sideEffects:false so no auto-injection

- timestamp: 2026-04-01T08:09:00Z
  checked: @svar-ui/react-gantt/dist/index.css content
  found: Contains all component layout CSS + theme CSS variables (.wx-willow-theme class sets Willow-specific vars)
  implication: The Willow wrapper component adds the wx-willow-theme class, but the class definition itself lives in the CSS that was never imported

- timestamp: 2026-04-01T08:09:00Z
  checked: @svar-ui/react-gantt/readme.md usage example
  found: README shows `import "@svar-ui/react-gantt/all.css"` as the canonical usage
  implication: Confirms explicit CSS import is required

## Resolution

root_cause: The @svar-ui/react-gantt library CSS is never imported in gantt-view.tsx. The package has `sideEffects: false` so CSS is not auto-injected. Without it, none of the Gantt component layout, dimensions, or visual styling applies — the chart renders as raw unstyled HTML. The `Willow` wrapper component sets the `wx-willow-theme` CSS class but its variable definitions exist only inside the missing stylesheet.
fix: Added `import "@svar-ui/react-gantt/style.css"` on line 5 of gantt-view.tsx, immediately after the existing `import { Gantt, Willow } from "@svar-ui/react-gantt"` import.
verification: Playwright test passed — .wx-gantt element visible, .wx-layout height > 100px, screenshot confirms toolbar + timeline + grouped installation rows render correctly.
files_changed: ["src/components/gantt/gantt-view.tsx"]
