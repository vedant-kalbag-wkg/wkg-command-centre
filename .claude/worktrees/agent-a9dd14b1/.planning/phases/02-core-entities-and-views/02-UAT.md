---
status: resolved
phase: 02-core-entities-and-views
source: [02-00-SUMMARY.md, 02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md, 02-04-SUMMARY.md, 02-05-SUMMARY.md]
started: 2026-03-19T07:15:00Z
updated: 2026-03-19T12:00:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running dev server. Start the application fresh with `npm run dev`. Server boots without errors, database connects, and the app loads in the browser showing the sidebar navigation and main content area.
result: pass

### 2. Create a New Kiosk
expected: Navigate to /kiosks, click "New Kiosk" or equivalent button. Fill in kiosk fields (ID, outlet code, region, hardware model, etc.) and submit. Redirected to the new kiosk's detail page showing all entered data.
result: issue
reported: "The entire page does not fit on one screen- I needed to scroll to find the add kiosk button. Otherwise it is functional"
severity: minor

### 3. Inline Edit Kiosk Fields
expected: On a kiosk detail page, click on a field value (e.g., outlet code or region). It transforms into an editable input. Change the value, blur or Tab away. The field saves and displays the updated value without page reload.
result: pass

### 4. Archive a Kiosk
expected: On a kiosk detail page, click Archive button. A confirmation dialog appears. Confirm archive. Kiosk is soft-deleted and no longer appears in the default kiosk list.
result: pass

### 5. Assign Kiosk to a Location
expected: On a kiosk detail page, use the venue assignment dialog to assign the kiosk to a location. The assignment appears in the detail page. Assignment history shows the current and past assignments with dates.
result: pass

### 6. Create a New Location
expected: Navigate to /locations, click "New Location". Fill in location fields (name, address, hotel group, star rating, rooms, etc.) and submit. Redirected to the new location's detail page showing all entered data.
result: pass

### 7. Inline Edit Location Fields
expected: On a location detail page, click on a field value. It transforms into an editable input. Change the value, blur or Tab away. The field saves and displays the updated value.
result: pass

### 8. Key Contacts Editor
expected: On a location detail page, find the Key Contacts section. Add a new contact with name, role, email, phone. The contact row appears. Add another. Remove one. Changes auto-save (debounced).
result: issue
reported: "It saves after each field which is rather annoying. Lets have it save in the background while I still edit, or only after I click Add"
severity: minor

### 9. Banking Details RBAC
expected: As an admin user, banking details section shows editable fields with a Save button. The banking form saves successfully when submitted.
result: pass

### 10. Location Kiosks Tab
expected: On a location detail page, click the "Kiosks" tab. A table shows kiosks assigned to this location with Kiosk ID, Status (current/historical), Assigned Date, and Unassigned Date.
result: pass

### 11. Kiosk Table View with Search and Filters
expected: Navigate to /kiosks. The Table tab shows a TanStack Table with columns (Kiosk ID, Outlet Code, Venue, Region, Stage, etc.). Type in the search box — rows filter by the search term. Open filter popover — filter by a column value. Results update accordingly.
result: issue
reported: "Pass, but I want the table to be more interactive- all tables should allow for non-critical info to be edited directly in the table, and filters/sort should happen from the table header"
severity: minor

### 12. Column Visibility and Group By
expected: In the kiosk table, open the Columns popover — toggle a column off (e.g., Hardware). The column disappears from the table. Select a Group By option (e.g., Region). Rows group under region headers with expand/collapse.
result: pass

### 13. Save and Load a View
expected: Configure the kiosk table (apply a filter or hide a column). Click "Save view", enter a name, save. The view appears as a pill in the saved views bar. Click another view pill or reset, then click your saved view pill — the table restores to the saved configuration.
result: issue
reported: "The save view button is obscured and I cannot go through the process"
severity: major

### 14. Location Table View
expected: Navigate to /locations. A table shows locations with columns (Name, Address, Hotel Group, Star Rating, Rooms, Kiosk Count). Search and filter work the same as kiosk table.
result: issue
reported: "pass, same feedback as kiosk table — tables should allow inline editing and filters/sort from table header"
severity: minor

### 15. Kanban Board View
expected: On /kiosks, click the "Kanban" tab. A Kanban board appears with columns for each pipeline stage (Prospect, Active, etc.). Kiosk cards show in their respective stage columns with kiosk ID, venue name, region badge.
result: pass

### 16. Drag Kiosk Card to Change Stage
expected: On the Kanban board (with Pipeline Stage grouping), drag a kiosk card from one stage column to another. The card moves optimistically. After drop, the kiosk's pipeline stage is updated (verify by refreshing or checking detail page).
result: issue
reported: "Clicking the card does not open an overlay with the kiosk info"
severity: minor

### 17. Kanban Grouping Switcher
expected: On the Kanban board, change the grouping from "Pipeline Stage" to "Region" or "Hotel Group". Columns re-organize by the selected grouping. An info banner appears saying drag-to-update only works with stage grouping.
result: pass

### 18. Manage Pipeline Stages
expected: From settings or the Kanban board, open the Manage Stages modal. See the list of pipeline stages with colors. Rename a stage inline. Drag to reorder. Change a stage's color via color picker. Changes persist after closing and reopening the modal.
result: pass

### 19. Bulk Select and Edit Kiosks
expected: In the kiosk table, select multiple rows via checkboxes. A bulk toolbar appears at the bottom with count of selected items. Choose a bulk edit field (e.g., Region), enter a new value, apply. All selected kiosks update to the new value.
result: pass

### 20. Bulk Archive
expected: In the kiosk table, select multiple rows. In the bulk toolbar, click Archive. A confirmation dialog shows the count. Confirm. All selected kiosks are archived and disappear from the default list.
result: pass

### 21. CSV Export
expected: In the kiosk table, click the CSV export button (in the toolbar or bulk toolbar). A CSV file downloads with the table data including headers matching visible columns. Open the file — data is correct and readable.
result: pass

### 22. Per-Record Audit Timeline
expected: On a kiosk or location detail page, click the "Audit" tab. An audit timeline shows logged actions (create, update, archive, assign) grouped by day, with actor initials, relative timestamps, and action descriptions.
result: pass

### 23. Global Admin Audit Log
expected: Navigate to /settings/audit-log (as admin). A table shows all audit entries across the system. Filter by user, entity type, or date range. Click "Load more" for cursor-based pagination. Entries show linked record names.
result: pass

## Summary

total: 23
passed: 17
issues: 6
pending: 0
skipped: 0

## Gaps

- truth: "New Kiosk button is accessible without scrolling on the kiosks list page"
  status: resolved
  reason: "User reported: The entire page does not fit on one screen- I needed to scroll to find the add kiosk button. Otherwise it is functional"
  severity: minor
  test: 2
  root_cause: "AppShell content area overflow-auto doesn't constrain to viewport height — parent layout missing h-screen, so flex-1 expands with content instead of making content scroll internally"
  artifacts:
    - path: "src/components/layout/app-shell.tsx"
      issue: "Content area flex-1 p-6 overflow-auto depends on parent height constraint that doesn't exist"
    - path: "src/components/kiosks/kiosk-table.tsx"
      issue: "Table renders at natural height with pageSize:50, easily exceeding viewport"
  missing:
    - "Add h-screen or h-dvh to root layout container wrapping AppShell so overflow-auto constrains properly"
  debug_session: ""
- truth: "Tables allow inline editing of non-critical fields directly in the table, with filters/sort accessible from table headers"
  status: resolved
  reason: "User reported: Pass, but I want the table to be more interactive- all tables should allow for non-critical info to be edited directly in the table, and filters/sort should happen from the table header"
  severity: minor
  test: 11
  root_cause: "Tables designed as read-only navigation surfaces — all cell renderers return static JSX, row onClick navigates to detail page, and sort/filter controls live in external ViewToolbar popover instead of column headers"
  artifacts:
    - path: "src/components/kiosks/kiosk-columns.tsx"
      issue: "All cell renderers are read-only JSX, no editCell or editable state"
    - path: "src/components/kiosks/kiosk-table.tsx"
      issue: "Row onClick navigates to detail page (line 282), no cell-level click for edit mode"
    - path: "src/components/table/view-toolbar.tsx"
      issue: "Filter is a popover with draft/apply flow, not integrated into column headers"
  missing:
    - "Add inline cell editing for non-critical fields using TanStack Table meta callbacks"
    - "Move per-column filter inputs into header cells"
    - "Replace row-level onClick with cell-level click discrimination"
  debug_session: ""
- truth: "Save view button is visible and accessible to complete the save view workflow"
  status: resolved
  reason: "User reported: The save view button is obscured and I cannot go through the process"
  severity: major
  test: 13
  root_cause: "SavedViewsBar container uses overflow-x-auto with scrollbar-hide, causing the Save view button at the end of the flex row to scroll off-screen when saved view pills occupy horizontal space — with hidden scrollbar, users cannot discover or reach the button"
  artifacts:
    - path: "src/components/table/saved-views-bar.tsx"
      issue: "Line 162: root div applies overflow-x-auto and scrollbar-hide, all content in single horizontal flex row"
    - path: "src/components/table/saved-views-bar.tsx"
      issue: "Lines 222-233: Save view button has shrink-0 but gets pushed off right edge"
  missing:
    - "Pull Save view button outside the scrollable area — pills scroll, button stays pinned"
  debug_session: ""
- truth: "Location table allows inline editing and has filters/sort in table headers (same as kiosk table feedback)"
  status: resolved
  reason: "User reported: pass, same feedback as kiosk table — tables should allow inline editing and filters/sort from table header"
  severity: minor
  test: 14
  root_cause: "Same root cause as test 11 — location table uses identical read-only pattern with external toolbar filters"
  artifacts:
    - path: "src/components/locations/location-columns.tsx"
      issue: "All cells are display-only"
    - path: "src/components/locations/location-table.tsx"
      issue: "Row onClick navigates, no inline editing"
  missing:
    - "Same fix as test 11 — add inline editing and header-based filters to location table"
  debug_session: ""
- truth: "Clicking a kiosk card on the Kanban board opens an overlay with kiosk info"
  status: resolved
  reason: "User reported: Clicking the card does not open an overlay with the kiosk info"
  severity: minor
  test: 16
  root_cause: "KioskCardContent onClick handler calls router.push(/kiosks/[id]) for full page navigation — no overlay/popover/sheet component exists"
  artifacts:
    - path: "src/components/kiosks/kiosk-card.tsx"
      issue: "Line 50: onClick hardcoded to router.push, no overlay logic"
    - path: "src/components/kiosks/kiosk-kanban.tsx"
      issue: "No overlay, dialog, or sheet component for kiosk detail"
  missing:
    - "Create kiosk detail overlay component (Sheet/Drawer)"
    - "Add selectedKioskId state in kiosk-kanban.tsx"
    - "Replace router.push with onSelect callback prop on card"
  debug_session: ""
- truth: "Key contacts editor saves only after clicking Add or in the background, not after each field change"
  status: resolved
  reason: "User reported: It saves after each field which is rather annoying. Lets have it save in the background while I still edit, or only after I click Add"
  severity: minor
  test: 8
  root_cause: "updateField calls persist() on every keystroke with only 500ms debounce, and inputs are disabled during isSaving — causing multiple server round-trips and janky form locking mid-typing"
  artifacts:
    - path: "src/components/locations/key-contacts-editor.tsx"
      issue: "Line 61: persist(updated) called inside updateField on every onChange"
    - path: "src/components/locations/key-contacts-editor.tsx"
      issue: "Lines 106/120/126/130: inputs disabled={disabled || isSaving} locks form during save"
  missing:
    - "Remove auto-persist from updateField — field changes should only update local state"
    - "Switch to onBlur-based persist or add explicit Save button"
    - "Remove isSaving from input disabled prop — saving should not lock the form"
  debug_session: ""
