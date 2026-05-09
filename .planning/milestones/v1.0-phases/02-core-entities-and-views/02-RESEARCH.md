# Phase 02: Core Entities and Views — Research

**Researched:** 2026-03-19
**Domain:** TanStack Table v8, dnd-kit, Zustand, Drizzle ORM, S3 presigned URLs, inline editing, audit log, Kanban
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Record Detail Pages**
- Full detail page navigation — click table row or kanban card navigates to `/kiosks/[id]` or `/locations/[id]`
- Inline editing — click a field value to edit in place, saves on blur/Enter (Linear/Notion style)
- Creating new records uses the same full detail page layout at `/kiosks/new` or `/locations/new` with all sections expanded and a "Create" button
- Soft delete with archive — delete shows confirmation dialog, record is archived (not permanently deleted), hidden from default views but visible via filter
- Kiosk detail page tabs: **Details** + **Audit** (2 tabs). Assignments are inline in the Details tab, not a separate tab
- Location detail page tabs: **Details** + **Kiosks** + **Audit** (3 tabs)

**Kiosk Detail Page — Field Sections**
- Tabbed sections with collapsible groups on the Details tab
- Field groups: **Identity**, **Hardware & Software**, **Deployment** (with inline venue assignment + assignment history sub-section), **Billing**
- Venue assignment shown inline in Deployment section with a "Reassign" button
- Assignment history is a collapsible sub-section within Deployment showing timeline of past venues with dates and reasons

**Location Detail Page — Field Sections**
- Field groups: **Info**, **Key Contacts** (JSONB array), **Contract** (structured fields + file attachment list), **Banking** (JSONB, restricted to admin/member)
- Contract section shows structured fields inline plus a document file list with upload button below
- Banking and Contract sections show lock icon and are redacted for Viewer role

**View Tabs**
- Kiosks page shows view type tabs: **Table** and **Kanban** (only these two in Phase 2)
- Table is always the default landing view — no "remember last view" behavior
- Gantt and Calendar tabs are hidden until built in Phase 3 (no disabled/coming-soon placeholders)

**Kanban Board**
- Compact cards: Kiosk ID, venue name, region badge, CMS config status indicator
- Switchable grouping — default columns are pipeline stages; user can switch to group by region, hotel group, etc.
- Drag-and-drop only enabled when grouped by pipeline stage — dragging updates the kiosk's stage
- When grouped by other fields: drag is disabled with an info banner
- Column headers: colored dot + stage name + card count
- Click card navigates to full detail page (no popover/preview)
- No filter bar on Kanban — filtering is table view only

**Pipeline Stage Management**
- Modal dialog accessible from Kanban view header and Settings page
- Drag to reorder stages (FLOAT8 position field handles ordering)
- Color picker: WeKnow brand colors as presets first, then full color picker
- Deleting a stage with kiosks requires reassignment — inline in modal (not a nested dialog)
- One stage marked as default — new kiosks auto-assigned to it

**Audit Log**
- Per-record audit: Activity timeline, reverse chronological, grouped by day
- Global admin audit (Settings > Audit Log): Filterable table with Load more pagination
- Both views: Load more pagination — show last 20 entries, button to load older entries

**Bulk Operations & CSV Export**
- Multi-select checkboxes on table rows
- Bulk action toolbar appears when records selected
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| KIOSK-01 | Create a kiosk record with all 20+ fields | Drizzle schema maps to form fields; server action pattern established |
| KIOSK-02 | View, edit, and delete kiosk records | Inline editing pattern; soft-delete (archived flag) via server action |
| KIOSK-03 | Kiosk has a status from a configurable lifecycle pipeline | pipelineStages table with FLOAT8 position; select field in form |
| KIOSK-04 | Admin can add, reorder, rename, and remove lifecycle stages | Pipeline stage management modal with dnd-kit sortable list |
| KIOSK-05 | Assign kiosk to a venue and reassign | kioskAssignments temporal table; Reassign button in Deployment section |
| KIOSK-06 | System tracks full assignment history per kiosk | kioskAssignments rows (unassignedAt null = current); collapsible timeline |
| LOC-01 | Create a location record with all fields | locations table; JSONB for keyContacts |
| LOC-02 | View, edit, and delete location records | Same inline edit + soft-delete pattern as kiosks |
| LOC-03 | Attach contracts with structured fields and file uploads | contractDocuments JSONB array; S3 presigned URLs via @aws-sdk |
| LOC-04 | Store banking details (restricted to authorized roles) | bankingDetails JSONB; redactSensitiveFields() from rbac.ts |
| LOC-05 | View all kiosks currently and historically assigned to a location | Kiosks tab on location detail page; query kioskAssignments by locationId |
| VIEW-01 | Filterable, sortable table (default interface) | TanStack Table v8 with column filters + global filter |
| VIEW-02 | Group table records by any field | TanStack Table v8 grouping feature; groupedRowModel |
| VIEW-03 | Show/hide columns | TanStack Table v8 columnVisibility state |
| VIEW-04 | Save a custom view configuration with a name | userViews table; Zustand View Engine persists to DB via server action |
| VIEW-05 | Load, update, and delete saved views | userViews CRUD server actions; saved views pill bar UI |
| KANBAN-01 | Kiosks as Kanban board grouped by status | dnd-kit DndContext with pipeline stage columns |
| KANBAN-02 | Drag a kiosk card between status columns to update its status | dnd-kit onDragEnd handler; server action to update pipelineStageId |
| KANBAN-03 | Group Kanban board by other fields | groupBy state; disable drag when not stage-grouped |
| BULK-01 | Select multiple records and bulk-edit shared fields | rowSelection state from TanStack Table; bulk edit server action |
| BULK-02 | Export filtered table data to CSV | papaparse unparse(); export includes only current filter state |
| AUDIT-01 | Log every change to kiosk and location records | auditLogs table; write audit entry alongside every mutation |
| AUDIT-02 | View audit log for a specific record | Audit tab on detail pages; paginated query by entityId |
| AUDIT-03 | Admin can view global audit log with filters | Settings > Audit Log page; filterable table with user/entity/date filters |
</phase_requirements>

---

## Summary

Phase 2 builds the entire data management surface for the application on top of the schema and auth foundation laid in Phase 1. The three primary technical domains are: (1) CRUD detail pages with inline editing for kiosks and locations; (2) TanStack Table v8 powering the filterable/sortable/groupable table view with a Zustand View Engine for persisting custom views; and (3) a dnd-kit Kanban board with switchable grouping and server-side stage updates.

The schema is already complete in `src/db/schema.ts` — no schema changes are required. All kiosk fields, the temporal `kioskAssignments` table, the `auditLogs` append-only table, the `userViews` saved-view table, and `pipelineStages` with FLOAT8 ordering are already defined and deployed. Server action patterns, RBAC helpers, and the AppShell component are all production-ready and must be reused without deviation.

The primary complexity in this phase is not individual features but their integration: the View Engine must bridge TanStack Table state (filters, columnVisibility, groupBy, sorting) with Zustand client state and the `userViews` DB persistence layer; the audit log must fire alongside every mutation; and the Kanban groupBy mode switch must correctly enable/disable drag behavior.

**Primary recommendation:** Follow the established server-action + client-component split pattern exactly. Never inline DB queries in client components. Every mutation must write to `auditLogs`. The View Engine (Zustand) is the single source of truth for table state — do not split filter/sort/group state across local component state.

---

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.1 | DB queries and mutations | Already in use; schema defined |
| `next` | 16.1.7 | App Router, server actions, file-based routing | Project framework |
| `react-hook-form` | 7.71.2 | Form handling | Already used in Phase 1 patterns |
| `zod` | 4.3.6 | Validation (Zod v4 — use `zod/v4` import path) | Already in use; `z.email()` not `z.string().email()` |
| `sonner` | 2.0.7 | Toast notifications | Already used for success/error feedback |
| `@base-ui/react` | 1.3.0 | Radix-compatible primitives (via shadcn base-nova preset) | Project design system |
| `lucide-react` | 0.577.0 | Icons | Project icon library |

### New Libraries Required
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@tanstack/react-table` | ^8.x | Table view engine: filter, sort, group, column visibility | Industry standard headless table; no rendering lock-in |
| `@dnd-kit/core` | ^6.x | Drag-and-drop context, event handling | Lightweight, accessible, no pointer event hacks |
| `@dnd-kit/sortable` | ^8.x | Sortable preset for stage management list and kanban | Handles sort index calculation internally |
| `@dnd-kit/utilities` | ^3.x | CSS transform helpers for drag overlay | Companion to sortable |
| `zustand` | ^5.x | View Engine: client state for filters/sort/groupBy/columns | React 18 useSyncExternalStore, minimal boilerplate |
| `react-colorful` | ^5.x | Color picker for pipeline stage management | Small (< 2.8 kB), no dependencies |
| `papaparse` | ^5.x | CSV generation for export | Zero-dependency CSV serializer; handles escaping |
| `@aws-sdk/client-s3` | ^3.x | S3 client for presigned URL generation | Official AWS SDK v3 (modular, tree-shakeable) |
| `@aws-sdk/s3-request-presigner` | ^3.x | getSignedUrl() for PutObject presigned URLs | Required companion to client-s3 |
| `@types/papaparse` | ^5.x | TypeScript types for papaparse | devDependency |

### shadcn Components Required (add via `npx shadcn add`)
As documented in UI-SPEC: `checkbox`, `tabs`, `textarea`, `popover`, `command`, `calendar`, `collapsible`, `scroll-area`, `progress`, `switch`, `form`

**Installation command:**
```bash
npm install @tanstack/react-table @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities zustand react-colorful papaparse @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
npm install -D @types/papaparse
```

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@tanstack/react-table` | Custom table | TanStack handles 15+ edge cases in grouping/filtering; don't hand-roll |
| `@dnd-kit/core` | `react-beautiful-dnd` | react-beautiful-dnd is maintenance-only (no React 18 support); dnd-kit is actively maintained |
| `zustand` | React context + useReducer | Context causes whole-tree re-renders on every filter change; Zustand subscriptions are scoped |
| `papaparse` | Custom CSV serializer | CSV escaping has many edge cases (commas in values, UTF-8 BOM for Excel compatibility); don't hand-roll |
| `@aws-sdk/client-s3` | Route that proxies file through server | Proxying large files through Next.js server wastes bandwidth; presigned URLs upload direct to S3 |

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── app/(app)/
│   ├── kiosks/
│   │   ├── page.tsx                    # Server component: fetch kiosks, pass to client
│   │   ├── [id]/
│   │   │   └── page.tsx               # Server component: fetch kiosk + assignments + audits
│   │   └── new/
│   │       └── page.tsx               # Server component: fetch pipeline stages for select
│   ├── locations/
│   │   ├── page.tsx
│   │   ├── [id]/
│   │   │   └── page.tsx
│   │   └── new/
│   │       └── page.tsx
│   └── settings/
│       ├── pipeline-stages/
│       │   └── page.tsx               # Redirects to /kiosks with manage-stages modal open
│       └── audit-log/
│           └── page.tsx
├── components/
│   ├── kiosks/
│   │   ├── kiosk-table.tsx            # TanStack Table client component
│   │   ├── kiosk-kanban.tsx           # dnd-kit board client component
│   │   ├── kiosk-detail-form.tsx      # Inline editing detail page
│   │   └── kiosk-card.tsx             # Kanban card
│   ├── locations/
│   │   ├── location-table.tsx
│   │   └── location-detail-form.tsx
│   ├── pipeline/
│   │   └── manage-stages-modal.tsx    # Shared modal for Kanban header + Settings
│   ├── table/
│   │   ├── view-engine.tsx            # Toolbar: filters, groupBy, column visibility
│   │   ├── saved-views-bar.tsx        # Pill bar of saved views
│   │   ├── bulk-toolbar.tsx           # Fixed-bottom bulk actions bar
│   │   └── csv-export.tsx             # Export button handler
│   └── audit/
│       ├── audit-timeline.tsx         # Per-record day-grouped timeline
│       └── audit-table.tsx            # Global admin audit log table
├── lib/
│   ├── stores/
│   │   └── view-engine-store.ts       # Zustand store: filters, sort, groupBy, columnVisibility
│   └── audit.ts                       # writeAuditLog() helper — call from every mutation action
└── app/(app)/
    ├── kiosks/actions.ts              # All kiosk server actions
    ├── locations/actions.ts           # All location server actions
    └── settings/pipeline-stages/actions.ts
```

### Pattern 1: Server Action with Audit Log
Every mutation MUST write an audit log entry. Use a shared `writeAuditLog()` helper to avoid repetition.

```typescript
// src/lib/audit.ts
import { db } from "@/db";
import { auditLogs } from "@/db/schema";

export async function writeAuditLog(entry: {
  actorId: string;
  actorName: string;
  entityType: "kiosk" | "location";
  entityId: string;
  entityName: string;
  action: "create" | "update" | "archive" | "assign" | "unassign";
  field?: string;
  oldValue?: string;
  newValue?: string;
}) {
  await db.insert(auditLogs).values({
    ...entry,
    createdAt: new Date(),
  });
}
```

```typescript
// src/app/(app)/kiosks/actions.ts — update example
"use server";
export async function updateKioskField(
  kioskId: string,
  field: string,
  value: unknown,
  oldValue: unknown
) {
  const session = await requireRole("admin", "member");
  await db.update(kiosks).set({ [field]: value, updatedAt: new Date() })
    .where(eq(kiosks.id, kioskId));
  await writeAuditLog({
    actorId: session.user.id,
    actorName: session.user.name,
    entityType: "kiosk",
    entityId: kioskId,
    entityName: kioskId,
    action: "update",
    field,
    oldValue: String(oldValue ?? ""),
    newValue: String(value ?? ""),
  });
  return { success: true };
}
```

### Pattern 2: TanStack Table v8 Setup with Zustand View Engine

The Zustand store is the single source of truth for all table state. TanStack Table consumes it via controlled state props.

```typescript
// src/lib/stores/view-engine-store.ts
import { create } from "zustand";
import type { ColumnFiltersState, SortingState, VisibilityState } from "@tanstack/react-table";

interface ViewEngineState {
  columnFilters: ColumnFiltersState;
  sorting: SortingState;
  grouping: string[];
  columnVisibility: VisibilityState;
  globalFilter: string;
  setColumnFilters: (filters: ColumnFiltersState) => void;
  setSorting: (sorting: SortingState) => void;
  setGrouping: (grouping: string[]) => void;
  setColumnVisibility: (visibility: VisibilityState) => void;
  setGlobalFilter: (filter: string) => void;
  applyView: (config: Partial<ViewEngineState>) => void;
}

export const useViewEngineStore = create<ViewEngineState>((set) => ({
  columnFilters: [],
  sorting: [{ id: "createdAt", desc: true }], // Default: newest first
  grouping: [],
  columnVisibility: {},
  globalFilter: "",
  setColumnFilters: (columnFilters) => set({ columnFilters }),
  setSorting: (sorting) => set({ sorting }),
  setGrouping: (grouping) => set({ grouping }),
  setColumnVisibility: (columnVisibility) => set({ columnVisibility }),
  setGlobalFilter: (globalFilter) => set({ globalFilter }),
  applyView: (config) => set(config),
}));
```

```typescript
// src/components/kiosks/kiosk-table.tsx (simplified)
"use client";
import { useReactTable, getCoreRowModel, getFilteredRowModel,
         getSortedRowModel, getGroupedRowModel } from "@tanstack/react-table";
import { useViewEngineStore } from "@/lib/stores/view-engine-store";

export function KioskTable({ data, columns }) {
  const { columnFilters, sorting, grouping, columnVisibility, globalFilter,
          setColumnFilters, setSorting, setGrouping, setColumnVisibility, setGlobalFilter }
    = useViewEngineStore();

  const table = useReactTable({
    data,
    columns,
    state: { columnFilters, sorting, grouping, columnVisibility, globalFilter },
    onColumnFiltersChange: setColumnFilters,
    onSortingChange: setSorting,
    onGroupingChange: setGrouping,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
  });
  // ...render
}
```

### Pattern 3: dnd-kit Kanban Board

```typescript
// src/components/kiosks/kiosk-kanban.tsx (simplified)
"use client";
import { DndContext, DragOverlay, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

export function KioskKanban({ kiosks, stages, groupBy, onStageChange }) {
  const isDragEnabled = groupBy === "pipelineStageId";

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragEnd={async ({ active, over }) => {
        if (!isDragEnabled || !over) return;
        const newStageId = over.id as string;
        await updateKioskPipelineStage(active.id as string, newStageId);
        onStageChange(active.id as string, newStageId);
      }}
    >
      {stages.map((stage) => (
        <KanbanColumn key={stage.id} stage={stage} isDragEnabled={isDragEnabled}>
          <SortableContext
            items={kiosksInStage.map(k => k.id)}
            strategy={verticalListSortingStrategy}
            disabled={!isDragEnabled}
          >
            {kiosksInStage.map(kiosk => <KioskCard key={kiosk.id} kiosk={kiosk} />)}
          </SortableContext>
        </KanbanColumn>
      ))}
    </DndContext>
  );
}
```

### Pattern 4: S3 Presigned URL Upload for Contract Documents

```typescript
// src/app/(app)/locations/actions.ts
"use server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({ region: process.env.AWS_REGION! });

export async function getContractUploadUrl(fileName: string, contentType: string) {
  await requireRole("admin", "member");
  const s3Key = `contracts/${crypto.randomUUID()}-${fileName}`;
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET!,
    Key: s3Key,
    ContentType: contentType,
  });
  const presignedUrl = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5 min
  return { presignedUrl, s3Key };
}

export async function saveContractDocument(locationId: string, s3Key: string, fileName: string) {
  await requireRole("admin", "member");
  // Fetch current documents, append new entry, update DB
  const [location] = await db.select().from(locations).where(eq(locations.id, locationId));
  const existing = location.contractDocuments ?? [];
  await db.update(locations).set({
    contractDocuments: [...existing, { fileName, s3Key, uploadedAt: new Date().toISOString() }],
    updatedAt: new Date(),
  }).where(eq(locations.id, locationId));
  await writeAuditLog({ /* ... action: "update", field: "contractDocuments" */ });
  return { success: true };
}
```

### Pattern 5: Inline Field Editing Component

```typescript
// src/components/ui/inline-edit-field.tsx — generic reusable component
"use client";
import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";

interface InlineEditFieldProps {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  fieldName: string;
}

export function InlineEditField({ value, onSave, fieldName }: InlineEditFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (draft === value) { setIsEditing(false); return; }
    setSaving(true);
    try {
      await onSave(draft);
      setIsEditing(false);
      setError(null);
    } catch {
      setError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!isEditing) {
    return (
      <span
        className="cursor-text underline-offset-2 hover:underline hover:decoration-wk-mid-grey"
        onClick={() => { setDraft(value); setIsEditing(true); }}
      >
        {value || "—"}
      </span>
    );
  }

  return (
    <div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setIsEditing(false); }}
        disabled={saving}
        autoFocus
        className={error ? "border-destructive" : "border-wk-azure"}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
```

### Pattern 6: Saved View Persistence

```typescript
// Save current View Engine state to userViews table
export async function saveView(name: string, entityType: string, config: {
  filters?: ColumnFiltersState;
  sort?: SortingState;
  groupBy?: string;
  columns?: string[];
}) {
  const session = await requireRole("admin", "member", "viewer");
  await db.insert(userViews).values({
    userId: session.user.id,
    name,
    entityType,
    config,
  });
  return { success: true };
}
```

### Pattern 7: CSV Export with papaparse

```typescript
// Client-side export — runs after TanStack Table filtering is applied
import Papa from "papaparse";

function exportTableToCSV(table: Table<KioskRow>, fileName: string) {
  const rows = table.getFilteredRowModel().rows;
  const visibleColumns = table.getVisibleFlatColumns()
    .filter(col => col.id !== "select" && col.id !== "actions");
  const data = rows.map(row =>
    Object.fromEntries(visibleColumns.map(col => [col.columnDef.header, row.getValue(col.id)]))
  );
  const csv = Papa.unparse(data);
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" }); // UTF-8 BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
```

### Pattern 8: Pipeline Stage Reordering (FLOAT8 Midpoint)

```typescript
// When dragging a stage between positions A and B:
// newPosition = (positionA + positionB) / 2
// This avoids batch UPDATE race conditions (FLOAT8 never runs out of precision for typical use)

export async function reorderPipelineStage(stageId: string, afterPosition: number, beforePosition: number) {
  await requireRole("admin");
  const newPosition = (afterPosition + beforePosition) / 2;
  await db.update(pipelineStages).set({ position: newPosition, updatedAt: new Date() })
    .where(eq(pipelineStages.id, stageId));
  return { success: true };
}
```

### Anti-Patterns to Avoid

- **Splitting table state across useState + Zustand**: Use only Zustand for all View Engine state. Never store filters in local useState alongside the store — they will desync.
- **Fetching data client-side in table component**: Server component fetches all data, passes as prop to client table component. No `useEffect` fetches in table components.
- **Writing audit logs in DB triggers**: Project decision: application-layer audit via `writeAuditLog()` helper. DB triggers can't capture actor names or business context.
- **Proxying file uploads through Next.js**: Always generate presigned URLs and upload direct to S3. Never `req.body` a file through a server action.
- **Soft delete via a `deletedAt` column not yet in schema**: The schema does not have a `deletedAt` column. Add it in a migration. Use `is(kiosks.deletedAt, null)` in default queries.
- **Using `eq(kiosks.pipelineStageId, stageId)` for "no stage" check**: Use `isNull(kiosks.pipelineStageId)` — not `eq(..., null)`.
- **Nested dnd-kit DndContext**: Only one DndContext per board. Do not nest DndContext inside another DndContext (e.g., for the stage management modal inside the kanban page).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Table filter/sort/group/column-visibility state machine | Custom reducer | `@tanstack/react-table` v8 | 15+ edge cases in grouping with filtering; row aggregation; controlled state sync |
| Drag-and-drop with keyboard accessibility | Mouse event listeners | `@dnd-kit/core` | Pointer events, keyboard navigation, screen reader announcements built-in |
| CSV serialization | String concatenation | `papaparse` | Commas inside values, double-quote escaping, UTF-8 BOM for Excel, line ending normalization |
| Color picker component | `<input type="color">` | `react-colorful` | `<input type="color">` has no hex input field, no preset swatches, no consistent cross-browser rendering |
| FLOAT8 position midpoint algorithm | Custom ordering | Established midpoint pattern | Already decided in project; prevents race conditions on concurrent reorders |
| S3 upload URL generation | Proxy file through server | `@aws-sdk/s3-request-presigner` | File size limits on serverless, bandwidth costs, upload timeout on Vercel |

**Key insight:** The entire complexity of this phase lives at integration points (audit log on every mutation, View Engine bridging Zustand to TanStack Table, FLOAT8 reordering) — not in any individual feature. Adopting standard libraries eliminates the lower-level complexity so integration can be the focus.

---

## Common Pitfalls

### Pitfall 1: Missing `deletedAt` Column for Soft Delete
**What goes wrong:** The current schema has no `deletedAt` (or `archivedAt`) column on `kiosks` or `locations`. Trying to query `where(isNull(kiosks.deletedAt))` will fail at TypeScript compile time and runtime.
**Why it happens:** Schema was defined before the archive requirement was locked in CONTEXT.md.
**How to avoid:** Wave 0 of Plan 02-01 MUST add `archivedAt: timestamp("archived_at")` (nullable) to both `kiosks` and `locations` tables and run `drizzle-kit generate` + `drizzle-kit migrate`.
**Warning signs:** TypeScript errors referencing `archivedAt` not existing on schema type.

### Pitfall 2: TanStack Table Grouping Conflicts with Row Selection
**What goes wrong:** When grouping is active, TanStack Table row models change shape. Checkbox selection on group header rows needs explicit handling — `row.getIsGrouped()` returns true for group rows.
**Why it happens:** TanStack Table creates synthetic "group" rows that are not data rows. Passing these IDs to bulk-edit actions will fail.
**How to avoid:** In checkbox column definition, use `row.getIsGrouped() ? undefined : row.getToggleSelectedHandler()`. Only collect `row.original` from selected rows where `!row.getIsGrouped()`.

### Pitfall 3: Zustand Store Not Reset Between Entity Types
**What goes wrong:** If the same Zustand store instance is used for kiosk table and location table, navigating from `/kiosks` to `/locations` will carry over filters/columns from the previous entity.
**Why it happens:** Zustand stores are module-level singletons in Next.js.
**How to avoid:** Create separate store instances per entity type (`useKioskViewStore`, `useLocationViewStore`) OR include `entityType` in store key and reset on entity change.

### Pitfall 4: dnd-kit onDragEnd Server Action Not Awaited Correctly
**What goes wrong:** `onDragEnd` is synchronous in dnd-kit. If you call an async server action inside it without optimistic update, the UI snaps back before the server responds.
**Why it happens:** DndContext `onDragEnd` does not support async handlers; React state update happens synchronously.
**How to avoid:** Apply optimistic update to local `kiosks` state immediately in `onDragEnd`, then call the server action. On error, revert the optimistic update and show a toast.

### Pitfall 5: S3 CORS Not Configured for Presigned PUT
**What goes wrong:** Client-side `fetch(presignedUrl, { method: "PUT", body: file })` fails with CORS error even though the presigned URL is valid.
**Why it happens:** S3 bucket CORS policy must explicitly allow PUT from the app's origin.
**How to avoid:** S3 bucket CORS must include: `AllowedMethods: ["PUT", "GET"]`, `AllowedOrigins: ["https://your-app-domain.com"]`, `AllowedHeaders: ["*"]`. Document this as an environment setup requirement.

### Pitfall 6: Audit Log Not Firing for Inline Edits
**What goes wrong:** Inline field edits use per-field server actions (e.g., `updateKioskField("kioskId", "hardwareModel", newVal, oldVal)`). It is easy to forget the audit log write in any one of ~20 field actions.
**Why it happens:** Many individual actions; audit log write is a side effect that is easy to skip.
**How to avoid:** The `writeAuditLog()` helper must be called at the END of every mutation action. Add ESLint or code review checklist item. Consider a wrapper utility that enforces it.

### Pitfall 7: papaparse `unparse()` Column Order Not Deterministic
**What goes wrong:** CSV columns appear in a random order when using `Object.fromEntries()`.
**Why it happens:** `Object.fromEntries` preserves insertion order but `Papa.unparse` with object array uses `Object.keys(data[0])` for column order, which depends on property order.
**How to avoid:** Pass an explicit `fields` array as second arg: `Papa.unparse({ fields: orderedHeaders, data: rows })`.

### Pitfall 8: Zod v4 Import Path
**What goes wrong:** `import { z } from "zod"` works but `z.email()` throws at runtime because the project uses Zod v4 features only available via `zod/v4`.
**Why it happens:** The project uses `"zod": "^4.3.6"` and existing actions use `import { z } from "zod/v4"`.
**How to avoid:** Always use `import { z } from "zod/v4"` — not `"zod"` — in all new server actions.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `react-beautiful-dnd` | `@dnd-kit/core` | 2022 (rbd went maintenance-only) | dnd-kit supports React 18 StrictMode, pointer events, keyboard |
| `react-table` v7 | `@tanstack/react-table` v8 | 2022 | v8 is headless, TypeScript-native, framework-agnostic |
| Zustand v4 | Zustand v5 | 2024 | v5 uses useSyncExternalStore, React 18 concurrent mode safe |
| `import { z } from "zod"` for v4 | `import { z } from "zod/v4"` | 2024 (Zod 4.x) | New API (`z.email()` instead of `z.string().email()`) |
| AWS SDK v2 (class-based) | AWS SDK v3 (`@aws-sdk/client-s3`) | 2020 | Modular, tree-shakeable; v2 is in maintenance mode |

**Deprecated/outdated:**
- `react-beautiful-dnd`: Maintenance-only since 2022 — does not support React 18 StrictMode correctly. Use `@dnd-kit/core`.
- `AWS SDK v2 (aws-sdk)`: Use `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` from SDK v3.
- Zod `z.string().email()`: Use `z.email()` directly (Zod v4 shorthand via `zod/v4` import).

---

## Open Questions

1. **AWS S3 Bucket Configuration**
   - What we know: Contract document uploads use presigned PUT URLs via `@aws-sdk/client-s3`
   - What's unclear: Whether an S3 bucket and IAM credentials are already provisioned for the project
   - Recommendation: Wave 0 of Plan 02-02 should verify `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET` environment variables exist. If not, document them as setup prerequisites; stub the upload action to return a mock URL in dev.

2. **Pipeline Stage Seed Data**
   - What we know: `pipelineStages` table exists; `isDefault` flag implemented
   - What's unclear: Whether the table is empty or has seed data from Phase 1
   - Recommendation: Wave 0 of Plan 02-01 should check if pipeline stages exist in DB and run a seed if empty. Default stages: Prospect (default), On Hold, Delivered to Region, Awaiting Configuration, Configured, Ready to Launch, Live, Offline, Decommissioned.

3. **`archivedAt` Column Migration Timing**
   - What we know: Soft delete is a locked decision; `archivedAt` column is missing from schema
   - What's unclear: Whether this should be added in Plan 02-01 (kiosk CRUD) only, or upfront for both entities
   - Recommendation: Add `archivedAt` to both `kiosks` and `locations` in a single migration at the start of Plan 02-01. One migration, both tables.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Playwright 1.58.2 |
| Config file | `playwright.config.ts` (exists) |
| Quick run command | `npx playwright test tests/smoke.spec.ts` |
| Full suite command | `npx playwright test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| KIOSK-01 | Create a kiosk via form, verify it appears in table | E2E | `npx playwright test tests/kiosks/kiosk-crud.spec.ts` | Wave 0 |
| KIOSK-02 | Edit a kiosk field inline, verify save | E2E | `npx playwright test tests/kiosks/kiosk-crud.spec.ts` | Wave 0 |
| KIOSK-03 | Pipeline stage select on kiosk detail | E2E | `npx playwright test tests/kiosks/kiosk-crud.spec.ts` | Wave 0 |
| KIOSK-04 | Admin adds/renames/deletes pipeline stage | E2E | `npx playwright test tests/kiosks/pipeline-stages.spec.ts` | Wave 0 |
| KIOSK-05/06 | Assign kiosk to venue, verify assignment + history | E2E | `npx playwright test tests/kiosks/kiosk-assignment.spec.ts` | Wave 0 |
| LOC-01/02 | Create and edit a location record | E2E | `npx playwright test tests/locations/location-crud.spec.ts` | Wave 0 |
| LOC-03 | Upload a contract document | E2E (manual if no S3 in CI) | `npx playwright test tests/locations/location-contract.spec.ts` | Wave 0 |
| LOC-04 | Banking section hidden for Viewer role | E2E | `npx playwright test tests/locations/location-rbac.spec.ts` | Wave 0 |
| LOC-05 | Location Kiosks tab shows assigned kiosks | E2E | `npx playwright test tests/locations/location-kiosks-tab.spec.ts` | Wave 0 |
| VIEW-01/02/03 | Filter + group + show/hide columns in kiosk table | E2E | `npx playwright test tests/kiosks/table-view.spec.ts` | Wave 0 |
| VIEW-04/05 | Save and reload a named view | E2E | `npx playwright test tests/kiosks/saved-views.spec.ts` | Wave 0 |
| KANBAN-01/02 | Kanban renders; drag card to new stage column | E2E | `npx playwright test tests/kiosks/kanban.spec.ts` | Wave 0 |
| KANBAN-03 | Switch Kanban groupBy, verify drag disabled | E2E | `npx playwright test tests/kiosks/kanban.spec.ts` | Wave 0 |
| BULK-01 | Select 2+ rows, bulk edit a shared field | E2E | `npx playwright test tests/kiosks/bulk-operations.spec.ts` | Wave 0 |
| BULK-02 | Export filtered kiosks to CSV, verify download | E2E | `npx playwright test tests/kiosks/bulk-operations.spec.ts` | Wave 0 |
| AUDIT-01/02 | Edit a field, verify it appears in record audit tab | E2E | `npx playwright test tests/audit/audit-log.spec.ts` | Wave 0 |
| AUDIT-03 | Admin views global audit log, applies filters | E2E | `npx playwright test tests/audit/audit-log.spec.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx playwright test tests/smoke.spec.ts`
- **Per wave merge:** `npx playwright test tests/kiosks/ tests/locations/` (plan-specific suite)
- **Phase gate:** `npx playwright test` — full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/kiosks/kiosk-crud.spec.ts` — covers KIOSK-01, KIOSK-02, KIOSK-03
- [ ] `tests/kiosks/pipeline-stages.spec.ts` — covers KIOSK-04
- [ ] `tests/kiosks/kiosk-assignment.spec.ts` — covers KIOSK-05, KIOSK-06
- [ ] `tests/locations/location-crud.spec.ts` — covers LOC-01, LOC-02
- [ ] `tests/locations/location-contract.spec.ts` — covers LOC-03 (may mock S3 in CI)
- [ ] `tests/locations/location-rbac.spec.ts` — covers LOC-04
- [ ] `tests/locations/location-kiosks-tab.spec.ts` — covers LOC-05
- [ ] `tests/kiosks/table-view.spec.ts` — covers VIEW-01, VIEW-02, VIEW-03
- [ ] `tests/kiosks/saved-views.spec.ts` — covers VIEW-04, VIEW-05
- [ ] `tests/kiosks/kanban.spec.ts` — covers KANBAN-01, KANBAN-02, KANBAN-03
- [ ] `tests/kiosks/bulk-operations.spec.ts` — covers BULK-01, BULK-02
- [ ] `tests/audit/audit-log.spec.ts` — covers AUDIT-01, AUDIT-02, AUDIT-03
- [ ] `tests/helpers/auth.ts` — shared fixture: login as admin/member/viewer
- [ ] `tests/helpers/db.ts` — shared fixture: create test kiosk/location records

---

## Sources

### Primary (HIGH confidence)
- `src/db/schema.ts` — Complete schema; all tables verified in source
- `src/app/(app)/settings/users/actions.ts` — Server action pattern (try/catch, requireRole, Zod v4)
- `src/lib/rbac.ts` — RBAC helpers (requireRole, canAccessSensitiveFields, redactSensitiveFields)
- `src/components/admin/user-table.tsx` — Client component pattern (no data fetching, props-driven)
- `package.json` — Exact dependency versions confirmed
- `playwright.config.ts` — Test infrastructure confirmed
- [TanStack Table v8 Column Visibility Guide](https://tanstack.com/table/v8/docs/guide/column-visibility) — columnVisibility state API
- [TanStack Table v8 Grouping Guide](https://tanstack.com/table/v8/docs/guide/grouping) — groupedRowModel, grouping state
- [TanStack Table v8 Filters Guide](https://tanstack.com/table/v8/docs/guide/filters) — filterFromLeafRows option
- [dnd-kit Sortable Docs](https://docs.dndkit.com/presets/sortable) — SortableContext, strategy, items prop ordering

### Secondary (MEDIUM confidence)
- [Next.js S3 Presigned URL guide — Neon](https://neon.com/guides/next-upload-aws-s3) — presigned URL pattern with App Router server actions verified against AWS SDK v3 docs
- [dnd-kit Kanban board — LogRocket](https://blog.logrocket.com/build-kanban-board-dnd-kit-react/) — DndContext + droppable column pattern; cross-referenced with official dnd-kit docs
- [Zustand v5 — DEV Community](https://dev.to/vishwark/mastering-zustand-the-modern-react-state-manager-v4-v5-guide-8mm) — useSyncExternalStore confirmed against GitHub repo

### Tertiary (LOW confidence)
- None — all critical claims verified against source code or official documentation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified against `package.json` and official docs
- Architecture patterns: HIGH — directly derived from existing Phase 1 patterns in source code
- Pitfalls: HIGH (schema pitfalls) / MEDIUM (S3 CORS, dnd-kit async) — schema verified in source; S3/dnd-kit from cross-referenced community sources

**Research date:** 2026-03-19
**Valid until:** 2026-04-18 (30 days — TanStack Table and dnd-kit are stable)
