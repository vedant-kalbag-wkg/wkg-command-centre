---
status: awaiting_human_verify
trigger: "Tab hover/loading state — no visual indication on hover or when switching to heavy tabs"
created: 2026-04-01T00:00:00Z
updated: 2026-04-01T00:00:00Z
---

## Current Focus

hypothesis: Two distinct problems: (1) TabsTrigger in line variant is missing a hover background style so there is no visible hover state; (2) ViewTabsClient has no loading indicator for tab switches — the Gantt/Calendar components render synchronously but with perceived latency due to JS weight.
test: Inspect TabsTrigger className in tabs.tsx — confirm no hover:bg-* on line variant. Confirm no Suspense or loading state in view-tabs-client.tsx.
expecting: Both problems confirmed by reading the source.
next_action: Apply fix — add hover style to TabsTrigger line variant AND add useTransition-based pending state + skeleton to ViewTabsClient.

## Symptoms

expected: Visual feedback when hovering over tabs and a loading indicator when switching to heavy tabs (Gantt, Calendar)
actual: No hover/active styles on tabs, no loading indicator when switching to heavy views
errors: None
reproduction: Navigate to /kiosks and click between tabs — observe transition
started: After phase 03 implementation

## Eliminated

- hypothesis: TabsTrigger base hover style missing entirely
  evidence: `hover:text-foreground` IS present in the shared className. The issue is only that the line variant has no hover *background* — the text color change is subtle and can feel like no feedback.
  timestamp: 2026-04-01T00:00:00Z

## Evidence

- timestamp: 2026-04-01T00:00:00Z
  checked: src/components/ui/tabs.tsx — TabsTrigger className
  found: Line variant overrides bg to transparent (`group-data-[variant=line]/tabs-list:bg-transparent`) even on active, but there is NO hover:bg-* rule for the line variant. Only `hover:text-foreground` exists as a hover style. This is a very subtle colour shift — feels like no hover feedback.
  implication: Adding a subtle hover bg for the line variant will make tabs feel responsive.

- timestamp: 2026-04-01T00:00:00Z
  checked: src/app/(app)/kiosks/view-tabs-client.tsx — tab switching
  found: handleTabChange calls router.push immediately. No useTransition, no useState for pending, no Suspense boundary, no skeleton around GanttTab or CalendarTab.
  implication: When clicking Gantt or Calendar the UI just freezes briefly while the heavy component mounts. Need useTransition + isPending state to show a spinner or skeleton.

- timestamp: 2026-04-01T00:00:00Z
  checked: @base-ui/react tabs Panel data attributes
  found: TabsPanel exposes `data-hidden`, `data-starting-style`, `data-ending-style`. No built-in loading state — loading indication must come from the component consumer.
  implication: Must implement loading state manually in ViewTabsClient via React useTransition.

- timestamp: 2026-04-01T00:00:00Z
  checked: gantt-tab.tsx, calendar-tab.tsx
  found: Both are thin wrappers — GanttTab renders GanttView directly (heavy: @svar-ui/react-gantt), CalendarTab renders CalendarView (heavy: react-big-calendar). No lazy loading.
  implication: useTransition in ViewTabsClient will mark tab switch as a transition, keeping old content visible while new tab mounts, then show spinner overlay during isPending.

## Resolution

root_cause: (1) TabsTrigger line variant has no hover background style — only a text colour shift which is imperceptible. (2) ViewTabsClient has no React transition or loading indicator — heavy tab switches (Gantt, Calendar) appear unresponsive.
fix: (1) Add `hover:bg-accent/50` to the line variant override in TabsTrigger. (2) Wrap router.push in useTransition in ViewTabsClient and show a subtle loading overlay (spinner) inside TabsContent during isPending.
verification: TypeScript clean. Both files verified by read-back. Awaiting browser confirmation.
files_changed:
  - src/components/ui/tabs.tsx
  - src/app/(app)/kiosks/view-tabs-client.tsx
