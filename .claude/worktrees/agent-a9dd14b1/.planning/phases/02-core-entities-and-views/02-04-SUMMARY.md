---
phase: 02-core-entities-and-views
plan: "04"
subsystem: kanban
tags: [kanban, dnd-kit, pipeline-stages, drag-and-drop, optimistic-ui, color-picker, react-colorful, playwright]
dependency_graph:
  requires: ["02-01", "02-03"]
  provides: ["kiosk-kanban", "kiosk-card", "manage-stages-modal", "pipeline-stage-actions"]
  affects: ["02-05"]
tech_stack:
  added: []
  patterns:
    - "Optimistic drag-and-drop: local state updated immediately, server action called async, reverted on error"
    - "Single DndContext per board — ManageStagesModal's DndContext is safe as a Dialog overlay outside the kanban DOM"
    - "DroppableColumn wrapper: useDroppable provides drop target for cross-column card moves"
    - "PointerSensor with activationConstraint: distance 8px — allows click to navigate, requires intent to drag"
    - "getStageKioskCount server action avoids internal API route — server action callable from client components directly"
    - "DropdownMenuTrigger uses render={} prop — base-ui does not support asChild pattern"
    - "Select onValueChange returns string | null — handle null with ?? fallback"
key_files:
  created:
    - src/app/(app)/settings/pipeline-stages/actions.ts
    - src/app/(app)/settings/pipeline-stages/page.tsx
    - src/app/(app)/settings/pipeline-stages/pipeline-stages-client.tsx
    - src/components/pipeline/manage-stages-modal.tsx
    - src/components/kiosks/kiosk-card.tsx
    - src/components/kiosks/kiosk-kanban.tsx
  modified:
    - src/app/(app)/kiosks/page.tsx
    - src/app/(app)/settings/page.tsx
    - tests/kiosks/pipeline-stages.spec.ts
    - tests/kiosks/kanban.spec.ts
decisions:
  - "Used getStageKioskCount server action instead of internal API route — server actions are callable from client components via 'use server' boundary"
  - "DropdownMenuTrigger uses render={<Button />} not asChild — base-ui Menu.Trigger uses render prop pattern, not Radix asChild"
  - "Settings page converted from redirect to overview with cards — provides natural navigation to Users and Pipeline Stages sections"
  - "PointerSensor activationConstraint distance:8px — allows card click-to-navigate while requiring deliberate drag intent"
metrics:
  duration: "~28min"
  completed_date: "2026-03-19"
  tasks_completed: 2
  tasks_total: 2
  files_created: 6
  files_modified: 4
---

# Phase 02 Plan 04: Kanban Board and Pipeline Stage Management Summary

dnd-kit Kanban board for kiosk pipeline visibility with optimistic drag-to-stage-update, switchable grouping, and admin pipeline stage management modal with drag reorder, color picker, and inline delete with kiosk reassignment.

## What Was Built

**Task 1 — Pipeline stage management server actions and modal** (`e5442a8`)
- `src/app/(app)/settings/pipeline-stages/actions.ts`: 5 server actions (all admin-only via `requireRole("admin")`):
  - `createStage(name, color)` — appends at maxPosition + 1000
  - `updateStage(stageId, data)` — handles isDefault by unsetting all others first
  - `deleteStage(stageId, reassignToStageId)` — checks kiosk count, prevents last-stage delete, optional reassignment
  - `reorderStage(stageId, afterPosition, beforePosition)` — FLOAT8 midpoint `(after + before) / 2`
  - `getStageKioskCount(stageId)` — count for delete flow decision
- `src/components/pipeline/manage-stages-modal.tsx`: Dialog with dnd-kit sortable list, inline rename on click, color picker (10 WeKnow brand presets + react-colorful HexColorPicker), set-as-default, inline delete with reassignment select (no nested dialog)
- `src/app/(app)/settings/pipeline-stages/page.tsx`: Server component + client wrapper auto-opens modal
- `src/app/(app)/settings/page.tsx`: Converted from redirect to settings overview with Users and Pipeline Stages cards
- 6 Playwright E2E tests passing (KIOSK-04)

**Task 2 — Kanban board with dnd-kit drag-to-update and switchable grouping** (`12c90f5`)
- `src/components/kiosks/kiosk-card.tsx`: Draggable card via `useSortable` — kiosk ID (bold), venue name, region badge, CMS config dot (green/grey); hover shadow-md, dragging opacity+scale via isDragging; click navigates to `/kiosks/[id]`
- `src/components/kiosks/kiosk-kanban.tsx`: Full Kanban board:
  - 4 grouping options: Pipeline Stage (default), Region, Hotel Group, CMS Config
  - DndContext with PointerSensor (distance:8px activation) + closestCenter collision detection
  - DroppableColumn wrapper per stage column using `useDroppable`
  - Optimistic stage update on drag end, revert + sonner toast on error
  - DragOverlay ghost card with `isGhost=true` prop
  - Info banner "Switch to stage grouping to drag cards" when not in stage grouping
  - ManageStagesModal rendered outside DndContext (safe as Dialog overlay)
- `src/app/(app)/kiosks/page.tsx`: Wired — fetches both `listKiosks()` and `listPipelineStages()` in parallel, passes to KioskKanban in Kanban tab
- 6 Playwright E2E tests passing (KANBAN-01, KANBAN-02, KANBAN-03)

**Test fix** (`ce49602`)
- Pipeline stages "set as default" test made robust to sequential state pollution — dynamically finds non-default, enabled "Set as default" option

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] base-ui DropdownMenuTrigger does not support asChild prop**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** Used `<DropdownMenuTrigger asChild>` pattern (Radix UI convention) but base-ui Menu.Trigger uses `render={}` prop
- **Fix:** Changed to `<DropdownMenuTrigger render={<Button ... />}>` matching base-ui pattern (same as Plan 02-03 fix)
- **Files modified:** src/components/pipeline/manage-stages-modal.tsx
- **Commit:** e5442a8

**2. [Rule 1 - Bug] base-ui Select onValueChange receives string | null not string**
- **Found during:** Task 1 TypeScript compilation
- **Issue:** Passed `setReassignTarget` directly but base-ui Select `onValueChange` signature is `(value: string | null) => void`, not `(value: string) => void`
- **Fix:** Changed to `(v) => setReassignTarget(v ?? "")` to handle null gracefully
- **Files modified:** src/components/pipeline/manage-stages-modal.tsx
- **Commit:** e5442a8

**3. [Rule 2 - Critical functionality] Replaced internal API fetch with server action call**
- **Found during:** Task 1 implementation — plan said to get kiosk count via fetch to internal API
- **Issue:** No internal API route for stage kiosk count exists; creating one would be unnecessary complexity
- **Fix:** Imported `getStageKioskCount` server action directly — Next.js server actions are callable from client components without an API route
- **Files modified:** src/components/pipeline/manage-stages-modal.tsx
- **Commit:** e5442a8

**4. [Rule 1 - Bug] Settings page needed conversion from redirect to overview**
- **Found during:** Task 1 Step 3 — plan said to add Pipeline Stages section to settings/page.tsx
- **Issue:** settings/page.tsx was a bare `redirect("/settings/users")` — no room for Pipeline Stages card
- **Fix:** Converted to a proper settings overview page with Users and Pipeline Stages cards (still allows direct navigation to /settings/users)
- **Files modified:** src/app/(app)/settings/page.tsx
- **Commit:** e5442a8

## Self-Check: PASSED
