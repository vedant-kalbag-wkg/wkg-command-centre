---
status: complete
phase: 03-advanced-views
source: 03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md, 03-04-SUMMARY.md, 03-05-SUMMARY.md
started: 2026-03-19T12:45:00Z
updated: 2026-04-01T10:00:00Z
---

## Current Test

[testing complete]

## Deferred Ideas

- Add events (installations/milestones) directly from the Calendar and Gantt views — new capability
- Move Gantt and Calendar tabs from /kiosks to /installations page — better information architecture since these views are about installations, not individual kiosks

## Tests

### 1. Installations sidebar nav
expected: Sidebar shows "Installations" nav item between "Locations" and "Settings" with a CalendarClock icon. Clicking it navigates to /installations.
result: pass

### 2. Create an installation
expected: Navigate to /installations, click "Add installation" button (Azure CTA). Form shows: name (required), region, status (default Planned), planned start date, planned end date. Fill in name + dates, submit. Toast "Installation created", redirects to detail page.
result: pass

### 3. Installation detail page
expected: /installations/[id] shows two-column layout on large screens. Left: editable form with pre-filled values. Right: Milestones card and Team card stacked. "Delete installation" button visible in header.
result: pass

### 4. Add a milestone
expected: On detail page, Milestones card shows "No milestones" empty state initially. Click "Add milestone" — inline form appears with name, type select (Contract Signing, Go-Live, Review Date, Other), and target date. Submit shows toast "Milestone added" and milestone appears in list with type badge.
result: pass

### 5. Add a team member
expected: On detail page, Team card has "Add member" button. Clicking opens popover with user select and role select (Project Lead, Installer, Coordinator). Selecting and submitting adds the member to the list with role badge. X button removes them.
result: pass

### 6. Delete an installation
expected: Click "Delete installation" in header. Confirmation dialog appears: title "Delete installation?", body mentions permanent deletion and that linked kiosks won't be affected. "Delete installation" (red) and "Keep installation" buttons. Confirming deletes and redirects to /installations with toast.
result: pass

### 7. Kiosks page — four view tabs
expected: Navigate to /kiosks. Four tabs visible: Table, Kanban, Gantt, Calendar. Table is default. Clicking each tab switches the view content below.
result: issue
reported: "Gantt view does not look right at all. Hovering/clicking on the tabs has no visual indication that something is loading. The calendar also should have a semi-transparent overlay for the 'Nothing scheduled' text, rather than being over the calendar itself- it is not visually distinct"
severity: major

### 8. Tab URL routing
expected: Navigate to /kiosks?view=gantt — Gantt tab is active. Navigate to /kiosks?view=calendar — Calendar tab is active. Clicking a tab updates the URL query param without full page reload. /kiosks (no param) defaults to Table.
result: issue
reported: "Console error: Can't perform a React state update on a component that hasn't mounted yet — side-effect in render function. Error at ViewTabsClient (view-tabs-client.tsx:50:9). Next.js 16.1.7 Turbopack."
severity: major

### 9. Gantt view renders
expected: On the Gantt tab, if installations with dates exist, timeline bars appear grouped by region with collapsible group headers. Toolbar shows "Group by" select (Region/Status) and zoom buttons (Day/Week/Month). Team column visible on the left. If no installations have dates, empty state shows "No installations yet" with link to add one.
result: issue
reported: "The gantt has several visual issues — needs to be debugged using playwright-cli"
severity: major

### 10. Gantt zoom and grouping
expected: Clicking Day/Week/Month buttons changes the timeline scale. Active button has Azure background. Switching "Group by" from Region to Status re-groups the installation bars.
result: issue
reported: "Same feedback as test 9 — severe visual issues with Gantt rendering"
severity: major

### 11. Calendar view renders
expected: On the Calendar tab, month view shows by default. If installations with dates exist, coloured blocks appear spanning their date range. Milestone markers appear as diamonds. Trial expiry dots appear for kiosks with free trial end dates. If no events, empty state message shows.
result: pass

### 12. Calendar view switching and filters
expected: Month/Week/Day toggle buttons work — active button has Azure background. Filter dropdowns (Region, Status, Hotel Group) filter events client-side. "Clear filters" link appears when any filter is active.
result: pass

### 13. Calendar event popover
expected: Clicking an installation event on the calendar opens a popover/overlay showing installation name, date range, region, status badge, and a "View installation" link to /installations/[id]. Clicking outside or pressing Escape closes it.
result: pass

### 14. Installation list table
expected: /installations page shows all installations in a table with columns: Name (link to detail), Region, Status (badge — Planned grey, Active azure, Complete green), Planned Start, Planned End, Team count, Milestones count. Empty state shows "No installations yet" if none exist.
result: pass

## Summary

total: 14
passed: 10
issues: 4
pending: 0
skipped: 0

## Gaps

- truth: "Four view tabs visible and switching works with visual feedback"
  status: failed
  reason: "User reported: Gantt view does not look right at all. Hovering/clicking on the tabs has no visual indication that something is loading. The calendar also should have a semi-transparent overlay for the 'Nothing scheduled' text, rather than being over the calendar itself- it is not visually distinct"
  severity: major
  test: 7
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
- truth: "Gantt view renders correctly with installation bars, grouping, and proper layout"
  status: failed
  reason: "User reported: The gantt has several visual issues — needs to be debugged using playwright-cli"
  severity: major
  test: 9
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
- truth: "Gantt zoom and grouping controls work with correct visual rendering"
  status: failed
  reason: "User reported: Same feedback as test 9 — severe visual issues with Gantt rendering"
  severity: major
  test: 10
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
- truth: "Tab URL routing works — ?view=gantt opens Gantt, ?view=calendar opens Calendar, clicking tabs updates URL"
  status: failed
  reason: "User reported: Console error — Can't perform a React state update on a component that hasn't mounted yet. Side-effect in render function at ViewTabsClient (view-tabs-client.tsx:50:9). Next.js 16.1.7 Turbopack."
  severity: major
  test: 8
  root_cause: ""
  artifacts: []
  missing: []
  debug_session: ""
