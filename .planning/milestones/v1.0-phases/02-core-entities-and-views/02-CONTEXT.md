# Phase 2: Core Entities and Views - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Kiosk and Location CRUD with all fields, Table view with TanStack Table (filter/sort/group/column-visibility), Kanban board with dnd-kit (drag between pipeline stages), View Engine with saveable custom views, bulk operations, CSV export, audit log UI, and admin-configurable pipeline stage management.

</domain>

<decisions>
## Implementation Decisions

### Record Detail Pages
- Full detail page navigation — click table row or kanban card navigates to `/kiosks/[id]` or `/locations/[id]`
- Inline editing — click a field value to edit in place, saves on blur/Enter (Linear/Notion style)
- Creating new records uses the same full detail page layout at `/kiosks/new` or `/locations/new` with all sections expanded and a "Create" button
- Soft delete with archive — delete shows confirmation dialog, record is archived (not permanently deleted), hidden from default views but visible via filter
- Kiosk detail page tabs: **Details** + **Audit** (2 tabs). Assignments are inline in the Details tab, not a separate tab
- Location detail page tabs: **Details** + **Kiosks** + **Audit** (3 tabs)

### Kiosk Detail Page — Field Sections
- Tabbed sections with collapsible groups on the Details tab
- Field groups: **Identity** (kiosk ID, outlet code, customer codes), **Hardware & Software** (model, serial, software version, CMS config status), **Deployment** (install date, deployment phase tags, region/location group, current venue + assignment history), **Billing** (maintenance fee, free trial status/end date)
- Venue assignment shown inline in Deployment section with a "Reassign" button
- Assignment history is a collapsible sub-section within Deployment showing timeline of past venues with dates and reasons

### Location Detail Page — Field Sections
- Same tabbed/collapsible pattern as kiosk detail
- Field groups: **Info** (name, address, lat/long, star rating, room count, hotel group, sourced-by), **Key Contacts** (JSONB array with name, role, email, phone), **Contract** (structured fields: start date, end date, value, terms + file attachment list with upload), **Banking** (JSONB, restricted to admin/member roles)
- Contract section shows structured fields inline plus a document file list with upload button below
- Banking and Contract sections show lock icon and are redacted for Viewer role (decided in Phase 1)
- Kiosks tab shows all kiosks currently and historically assigned to this location

### View Tabs
- Kiosks page shows view type tabs: **Table** and **Kanban** (only these two in Phase 2)
- Table is always the default landing view — no "remember last view" behavior
- Gantt and Calendar tabs are **hidden until built** in Phase 3 (no disabled/coming-soon placeholders)

### Kanban Board
- Compact cards showing: **Kiosk ID**, **venue name**, **region badge**, **CMS config status indicator**
- Switchable grouping — default columns are pipeline stages, user can switch to group by region, hotel group, etc.
- Drag-and-drop only enabled when grouped by pipeline stage — dragging updates the kiosk's stage
- When grouped by other fields (region, hotel group): drag is disabled, view is read-only with a message to switch to stage grouping for drag
- Column headers show: **colored dot** (from pipeline stage color) + **stage name** + **card count**
- Click card navigates to full detail page (no popover/preview)
- No filter bar on Kanban — filtering is a table view concern; Kanban shows all kiosks

### Pipeline Stage Management
- Managed via a **modal dialog** accessible from Kanban view header and Settings page
- Modal shows draggable list of stages with name, colored dot, edit/delete buttons
- Drag to reorder stages (FLOAT8 position field handles ordering)
- Color picker: **WeKnow brand colors as presets first**, then full color picker available for custom colors
- Deleting a stage with kiosks requires **reassignment** — dialog shows count and lets admin pick target stage before deletion
- One stage marked as **default** — new kiosks auto-assigned to it (initially "Prospect"). Admin can change default

### Audit Log
- **Per-record audit** (kiosk/location detail Audit tab): Activity timeline, reverse chronological, grouped by day
  - Each entry shows: actor name, field changed, old → new value, timestamp
  - Assignment changes (venue reassignment) appear in the same unified timeline with distinct icon
- **Global admin audit** (Settings > Audit Log): Filterable table
  - Columns: Date, User, Entity Type (Kiosk/Location), Record Name (clickable link), Field, Old → New
  - Filters: by user, entity type, date range
  - Admin-only access
- Both views use **"Load more" pagination** — show last 20 entries, button to load older entries with remaining count

### Bulk Operations & CSV Export
- Multi-select checkboxes on table rows
- Bulk action toolbar appears when records selected (edit shared fields, archive, export)
- CSV export of filtered table data

### Claude's Discretion
- Table view column defaults and initial sort order
- Exact inline edit interaction patterns (save on blur vs Enter vs both)
- Loading states and skeleton designs for detail pages and kanban
- Error handling for failed saves (toast vs inline)
- Empty states for kanban columns, tables, detail page sections
- File upload progress indicator design
- Bulk edit modal/dialog layout
- CSV export format details (delimiter, encoding, field ordering)
- Search/filter UI component design for table view
- Exact preset color palette values beyond WeKnow brand colors

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Requirements
- `.planning/PROJECT.md` — Project vision, constraints, key decisions (kiosk-to-venue temporal tracking, ClickUp-style pipeline)
- `.planning/REQUIREMENTS.md` — KIOSK-01 through KIOSK-06, LOC-01 through LOC-05, VIEW-01 through VIEW-05, KANBAN-01 through KANBAN-03, BULK-01, BULK-02, AUDIT-01 through AUDIT-03

### Phase 1 Context
- `.planning/phases/01-foundation/01-CONTEXT.md` — Auth flow, role permissions, app shell decisions, navigation structure

### Brand Guidelines
- `~/.claude/weknow-brand-guidelines.md` — WeKnow brand colours (Azure #00A6D3, Graphite #121212), Circular Pro font, color palette for stage presets

### Database Schema
- `src/db/schema.ts` — Complete Drizzle schema with kiosks, locations, kioskAssignments, pipelineStages, auditLogs, userViews tables

### Existing Patterns
- `src/app/(app)/settings/users/actions.ts` — Server action pattern (requireRole, Zod validation, error handling)
- `src/components/admin/user-table.tsx` — Data table component pattern with action dropdowns
- `src/lib/rbac.ts` — RBAC helpers (requireRole, canAccessSensitiveFields, redactSensitiveFields)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **shadcn/ui components** (16 total): Button, Input, Table, Dialog, Select, DropdownMenu, Label, Card, Avatar, Badge, Alert, Tooltip, Sidebar, Sheet, Separator, Skeleton — all ready for composition
- **AppShell component** (`src/components/layout/app-shell.tsx`): Page header with sidebar trigger, title, optional action button — use for detail page headers
- **User table pattern** (`src/components/admin/user-table.tsx`): Data table with role badges, status indicators, action dropdowns — template for kiosk/location tables
- **Invite dialog pattern** (`src/components/admin/invite-user-dialog.tsx`): Modal form with Zod validation, toast feedback — template for create/edit dialogs
- **RBAC helpers** (`src/lib/rbac.ts`): requireRole(), canAccessSensitiveFields(), redactSensitiveFields() — use for banking/contract field protection

### Established Patterns
- **Server actions**: Try/catch with Error union returns, Zod validation, requireRole() guard (`src/app/(app)/settings/users/actions.ts`)
- **Client hydration**: Server component fetches data, passes to client component for interactivity (`settings/users/page.tsx` + `users-page-client.tsx`)
- **Form handling**: React Hook Form + Zod v4 + zodResolver
- **Toast feedback**: Sonner toast for success/error notifications
- **Design tokens**: All WeKnow colors defined as CSS variables in `src/app/globals.css` (wk-graphite, wk-azure, tints, etc.)
- **Route guards**: Session check in `(app)/layout.tsx` using `auth.api.getSession()`

### Integration Points
- **App router**: Kiosk pages at `src/app/(app)/kiosks/`, Location pages at `src/app/(app)/locations/`
- **Settings routes**: Pipeline stage management modal reachable from `src/app/(app)/settings/`
- **Sidebar nav**: Already has Kiosks and Locations items in `src/components/layout/app-sidebar.tsx`
- **Database**: Drizzle ORM client at `src/db/index.ts`, all tables defined in `src/db/schema.ts`

</code_context>

<specifics>
## Specific Ideas

- Detail pages should feel like Linear issue pages — clean, professional, inline editing
- Kanban should feel like a ClickUp board — compact cards, colored stage dots, drag-to-update
- Pipeline stage management modal should be accessible from both Kanban header and Settings — not buried in one location
- Stage colors should start with WeKnow brand palette as presets, then offer full color picker for custom choices
- Assignment history displayed as a collapsible timeline within the Deployment section — not a separate tab
- Contract documents shown as a file list with download icons below the structured contract fields

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-core-entities-and-views*
*Context gathered: 2026-03-18*
