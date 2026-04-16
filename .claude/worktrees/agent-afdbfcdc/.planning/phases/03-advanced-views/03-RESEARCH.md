# Phase 3: Advanced Views - Research

**Researched:** 2026-03-19
**Domain:** React Gantt chart (@svar-ui/react-gantt), calendar (react-big-calendar), Drizzle schema extensions, Next.js App Router
**Confidence:** HIGH (core library APIs), MEDIUM (Gantt drag intercept pattern for pending state)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Installation (Deployment Project) Data Model**
- New entity called "Installation" (not "deployment") — represents a planned rollout project
- Lightweight schema: name, planned start date, planned end date, region, status (planned/active/complete), linked kiosks
- Kiosks linked to installations via a join table
- New sidebar nav item "Installations" with full CRUD at `/installations`
- Installations are the primary entity driving Gantt bars

**Milestone Data Model**
- Milestones are sub-elements of installations (FK to installations table)
- Each milestone has: name, type (contract signing, go-live, review date, etc.), target date
- Milestones can have linked kiosks and locations (join tables)
- Hierarchy: Installation → Milestones → linked Kiosks/Locations

**Resource Allocation**
- Team members (existing users) assigned to installation projects with a role (e.g. "project lead", "installer")
- Simple join table: `installation_members` with user_id, installation_id, role
- No milestone-level resource assignment — project-level only

**Gantt View Layout & Grouping**
- Each row = one installation project
- Rows grouped by region or deployment phase (collapsible group headers)
- Milestones shown as diamond markers on the installation's bar
- Resource allocation shown as left-side data grid columns (not a separate mode/toggle)
- Switchable grouping control in Gantt toolbar

**Gantt Interactions**
- Drag bar ends to change start/end dates, drag whole bar to shift
- Pending change visual: modified bar shaded lighter to indicate unsaved change, with an "Apply" button next to the modified bar
- No auto-save on drag — explicit apply action required
- Milestone quick-add: click on a project's row at a date position → popover to enter name and type
- Full milestone management also available from installation detail page/panel

**Calendar Events**
- Three event types displayed: installation project spans (multi-day blocks), milestones (single-day markers), trial expiries (kiosk freeTrialEndDate deadline events)
- Contract dates NOT on calendar (out of scope)

**Calendar UX**
- Default view: month (with week/day view toggles)
- Click event → popover with summary details + link to full installation/kiosk detail page
- Filter toolbar dropdowns: region, status, hotel group
- Color-coded by region (consistent across Gantt and Calendar)
- Event type distinguished by shape: blocks (installations), diamond/pin (milestones), dot (trial expiries)

**View Integration**
- Gantt and Calendar appear as new tabs on the Kiosks page (alongside Table and Kanban)
- Independent filters per view tab — switching tabs resets filters, no cross-tab sync
- Full saved views for Gantt and Calendar — extends existing View Engine and userViews table with view_type field
- URL query param: `?view=table|kanban|gantt|calendar` — bookmarkable, shareable. Existing table/kanban views also get this.

### Claude's Discretion
- @svar-ui/react-gantt brand token customisation approach (research needed per STATE.md blocker)
- react-big-calendar styling and WeKnow brand integration
- Installation detail page layout and field arrangement
- Gantt zoom levels (day/week/month) and default zoom
- Calendar event density handling (when many events on one day)
- Empty states for Gantt and Calendar views
- Loading skeletons for timeline rendering
- Exact toolbar layout and button placement

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GANTT-01 | User can view deployment timelines on a Gantt chart (kiosk/venue scheduled stages over time) | @svar-ui/react-gantt 2.5.x — tasks prop accepts installation rows with start/end Date objects; scales prop controls zoom level |
| GANTT-02 | User can view regional rollout plans as grouped Gantt bars | @svar-ui/react-gantt supports hierarchical summary tasks as group rows; implement regions as summary parent rows with installation children |
| GANTT-03 | User can set and view milestones (contract signing, go-live targets, review dates) | @svar-ui/react-gantt natively renders `type: "milestone"` tasks as diamond markers on the timeline; milestone CRUD via server actions |
| GANTT-04 | User can assign resources (team members) to deployment tasks and view allocation | @svar-ui/react-gantt columns prop accepts custom cell React components — render user avatar + name + role in a left-side "Team" column |
| CAL-01 | User can view deployments, milestones, and deadlines on a calendar | react-big-calendar 1.19.4 — components.event prop for custom event rendering; eventPropGetter for per-event CSS class; allDay events for multi-day spans |
| CAL-02 | User can filter the calendar by region, status, or hotel group | Client-side filter state in Zustand; filter bar dropdowns using existing shadcn Select pattern; calendar events array filtered before passing to Calendar component |
</phase_requirements>

---

## Summary

Phase 3 introduces two major visualisation views — a Gantt timeline and a Calendar — both driven by a new "Installation" entity that represents deployment projects. The phase also creates new data model tables (installations, milestones, installation_kiosks, installation_members) and a new `/installations` CRUD section.

The Gantt view is built on `@svar-ui/react-gantt` 2.5.x, which has React 19 compatibility, TypeScript support, and a flexible CSS variable theming system. The key challenge is the "pending change" drag pattern: instead of auto-saving, drag events must be intercepted via `api.intercept("update-task", ...)` to capture the new dates into local state, render a visual pending indicator, and only persist on an explicit "Apply" button click.

The Calendar view is built on `react-big-calendar` 1.19.4 with the `dateFnsLocalizer` (project already has `date-fns` v4 installed — a compatibility note applies). Three event types (installation spans, milestone markers, trial expiry dots) are distinguished via custom `components.event` renderers and `eventPropGetter` for per-event CSS classes.

**Primary recommendation:** Implement both views as client components wrapped in server component data-fetchers following the established Phase 2 pattern. Use `api.intercept()` for Gantt drag without auto-save. Use `dateFnsLocalizer` with named locale imports for react-big-calendar. Prototype CSS variable overrides for @svar-ui/react-gantt in Wave 0 before full Gantt implementation (STATE.md blocker).

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @svar-ui/react-gantt | 2.5.2 | Gantt timeline with drag, milestones, custom columns | Pre-selected in ROADMAP.md; React 19 compatible; TypeScript; CSS variable theming; open source |
| react-big-calendar | 1.19.4 | Month/week/day calendar with multi-day events | Pre-selected in ROADMAP.md; most widely used React calendar; date-fns localizer built-in |
| @types/react-big-calendar | (latest) | TypeScript definitions for react-big-calendar | DefinitelyTyped package — required for TypeScript projects |
| date-fns | 4.x (already installed) | Date localizer for react-big-calendar | Already in project; provides `dateFnsLocalizer` factory |
| drizzle-orm | 0.45.x (already installed) | ORM for new installation/milestone/member tables | Already in project; extend schema.ts |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zustand | 5.x (already installed) | State for pending Gantt drag, calendar filters | Extend view-engine-store factory for Gantt/Calendar saved views |
| shadcn Popover | already installed | Milestone quick-add popover, calendar event detail popover | Both interaction patterns use the same Popover primitive |
| shadcn Sheet | already installed | Installation detail panel | Full installation CRUD side panel |
| shadcn Dialog | already installed | Delete confirmation (installations, milestones) | Destructive action confirmations |
| shadcn Select | already installed | Grouping picker, filter dropdowns | Toolbar controls |
| shadcn Skeleton | already installed | Loading states for Gantt rows and calendar cells | Initial load and navigation |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @svar-ui/react-gantt | dhtmlx-gantt | dhtmlx is commercial/license-gated; SVAR is open source and pre-selected |
| @svar-ui/react-gantt | frappe-gantt | frappe-gantt is a lighter library but lacks TypeScript, React 19 support, and the custom column API needed for resource allocation |
| react-big-calendar | FullCalendar React | FullCalendar is more powerful but heavier; react-big-calendar is pre-selected and sufficient for this use case |

**Installation:**
```bash
npm install @svar-ui/react-gantt react-big-calendar @types/react-big-calendar
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/(app)/
│   ├── kiosks/
│   │   └── page.tsx              # Add Gantt and Calendar tabs + ?view= URL param
│   └── installations/
│       ├── page.tsx              # Installation list (table) — server component
│       ├── new/page.tsx          # New installation form
│       └── [id]/page.tsx         # Installation detail page/edit
├── components/
│   ├── gantt/
│   │   ├── gantt-view.tsx        # Main Gantt client component (wraps @svar-ui/react-gantt)
│   │   ├── gantt-toolbar.tsx     # Grouping select, zoom, saved views bar
│   │   ├── milestone-quick-add-popover.tsx
│   │   └── gantt-apply-button.tsx
│   ├── calendar/
│   │   ├── calendar-view.tsx     # Main Calendar client component (wraps react-big-calendar)
│   │   ├── calendar-toolbar.tsx  # Month/Week/Day toggle, filter dropdowns, saved views bar
│   │   └── calendar-event-popover.tsx
│   └── installations/
│       ├── installation-table.tsx
│       ├── installation-form.tsx
│       ├── installation-detail-sheet.tsx
│       ├── milestone-list.tsx
│       └── resource-member-list.tsx
├── db/
│   └── schema.ts                 # Add installations, milestones, installation_kiosks, installation_members
├── lib/
│   └── stores/
│       ├── view-engine-store.ts  # Extend: add useInstallationViewStore; add view_type to saved view config
│       ├── gantt-store.ts        # Pending drag state: { pendingTaskId, pendingDates } + clear action
│       └── calendar-store.ts     # Calendar filter state (region, status, hotelGroup) + view mode (month/week/day)
└── app/(app)/installations/
    └── actions.ts                # Server actions for installation CRUD
```

### Pattern 1: Gantt Pending-Drag Without Auto-Save
**What:** Intercept the Gantt library's `update-task` action before it mutates internal state, capture new dates in a Zustand store, apply a visual pending style, and persist only on explicit "Apply" click.
**When to use:** This is the required pattern for all Gantt drag operations in this phase.

```typescript
// Source: https://docs.svar.dev/react/gantt/api/how_to_access_api/
// and https://docs.svar.dev/react/gantt/api/actions/update-task/

const apiRef = useRef<IGanttApi | null>(null);

const init = useCallback((api: IGanttApi) => {
  apiRef.current = api;

  // Intercept drag-update — returning false blocks the library's internal update,
  // so we capture the new dates in local state instead of auto-mutating.
  api.intercept("update-task", (ev) => {
    // inProgress = true means drag is still happening (not the final drop)
    if (ev.inProgress) return; // let through so the bar visually tracks the mouse

    // Final drop: capture into pending state, block internal save
    if (ev.task?.start && ev.task?.end) {
      setPendingChange({
        taskId: ev.id,
        start: ev.task.start,
        end: ev.task.end,
        duration: ev.task.duration,
      });
      return false; // blocks the library from applying the change to its own store
    }
  });
}, [setPendingChange]);

<Gantt tasks={ganttTasks} scales={scales} ref={apiRef} init={init} />
```

**Key constraint from docs:** "When updating a task and date-related fields are modified, make sure all three date fields are provided together: `start`, `end`, and `duration`."

### Pattern 2: @svar-ui/react-gantt CSS Variable Theming (Scoped)
**What:** Wrap the `<Gantt>` in a container div with a custom class; define WeKnow CSS variables on that class to override Willow theme defaults.
**When to use:** Required for WeKnow brand compliance on Gantt bars, milestone diamonds, grid headers.

```css
/* Source: https://docs.svar.dev/react/gantt/guides/styling/ */
/* In a scoped CSS module or global CSS with .gantt-wk wrapper */
.gantt-wk {
  /* Bar colours — overridden per-task via task.color property on individual tasks */
  --wx-gantt-task-color: #00A6D3;          /* Azure — default (Region A) */
  --wx-gantt-task-fill-color: #00A6D3;
  --wx-gantt-milestone-color: #00A6D3;     /* Azure milestone diamonds */

  /* Grid styling */
  --wx-grid-header-font: 600 12px var(--font-sans);
  --wx-grid-header-font-color: #121212;    /* Graphite */
  --wx-grid-body-font: 400 14px var(--font-sans);
  --wx-grid-body-font-color: #121212;

  /* Timeline */
  --wx-timescale-font: 400 12px var(--font-sans);
  --wx-timescale-font-color: #575A5C;      /* Night Grey */
  --wx-gantt-border: 1px solid #F4F4F4;    /* Light Grey borders */
}
```

**Per-row region color:** Set each installation task's `color` property to the region hex value from the UI-SPEC region palette table. The library reads `task.color` for bar fill.

**Pending-change visual (CONTEXT.md requirement):**
- Pending bar: use `task.color` set to region colour at 40% opacity (`rgba(R,G,B,0.4)`) + CSS class on the bar via a custom `template` in a column or a wrapper
- Apply border via `--wx-gantt-task-border-color: #00A6D3` and `--wx-gantt-task-border: 2px dashed #00A6D3` but scoped only to pending tasks — best done by toggling a CSS class on the container

**CRITICAL blocker from STATE.md:** Brand customisation depth must be prototyped in Wave 0 before full Gantt implementation. The executor must verify that `task.color` per-task override works as expected and that the pending-state visual is achievable via CSS scoping.

### Pattern 3: @svar-ui/react-gantt Custom Left-Side Resource Column
**What:** Use the `columns` prop to add a "Team" column that renders user avatars.
**When to use:** GANTT-04 — resource allocation as always-visible left-side columns.

```typescript
// Source: https://docs.svar.dev/react/gantt/api/properties/columns/
const columns = [
  { id: "text", header: "Installation", flexgrow: 1, resize: true },
  {
    id: "team",
    header: "Team",
    width: "120px",
    resize: false,
    sort: false,
    // `cell` prop renders a custom React component for each row
    cell: ({ row }: { row: GanttTask }) => (
      <ResourceCell installationId={row.id} members={row.members} />
    ),
  },
];

<Gantt tasks={ganttTasks} columns={columns} scales={scales} />
```

### Pattern 4: react-big-calendar with dateFnsLocalizer + Custom Event Types
**What:** Configure react-big-calendar with date-fns v4 localizer, custom event rendering per type (installation block, milestone diamond, trial expiry dot).
**When to use:** CAL-01, CAL-02.

```typescript
// Source: https://github.com/jquense/react-big-calendar/blob/master/README.md
// IMPORTANT: date-fns v3/v4 requires named ES6 locale imports (not CommonJS require)
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale"; // named import — required for v3/v4

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { "en-US": enUS },
});

// Custom event component — switch on event.type for shape rendering
function CalendarEvent({ event }: { event: CalendarEventData }) {
  if (event.type === "milestone") {
    return <MilestoneDiamondEvent event={event} />;
  }
  if (event.type === "trial-expiry") {
    return <TrialExpiryDotEvent event={event} />;
  }
  return <InstallationBlockEvent event={event} />;
}

// eventPropGetter for per-event CSS class (region color, event type)
function eventPropGetter(event: CalendarEventData) {
  return {
    className: `cal-event--${event.type} cal-event--region-${event.regionSlug}`,
    style: {
      backgroundColor: event.type === "installation"
        ? `${event.regionColor}cc`  // 80% opacity hex
        : "transparent",
    },
  };
}

<Calendar
  localizer={localizer}
  events={filteredEvents}
  startAccessor="start"
  endAccessor="end"
  defaultView="month"
  views={["month", "week", "day"]}
  components={{ event: CalendarEvent }}
  eventPropGetter={eventPropGetter}
  style={{ height: "100%" }}
/>
```

**CSS import required:**
```typescript
import "react-big-calendar/lib/css/react-big-calendar.css";
```
Override in a scoped `.rbc-calendar` wrapper — do not modify library source.

### Pattern 5: URL Query Param for View Tabs
**What:** Read `?view=` from searchParams in the kiosks page server component; pass as `defaultValue` to `<Tabs>`.
**When to use:** All four tabs (table, kanban, gantt, calendar) must be URL-addressable.

```typescript
// src/app/(app)/kiosks/page.tsx
export default async function KiosksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view = "table" } = await searchParams;
  const validViews = ["table", "kanban", "gantt", "calendar"];
  const activeView = validViews.includes(view) ? view : "table";

  // On tab change — client component pushes ?view= to router
  return (
    <Tabs defaultValue={activeView}>
      ...
    </Tabs>
  );
}
```

The `TabsList` is a client component that calls `router.push(?view=X)` on tab change so the URL stays in sync.

### Pattern 6: Drizzle Schema Extension
**What:** Add 4 new tables to `src/db/schema.ts` for the Installation entity.

```typescript
// src/db/schema.ts additions

export const installations = pgTable("installations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  region: text("region"),
  status: text("status").notNull().default("planned"), // planned | active | complete
  plannedStart: timestamp("planned_start", { withTimezone: true }),
  plannedEnd: timestamp("planned_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const milestones = pgTable("milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  installationId: uuid("installation_id")
    .notNull()
    .references(() => installations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(), // contract_signing | go_live | review_date | other
  targetDate: timestamp("target_date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const installationKiosks = pgTable("installation_kiosks", {
  installationId: uuid("installation_id")
    .notNull()
    .references(() => installations.id, { onDelete: "cascade" }),
  kioskId: uuid("kiosk_id")
    .notNull()
    .references(() => kiosks.id, { onDelete: "cascade" }),
});

export const installationMembers = pgTable("installation_members", {
  installationId: uuid("installation_id")
    .notNull()
    .references(() => installations.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // project_lead | installer | coordinator
});
```

**Note:** Use `drizzle-kit push` (not `migrate`) — existing Supabase session-mode pooler constraint from Phase 2 (STATE.md decision).

### Pattern 7: userViews Extension for Gantt/Calendar Saved Views
**What:** The existing `userViews.config` JSONB column needs to accommodate Gantt/Calendar state. Add a `view_type` column to distinguish table/kanban/gantt/calendar saved views.
**When to use:** Extending SavedViewsBar to Gantt and Calendar toolbars.

Extend `userViews` table:
```typescript
// Add to existing userViews table in schema.ts:
viewType: text("view_type").notNull().default("table"), // table | kanban | gantt | calendar
```

Extend `ViewConfig` in `view-engine-store.ts`:
```typescript
export interface ViewConfig {
  columnFilters?: ColumnFiltersState;
  sorting?: SortingState;
  grouping?: string[];
  columnVisibility?: VisibilityState;
  // New for Gantt/Calendar:
  ganttGroupBy?: "region" | "deploymentPhase";
  ganttZoom?: "day" | "week" | "month";
  calendarView?: "month" | "week" | "day";
  calendarFilters?: { region?: string; status?: string; hotelGroup?: string };
}
```

Create new store instances:
```typescript
export const useGanttViewStore = createViewEngineStore("installation-gantt");
export const useCalendarViewStore = createViewEngineStore("installation-calendar");
```

### Anti-Patterns to Avoid
- **Auto-saving Gantt drag:** Do NOT use `RestDataProvider` from the SVAR tutorial — it auto-saves on every drag. Use `api.intercept()` to block the update and capture pending state instead.
- **Importing react-big-calendar without CSS:** The calendar will render with no layout/borders. Always import `react-big-calendar/lib/css/react-big-calendar.css`.
- **Using date-fns CommonJS require for locales:** `require('date-fns/locale/en-US')` fails in v3/v4. Use `import { enUS } from 'date-fns/locale'` (named ES6 import).
- **Putting Gantt in a server component:** The Gantt component requires client-side APIs for drag. Always mark `"use client"` on the GanttView wrapper.
- **Sharing view state across tabs:** CONTEXT.md specifies independent filters per tab — do NOT sync filter state between Gantt/Calendar/Table/Kanban.
- **Calling api.intercept() outside the init handler:** The API is only valid after initialization. Always configure interceptors inside the `init` callback or after `apiRef.current` is non-null.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gantt timeline rendering | Custom SVG/Canvas bar renderer | @svar-ui/react-gantt | Bar sizing, drag handles, milestone diamonds, scales, zoom — all are complex edge cases |
| Gantt drag-to-resize | Custom pointer event handlers | @svar-ui/react-gantt built-in drag | Edge snapping, multi-task move, accessibility keyboard fallback |
| Calendar multi-day event rendering | Custom grid overlay | react-big-calendar | Spanning cells across weeks, event stacking, overflow popover |
| Date localization for calendar | Custom date formatters | dateFnsLocalizer from react-big-calendar | Handles locale, week start, timezone-aware formatting |
| Milestone diamond shape | Custom SVG | @svar-ui/react-gantt `type: "milestone"` task | Built-in diamond rendering on timeline |

**Key insight:** Both the Gantt and Calendar domains have deceptively complex rendering edge cases (bar overlap, event stacking, drag snapping, zoom scale math) that the chosen libraries handle. Any custom implementation would take weeks to reach library quality.

---

## Common Pitfalls

### Pitfall 1: date-fns v4 + dateFnsLocalizer Locale Import Format
**What goes wrong:** Calendar renders without locale formatting; week starts on wrong day; or runtime error `"Module has no default export"`.
**Why it happens:** date-fns v3/v4 changed locale exports from default exports to named exports. `require()` and `import de from 'date-fns/locale/de'` both fail.
**How to avoid:** Always use `import { enUS } from 'date-fns/locale'` (named barrel import) when configuring the localizer.
**Warning signs:** TypeScript error about missing default export; calendar week header shows numeric day numbers instead of locale names.

### Pitfall 2: @svar-ui/react-gantt intercept(inProgress) Loop
**What goes wrong:** The `update-task` intercept fires continuously during drag (on every mouse-move pixel). Returning `false` on `inProgress: true` events stops the bar from visually tracking the mouse.
**Why it happens:** The library fires `update-task` both during drag (inProgress=true) and on drop (inProgress=false). Blocking all events prevents the visual drag animation.
**How to avoid:** In the intercept callback, `return` (allow through) when `ev.inProgress === true`; only return `false` on the final drop event where `inProgress` is falsy or undefined.
**Warning signs:** Bar appears frozen during drag; user can't see where the bar will land.

### Pitfall 3: react-big-calendar Height Not Set
**What goes wrong:** Calendar renders as a zero-height element — invisible.
**Why it happens:** react-big-calendar requires an explicit height on its container (it uses absolute positioning internally). Without height, all cells collapse.
**How to avoid:** Always wrap in a container with an explicit height: `<div className="h-[700px] relative"><Calendar ... style={{ height: "100%" }} /></div>`.
**Warning signs:** The calendar imports and mounts without error but nothing is visible; the `.rbc-calendar` element has `height: 0`.

### Pitfall 4: Gantt Task Type Hierarchy for Grouping
**What goes wrong:** Group header rows (by region) appear as regular task bars instead of collapsible summary rows.
**Why it happens:** @svar-ui/react-gantt uses `type: "summary"` (or parent/child hierarchy via `parent` field) to create expandable groups. Using a flat task list without parent/child structure produces flat rows with no grouping.
**How to avoid:** When grouping by region, transform the flat installation list into a hierarchical structure: create a synthetic "summary" task per region (no start/end date), then set `parent: regionTaskId` on each installation task within that region.
**Warning signs:** All rows at the same indentation level with no collapse chevron.

### Pitfall 5: userViews view_type Missing — Saved Views Bleed Across Types
**What goes wrong:** Saving a Gantt view loads it on the Table tab; calendar saved views appear in the Gantt SavedViewsBar.
**Why it happens:** The existing userViews table has no `view_type` discriminator. All saved views for `entityType: "installation"` would appear in all view toolbars.
**How to avoid:** Add `view_type` column to userViews in schema extension. Filter `listUserViews` queries by both `entityType` AND `view_type` before rendering in the SavedViewsBar.
**Warning signs:** Saved views from one view mode appear in another mode's toolbar.

### Pitfall 6: Server Component + Gantt/Calendar Client Boundary
**What goes wrong:** Serialization error when passing non-JSON-serializable values (Date objects) from server component to Gantt/Calendar client components.
**Why it happens:** Next.js App Router requires RSC-to-client props to be serializable. Date objects are not serializable — they must be passed as ISO strings and reconstructed.
**How to avoid:** Server component fetches installation data, converts Date fields to ISO strings, passes to client. Client component converts ISO strings back to Date objects before feeding to @svar-ui/react-gantt (which expects `Date` objects for `start`/`end`).
**Warning signs:** Runtime error "Objects are not valid as a React child" or hydration mismatch involving Date.

---

## Code Examples

Verified patterns from official sources:

### @svar-ui/react-gantt Basic Setup with Willow Theme
```typescript
// Source: https://docs.svar.dev/react/gantt/getting_started/
import { Gantt, Willow } from "@svar-ui/react-gantt";

const scales = [
  { unit: "month", step: 1, format: "%F %Y" },
  { unit: "week", step: 1, format: "Week %W" },
];

// tasks must include: id, text, start (Date), end (Date), type ("task"|"milestone"|"summary")
export function GanttView({ tasks }: { tasks: GanttTask[] }) {
  return (
    <div className="gantt-wk"> {/* CSS variable overrides scoped here */}
      <Willow>
        <Gantt tasks={tasks} scales={scales} />
      </Willow>
    </div>
  );
}
```

### Gantt Intercept API (Pending Drag State)
```typescript
// Source: https://docs.svar.dev/react/gantt/api/how_to_access_api/
//         https://docs.svar.dev/react/gantt/api/actions/update-task/
"use client";
import { useRef, useCallback } from "react";
import { Gantt, Willow } from "@svar-ui/react-gantt";

export function GanttView({ tasks, onPendingChange }) {
  const apiRef = useRef(null);

  const init = useCallback((api) => {
    apiRef.current = api;
    api.intercept("update-task", (ev) => {
      if (ev.inProgress) return; // allow visual tracking during drag
      // Final drop — capture pending state, block internal persistence
      onPendingChange({ id: ev.id, start: ev.task.start, end: ev.task.end, duration: ev.task.duration });
      return false;
    });
  }, [onPendingChange]);

  return (
    <Willow>
      <Gantt tasks={tasks} ref={apiRef} init={init} scales={scales} />
    </Willow>
  );
}
```

### react-big-calendar with date-fns v4 Localizer
```typescript
// Source: https://github.com/jquense/react-big-calendar
import "react-big-calendar/lib/css/react-big-calendar.css";
import { Calendar, dateFnsLocalizer } from "react-big-calendar";
import { format, parse, startOfWeek, getDay } from "date-fns";
import { enUS } from "date-fns/locale"; // Named import — required for date-fns v3/v4

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales: { "en-US": enUS },
});

export function CalendarView({ events }: { events: CalendarEventData[] }) {
  return (
    <div className="h-[700px] relative rbc-calendar-wk">
      <Calendar
        localizer={localizer}
        events={events}
        startAccessor="start"
        endAccessor="end"
        defaultView="month"
        views={["month", "week", "day"]}
        components={{ event: CalendarEvent }}
        eventPropGetter={eventPropGetter}
        style={{ height: "100%" }}
      />
    </div>
  );
}
```

### react-big-calendar CSS Override Pattern
```css
/* In a scoped block or globals.css — do NOT modify library source */
.rbc-calendar-wk .rbc-calendar {
  font-family: var(--font-sans);
  color: #121212; /* --wk-graphite */
}

.rbc-calendar-wk .rbc-header {
  font-size: 12px;
  font-weight: 400;
  color: #575A5C; /* --wk-night-grey */
  border-bottom: 1px solid #F4F4F4; /* --wk-light-grey */
}

.rbc-calendar-wk .rbc-today {
  background-color: rgba(0, 166, 211, 0.08); /* Azure 8% — today highlight */
}

.rbc-calendar-wk .rbc-toolbar button.rbc-active {
  background-color: #00A6D3; /* --wk-azure */
  color: white;
}
```

### Gantt Group Header Pattern (Region Grouping)
```typescript
// Transform flat installations into hierarchical Gantt tasks for regional grouping
function buildGanttTasks(
  installations: Installation[],
  groupBy: "region" | "deploymentPhase"
): GanttTask[] {
  const groups = groupBy === "region"
    ? groupByRegion(installations)
    : groupByDeploymentPhase(installations);

  const tasks: GanttTask[] = [];
  for (const [groupName, items] of Object.entries(groups)) {
    const groupId = `group-${groupName}`;
    // Summary row — acts as collapsible group header
    tasks.push({ id: groupId, text: groupName, type: "summary", open: true });
    for (const inst of items) {
      tasks.push({
        id: inst.id,
        parent: groupId,
        text: inst.name,
        start: new Date(inst.plannedStart),
        end: new Date(inst.plannedEnd),
        type: "task",
        color: REGION_COLORS[inst.region] ?? REGION_COLORS.default,
        members: inst.members, // for resource column cell renderer
      });
      // Milestones as children of the installation
      for (const ms of inst.milestones) {
        tasks.push({
          id: ms.id,
          parent: inst.id,
          text: ms.name,
          start: new Date(ms.targetDate),
          type: "milestone",
          color: REGION_COLORS[inst.region] ?? REGION_COLORS.default,
        });
      }
    }
  }
  return tasks;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| date-fns CommonJS locale require | Named ES6 `import { enUS } from 'date-fns/locale'` | date-fns v3 (2023) | CJS imports silently fail to apply locale in v3/v4 |
| RestDataProvider auto-save pattern | `api.intercept()` for controlled pending state | SVAR Gantt 2.x | Enables explicit save UX without custom drag re-implementation |
| react-big-calendar SASS variable customisation | Scoped CSS class overrides on `.rbc-calendar-wk` container | Still current practice | SASS approach requires build tooling; scoped CSS class is simpler with Tailwind v4 |

**Deprecated/outdated:**
- `api.on()` for drag interception: Works but `api.intercept()` is preferred — intercept can return `false` to block the action; `on()` cannot.
- `require('date-fns/locale/en-US')` default import: Broken in date-fns v3+.

---

## Open Questions

1. **@svar-ui/react-gantt `task.color` per-task override**
   - What we know: The `task.color` property is mentioned in docs as the bar fill colour; the `--wx-gantt-task-color` CSS variable sets the global default.
   - What's unclear: Whether `task.color` truly overrides `--wx-gantt-task-color` for an individual row, or whether per-task color must be set via a different mechanism (custom cell template or className).
   - Recommendation: Prototype this in Wave 0 (Plan 03-01 first task) with a two-task data set: set different `color` values per task and verify each bar shows the correct region colour. If `task.color` doesn't work, fall back to injecting a per-row `style` via a custom bar template.

2. **Pending-state visual: dashed border on Gantt bar**
   - What we know: CSS variable `--wx-gantt-task-border` and `--wx-gantt-task-border-color` exist; but these are global, not per-task.
   - What's unclear: How to apply the dashed border only to the pending task without affecting all bars.
   - Recommendation: Prototype a wrapping overlay div positioned over the pending bar using React state + absolute positioning, bypassing the library's border system. Or check if the library exposes a `className` or `style` per task.

3. **react-big-calendar milestone diamond rendering in month view**
   - What we know: Custom `components.event` component renders arbitrary JSX for any event; `eventPropGetter` controls CSS classes.
   - What's unclear: In month view, single-day events sometimes get truncated or hidden by the "+N more" overflow. Whether milestone diamonds (single-day events) will always be visible.
   - Recommendation: Set milestone events with `allDay: true` so they appear in the all-day row at the top of the day cell rather than as timed events — this avoids overflow truncation in month view.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright 1.58.x |
| Config file | `playwright.config.ts` (exists) |
| Quick run command | `npx playwright test tests/installations/ --workers=1` |
| Full suite command | `npx playwright test --workers=1` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GANTT-01 | Gantt tab renders with installation bars visible | smoke/E2E | `npx playwright test tests/installations/gantt.spec.ts -x` | ❌ Wave 0 |
| GANTT-02 | Gantt rows grouped by region with collapsible headers | E2E | `npx playwright test tests/installations/gantt.spec.ts -x` | ❌ Wave 0 |
| GANTT-03 | Milestone diamond appears on Gantt bar after quick-add | E2E | `npx playwright test tests/installations/gantt.spec.ts -x` | ❌ Wave 0 |
| GANTT-04 | Team column shows member name in left-side grid | E2E | `npx playwright test tests/installations/gantt.spec.ts -x` | ❌ Wave 0 |
| CAL-01 | Calendar shows installation block, milestone marker, trial expiry dot | E2E | `npx playwright test tests/installations/calendar.spec.ts -x` | ❌ Wave 0 |
| CAL-02 | Filtering by region hides non-matching events on calendar | E2E | `npx playwright test tests/installations/calendar.spec.ts -x` | ❌ Wave 0 |

Additional non-requirement tests needed:
| Behavior | Test Type | File |
|----------|-----------|------|
| Installation CRUD (create, view, delete) | E2E | `tests/installations/crud.spec.ts` ❌ Wave 0 |
| Pending drag state: Apply saves new dates; Discard reverts | E2E | `tests/installations/gantt.spec.ts` ❌ Wave 0 |
| URL `?view=gantt` loads Gantt tab; `?view=calendar` loads Calendar tab | E2E | `tests/installations/view-tabs.spec.ts` ❌ Wave 0 |
| Milestone quick-add popover creates milestone | E2E | `tests/installations/gantt.spec.ts` ❌ Wave 0 |
| Calendar event click opens popover with detail | E2E | `tests/installations/calendar.spec.ts` ❌ Wave 0 |

**Note on drag testing:** Playwright supports mouse drag via `page.dragAndDrop()` or `page.mouse.move/down/up`. Verify in Wave 0 that @svar-ui/react-gantt responds to programmatic pointer events — some canvas-based Gantt libraries do not.

### Sampling Rate
- **Per task commit:** `npx playwright test tests/installations/ --workers=1`
- **Per wave merge:** `npx playwright test --workers=1`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/installations/crud.spec.ts` — CRUD happy path + validation
- [ ] `tests/installations/gantt.spec.ts` — covers GANTT-01 through GANTT-04, pending drag, milestone quick-add
- [ ] `tests/installations/calendar.spec.ts` — covers CAL-01, CAL-02, event popover
- [ ] `tests/installations/view-tabs.spec.ts` — URL ?view= param routing
- [ ] `tests/helpers/installation-helpers.ts` — DB seed helpers for installation test fixtures
- [ ] Framework already installed — no new install needed

---

## Sources

### Primary (HIGH confidence)
- [docs.svar.dev/react/gantt/guides/styling/](https://docs.svar.dev/react/gantt/guides/styling/) — Full CSS variable list, scoped class theming mechanism
- [docs.svar.dev/react/gantt/api/properties/columns/](https://docs.svar.dev/react/gantt/api/properties/columns/) — columns prop API, `cell` component prop for custom column content
- [docs.svar.dev/react/gantt/api/how_to_access_api/](https://docs.svar.dev/react/gantt/api/how_to_access_api/) — `init` handler, `apiRef` pattern, `api.intercept()`, `api.on()`
- [docs.svar.dev/react/gantt/api/actions/update-task/](https://docs.svar.dev/react/gantt/api/actions/update-task/) — `update-task` action parameters, `inProgress` flag, date field constraint
- [docs.svar.dev/react/gantt/guides/user-interface/](https://docs.svar.dev/react/gantt/guides/user-interface/) — milestone diamond rendering, drag behavior
- [github.com/jquense/react-big-calendar](https://github.com/jquense/react-big-calendar) — README: localizer setup, CSS import, components prop, eventPropGetter
- Existing project `src/db/schema.ts` — current Drizzle schema (read directly)
- Existing project `src/lib/stores/view-engine-store.ts` — ViewEngineState shape, factory pattern (read directly)
- Existing project `src/app/(app)/kiosks/page.tsx` — current tab structure to extend (read directly)

### Secondary (MEDIUM confidence)
- [svar.dev/blog/nextjs-gantt-chart-backend/](https://svar.dev/blog/nextjs-gantt-chart-backend/) — Next.js integration pattern; used as reference for init handler; RestDataProvider pattern explicitly NOT adopted (conflicts with pending-state requirement)
- [github.com/jquense/react-big-calendar/issues/1726](https://github.com/jquense/react-big-calendar/issues/1726) — Confirmed: named ES6 locale import required for date-fns v2+; v3/v4 pattern inferred from date-fns v3 breaking changes

### Tertiary (LOW confidence — flag for validation)
- @svar-ui/react-gantt v2.5.2 version number: from WebSearch result (npm badge claim); **verify with `npm show @svar-ui/react-gantt version` before installing**
- Per-task `task.color` override for individual bar colours: inferred from task data model examples; not explicitly confirmed in CSS variable docs — **must prototype in Wave 0**
- Pending-state dashed border via per-task scoping: no official docs confirm per-task border override exists — **must prototype in Wave 0**

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — libraries pre-selected, versions verified from multiple sources
- Architecture: HIGH — established patterns from prior phases extended consistently
- @svar-ui/react-gantt theming: MEDIUM — CSS variable system confirmed; per-task color and pending-state visual need Wave 0 prototyping
- react-big-calendar integration: HIGH — dateFnsLocalizer, components, eventPropGetter APIs confirmed from official sources
- Schema design: HIGH — follows established Drizzle pgTable pattern from project
- Pitfalls: HIGH for date-fns locale and height issues (confirmed from issues); MEDIUM for Gantt intercept inProgress edge case (inferred from API docs)

**Research date:** 2026-03-19
**Valid until:** 2026-04-18 (stable libraries; @svar-ui/react-gantt is actively developed — check for minor updates before install)
