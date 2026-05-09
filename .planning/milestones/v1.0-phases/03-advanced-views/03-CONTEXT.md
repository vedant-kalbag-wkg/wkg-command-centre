# Phase 3: Advanced Views - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Gantt timeline view and Calendar view for deployment planning. Introduces a new "Installation" entity (deployment projects) as the primary data model for both views. Adds milestones, resource allocation columns, and integrates with the existing View Engine for saved view configurations.

</domain>

<decisions>
## Implementation Decisions

### Installation (Deployment Project) Data Model
- New entity called "Installation" (not "deployment") — represents a planned rollout project
- Lightweight schema: name, planned start date, planned end date, region, status (planned/active/complete), linked kiosks
- Kiosks linked to installations via a join table
- New sidebar nav item "Installations" with full CRUD at `/installations`
- Installations are the primary entity driving Gantt bars

### Milestone Data Model
- Milestones are sub-elements of installations (FK to installations table)
- Each milestone has: name, type (contract signing, go-live, review date, etc.), target date
- Milestones can have linked kiosks and locations (join tables)
- Hierarchy: Installation → Milestones → linked Kiosks/Locations

### Resource Allocation
- Team members (existing users) assigned to installation projects with a role (e.g. "project lead", "installer")
- Simple join table: `installation_members` with user_id, installation_id, role
- No milestone-level resource assignment — project-level only

### Gantt View Layout & Grouping
- Each row = one installation project
- Rows grouped by region or deployment phase (collapsible group headers)
- Milestones shown as diamond markers on the installation's bar
- Resource allocation shown as left-side data grid columns (not a separate mode/toggle)
- Switchable grouping control in Gantt toolbar

### Gantt Interactions
- Drag bar ends to change start/end dates, drag whole bar to shift
- **Pending change visual:** modified bar shaded lighter to indicate unsaved change, with an "Apply" button next to the modified bar
- No auto-save on drag — explicit apply action required
- Milestone quick-add: click on a project's row at a date position → popover to enter name and type
- Full milestone management also available from installation detail page/panel

### Calendar Events
- Three event types displayed:
  1. **Installation project spans** — multi-day blocks (start → end date)
  2. **Milestones** — single-day markers/pins
  3. **Trial expiries** — kiosk freeTrialEndDate shown as deadline events
- Contract dates NOT on calendar (out of scope for this phase)

### Calendar UX
- Default view: month (with week/day view toggles)
- Click event → popover with summary details + link to full installation/kiosk detail page
- Filter toolbar dropdowns: region, status, hotel group (same pattern as table view filter bar)
- Color-coded by region (consistent across Gantt and Calendar)
- Event type distinguished by shape: blocks (installations), diamond/pin (milestones), dot (trial expiries)

### View Integration
- Gantt and Calendar appear as new tabs on the Kiosks page (alongside Table and Kanban)
- **Independent filters** per view tab — switching tabs resets filters, no cross-tab sync
- **Full saved views** for Gantt and Calendar — extends existing View Engine and userViews table with view_type field
- **URL query param**: `?view=table|kanban|gantt|calendar` — bookmarkable, shareable. Existing table/kanban views also get this.

### Claude's Discretion
- @svar-ui/react-gantt brand token customisation approach (research needed per STATE.md blocker)
- react-big-calendar styling and WeKnow brand integration
- Installation detail page layout and field arrangement
- Gantt zoom levels (day/week/month) and default zoom
- Calendar event density handling (when many events on one day)
- Empty states for Gantt and Calendar views
- Loading skeletons for timeline rendering
- Exact toolbar layout and button placement

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Requirements
- `.planning/PROJECT.md` — Project vision, constraints, key decisions
- `.planning/REQUIREMENTS.md` — GANTT-01 through GANTT-04, CAL-01, CAL-02 define Phase 3 requirements

### Prior Phase Context
- `.planning/phases/01-foundation/01-CONTEXT.md` — Auth flow, role permissions, app shell decisions, sidebar navigation structure
- `.planning/phases/02-core-entities-and-views/02-CONTEXT.md` — View Engine pattern, Kanban interactions, pipeline stage management, kiosk detail page structure

### Brand Guidelines
- `~/.claude/weknow-brand-guidelines.md` — WeKnow brand colours (Azure #00A6D3, Graphite #121212), Circular Pro font

### Database Schema
- `src/db/schema.ts` — Current Drizzle schema (kiosks, locations, kioskAssignments, pipelineStages, auditLogs, userViews)

### Existing Patterns
- `src/lib/stores/view-engine-store.ts` — Zustand View Engine store pattern (extend for Gantt/Calendar saved views)
- `src/components/kiosks/kiosk-kanban.tsx` — Kanban view pattern (reference for Gantt tab integration)
- `src/components/table/saved-views-bar.tsx` — Saved views bar pattern (reuse for Gantt/Calendar)
- `src/app/(app)/kiosks/page.tsx` — Kiosks page with view tabs (add Gantt/Calendar tabs here)

### Libraries (pre-selected in ROADMAP.md)
- `@svar-ui/react-gantt` — Gantt component library (STATE.md notes brand customisation needs prototyping)
- `react-big-calendar` — Calendar component library

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **View Engine store** (`src/lib/stores/view-engine-store.ts`): Zustand factory for per-entity view stores — extend with view_type support for Gantt/Calendar
- **Saved Views Bar** (`src/components/table/saved-views-bar.tsx`): Save/load named view configurations — reuse for Gantt/Calendar toolbars
- **Kiosk Kanban** (`src/components/kiosks/kiosk-kanban.tsx`): Reference for how view tabs are structured and data flows
- **AppShell** (`src/components/layout/app-shell.tsx`): Page header with optional action button — use for Installations page
- **shadcn/ui components**: Dialog, Sheet, Select, Badge, Tooltip, Skeleton all available
- **RBAC helpers** (`src/lib/rbac.ts`): requireRole(), canAccessSensitiveFields() — apply to installation management

### Established Patterns
- **Server actions**: Try/catch with Error union returns, Zod validation, requireRole() guard
- **Client hydration**: Server component fetches data → client component for interactivity
- **Zustand stores**: Factory pattern with per-entity instances (useKioskViewStore, useLocationViewStore)
- **Design tokens**: WeKnow CSS variables in globals.css (wk-graphite, wk-azure, tints)

### Integration Points
- **Kiosks page tabs**: `src/app/(app)/kiosks/page.tsx` — add Gantt and Calendar as new tab options
- **Sidebar nav**: `src/components/layout/app-sidebar.tsx` — add "Installations" nav item
- **App router**: New routes at `src/app/(app)/installations/` for Installation CRUD
- **Schema**: `src/db/schema.ts` — add installations, milestones, installation_kiosks, installation_members tables
- **URL routing**: Add `?view=` query param handling to kiosks page

</code_context>

<specifics>
## Specific Ideas

- Entity is called "Installation" not "Deployment" — use this term throughout UI and code
- Gantt drag-to-reschedule shows pending state: lighter shading on modified bar + Apply button adjacent to the bar
- Milestone quick-add directly on Gantt timeline via click + popover — power-user workflow
- Calendar and Gantt both color-code by region for visual consistency
- Calendar events use shape to distinguish type: blocks = installation spans, diamonds = milestones, dots = trial expiries
- Resource allocation as left-side data grid columns on Gantt — no separate mode toggle needed

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-advanced-views*
*Context gathered: 2026-03-19*
