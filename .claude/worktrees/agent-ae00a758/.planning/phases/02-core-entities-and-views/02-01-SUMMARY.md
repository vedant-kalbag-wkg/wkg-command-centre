---
phase: 02-core-entities-and-views
plan: "01"
subsystem: kiosks
tags: [crud, inline-edit, assignment, audit, soft-delete, playwright]
dependency_graph:
  requires: ["02-00"]
  provides: ["kiosk-crud", "inline-edit-field", "audit-helper", "pipeline-stages-seed"]
  affects: ["02-02", "02-03", "02-04"]
tech_stack:
  added: []
  patterns:
    - "InlineEditField: click-to-edit span that resolves to input/select/date/switch on click"
    - "Server actions return { success: true } | { error: string } discriminated union"
    - "Soft delete via archivedAt timestamp — filtered with IS NULL in default queries"
    - "Temporal kiosk assignments: kioskAssignments rows, close old with unassignedAt before inserting new"
    - "writeAuditLog helper called by every mutation action before returning"
    - "Supabase session-mode pooler constraints: max:2 DB connections, workers:1 Playwright"
key_files:
  created:
    - src/lib/audit.ts
    - src/db/seed-pipeline-stages.ts
    - src/components/ui/inline-edit-field.tsx
    - src/app/(app)/kiosks/actions.ts
    - src/app/(app)/kiosks/[id]/page.tsx
    - src/app/(app)/kiosks/new/page.tsx
    - src/components/kiosks/kiosk-detail-form.tsx
    - src/components/kiosks/assignment-history.tsx
    - migrations/0001_red_vengeance.sql
  modified:
    - src/db/schema.ts
    - src/db/index.ts
    - src/app/(app)/kiosks/page.tsx
    - src/components/ui/inline-edit-field.tsx
    - playwright.config.ts
    - tests/kiosks/kiosk-crud.spec.ts
    - tests/kiosks/kiosk-assignment.spec.ts
decisions:
  - "Used drizzle-kit push instead of drizzle-kit migrate — session-mode pooler on port 5432 causes migrate to hang indefinitely"
  - "Changed actor_id and assigned_by from uuid to text — Better Auth v1.5 uses TEXT IDs (not UUID)"
  - "DB pool capped at max:2 — Supabase session-mode pooler rejects connections above limit (MaxClientsInSessionMode error)"
  - "Playwright workers:1 — parallel test workers exhaust Supabase connection pool"
  - "InlineEditField uses items prop on base-ui Select.Root — required for SelectValue to display label instead of raw UUID"
  - "Blur via Tab key press in tests — clicking section header toggles collapsible, Tab is a safe non-destructive blur"
metrics:
  duration: "~3 hours"
  completed_date: "2026-03-19"
  tasks_completed: 2
  tasks_total: 2
  files_created: 9
  files_modified: 8
---

# Phase 02 Plan 01: Kiosk CRUD and Detail Pages Summary

Complete kiosk CRUD with inline editing, venue assignment, soft-delete archiving, and audit logging — backed by seeded pipeline stages and a reusable InlineEditField component.

## What Was Built

**Task 1 — Schema, audit helper, pipeline seed, InlineEditField** (`32396b7`)
- Added `archivedAt` column to both `kiosks` and `locations` tables
- Changed `actor_id` and `assigned_by` from `uuid` to `text` (Better Auth uses TEXT IDs)
- Created `src/lib/audit.ts` with `writeAuditLog()` helper for all mutations
- Created `src/db/seed-pipeline-stages.ts` — seeded 9 pipeline stages (Prospect through Decommissioned) with FLOAT8 positions
- Created `src/components/ui/inline-edit-field.tsx` with 6 field types: text, textarea, number, select, date, switch
- Fixed base-ui `Select.Root` — must pass `items` prop for `SelectValue` to display label instead of raw UUID

**Task 2 — Kiosk actions, pages, components, E2E tests** (`34dbc4a`)
- `src/app/(app)/kiosks/actions.ts` — 9 server actions: createKiosk, getKiosk, updateKioskField, archiveKiosk, assignKiosk, reassignKiosk, listKiosks, listPipelineStages, listLocationsForSelect
- `src/app/(app)/kiosks/[id]/page.tsx` — server component with full kiosk detail
- `src/app/(app)/kiosks/new/page.tsx` — create form with all 14 fields
- `src/components/kiosks/kiosk-detail-form.tsx` — client component with 4 collapsible sections (Identity, Hardware & Software, Deployment, Billing), Tabs (Details/Audit), archive dialog, venue assignment dialog
- `src/components/kiosks/assignment-history.tsx` — timeline of past venue assignments
- Updated `src/app/(app)/kiosks/page.tsx` — card grid list with kiosk ID, venue name, stage badge
- Tuned DB pool: `max: 2` connections to avoid Supabase session-mode exhaustion
- Set `playwright.config.ts` to `workers: 1, fullyParallel: false` for same reason
- All 12 Playwright E2E tests passing: kiosk-crud.spec.ts (8 tests) + kiosk-assignment.spec.ts (4 tests)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Changed actor_id and assigned_by from uuid to text**
- **Found during:** Task 2 — createKiosk was crashing with "invalid input syntax for type uuid"
- **Issue:** Better Auth v1.5 generates TEXT session IDs (e.g., "MPnrgDcYBDusXNSDFddoOF2pBpbZB5gD"), but audit_logs.actor_id and kiosk_assignments.assigned_by were defined as `uuid` in the schema
- **Fix:** Changed both to `text()` in schema.ts, generated migration 0001_red_vengeance.sql, ran drizzle-kit push
- **Files modified:** src/db/schema.ts, migrations/0001_red_vengeance.sql
- **Commit:** 34dbc4a (included in Task 2 commit)

**2. [Rule 1 - Bug] Fixed empty string → null conversion for nullable numeric fields**
- **Found during:** Task 2 — createKiosk was crashing with "invalid input syntax for type numeric: \"\""
- **Issue:** maintenanceFee was being sent as empty string "" when not filled. `?? null` doesn't coerce empty strings; `|| null` does.
- **Fix:** Changed all nullable field assignments from `field ?? null` to `field || null` in createKiosk action
- **Files modified:** src/app/(app)/kiosks/actions.ts

**3. [Rule 1 - Bug] Fixed InlineEditField Select not showing stage labels**
- **Found during:** Task 2 — Pipeline Stage was showing raw UUID instead of "Prospect"
- **Issue:** base-ui's SelectValue requires `items` prop on Select.Root to look up labels
- **Fix:** Added `items={options.map(o => ({value: o.value, label: o.label}))}` to Select.Root in inline-edit-field.tsx
- **Files modified:** src/components/ui/inline-edit-field.tsx

**4. [Rule 3 - Blocking] Used drizzle-kit push instead of migrate**
- **Found during:** Task 1 — `drizzle-kit migrate` hung indefinitely
- **Issue:** Session-mode pooler on port 5432 doesn't support long-lived migration transactions
- **Fix:** Used `drizzle-kit push` which completes in seconds on session-mode pooler

**5. [Rule 2 - Critical functionality] Capped DB pool and Playwright workers**
- **Found during:** Task 2 Playwright runs — tests were failing with MaxClientsInSessionMode errors
- **Issue:** Default 10-connection pool + parallel test workers overwhelm Supabase's per-user session limit
- **Fix:** Set DB pool to `max: 2`, Playwright to `workers: 1, fullyParallel: false`
- **Files modified:** src/db/index.ts, playwright.config.ts

**6. [Rule 1 - Bug] Fixed test strict mode violation on getByText('DEPLOYMENT')**
- **Found during:** Playwright test run — getByText('DEPLOYMENT') resolved to 2 elements (section header + "Deployment Tags" label)
- **Fix:** Changed to `getByRole("button", { name: /^DEPLOYMENT$/i })` to target the CollapsibleTrigger specifically
- **Files modified:** tests/kiosks/kiosk-crud.spec.ts

**7. [Rule 1 - Bug] Fixed blur test collapsing the Identity section**
- **Found during:** Playwright test run — clicking "IDENTITY" text to trigger blur was toggling the collapsible closed
- **Fix:** Changed blur mechanism from `.click("IDENTITY")` to `input.press("Tab")` — Tab moves focus away without side effects
- **Files modified:** tests/kiosks/kiosk-crud.spec.ts

## Self-Check: PASSED
