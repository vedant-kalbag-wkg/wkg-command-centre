# Roadmap: Kiosk Management Platform

## Overview

The platform is built in five phases that follow a strict dependency order: the data model must be correct before any views are built, the core daily-use interface must be validated before advanced views are added, and reporting is left last because it requires real data to be meaningful. Every phase delivers a coherent, testable capability — not a horizontal technical layer. Phase 4 (Data Migration) gates the cut-over from Monday.com: once migration runs cleanly, the organisation has a single source of truth.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Foundation** - Auth, RBAC, complete database schema, and app shell — everything downstream phases build on
- [x] **Phase 2: Core Entities and Views** - Kiosk/Location CRUD, Table view, Kanban, saveable views, bulk ops, CSV export, and audit log UI — UAT gap closure in progress (completed 2026-03-19)
- [ ] **Phase 3: Advanced Views** - Gantt timeline view and Calendar view for deployment planning
- [x] **Phase 4: Data Migration** - Monday.com import with dry-run mode, field mapping, product/provider/commission import, and per-hotel product configuration (completed 2026-04-01)
- [ ] **Phase 4.1: Data Migration — Quality & Correctness** (INSERTED) - Fix import field mappings, kiosk/location table displays, location schema extensions, dedicated Products tab, and Kiosk Groups entity
- [ ] **Phase 5: Reporting and Dashboard** - Dashboard overview, time-series charts, drill-down reports, and filtered report slices

## Phase Details

### Phase 1: Foundation
**Goal**: The platform has a working authentication layer, three-role access control system, and a fully-normalised database schema ready for all downstream features — including temporal assignment tracking, configurable pipeline stages, and append-only audit logging.
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**Success Criteria** (what must be TRUE):
  1. User can create an account, log in with email and password, and remain logged in across browser refresh
  2. User can reset a forgotten password via email link
  3. Admin can create and manage user accounts from an admin interface
  4. A user with the Read-only role cannot access write operations that an Ops or IT user can
  5. Sensitive fields (banking details, contracts) are inaccessible to roles without authorisation
**Plans**: 3 plans

Plans:
- [ ] 01-01: Project scaffold — Next.js 16, Drizzle ORM, Neon PostgreSQL, Tailwind v4 with WeKnow brand tokens, shadcn/ui
- [ ] 01-02: Better Auth setup — email/password auth, session persistence, password reset flow
- [ ] 01-03: RBAC and full database schema — roles, kiosks, locations, kiosk_assignments (temporal), pipeline_stages, audit_logs, user_views tables

### Phase 2: Core Entities and Views
**Goal**: Operations and IT teams can manage all kiosk and location records, view them in a filterable table and Kanban board, save custom view configurations, bulk-edit records, export data to CSV, and see a full audit trail of every change.
**Depends on**: Phase 1
**Requirements**: KIOSK-01, KIOSK-02, KIOSK-03, KIOSK-04, KIOSK-05, KIOSK-06, LOC-01, LOC-02, LOC-03, LOC-04, LOC-05, VIEW-01, VIEW-02, VIEW-03, VIEW-04, VIEW-05, KANBAN-01, KANBAN-02, KANBAN-03, BULK-01, BULK-02, AUDIT-01, AUDIT-02, AUDIT-03
**Success Criteria** (what must be TRUE):
  1. User can create, view, edit, and delete a kiosk record with all 20+ fields and assign it to a venue; full assignment history is visible on the kiosk detail page
  2. User can create, view, edit, and delete a location record including contracts (structured fields + file attachments) and banking details (for authorised roles)
  3. User can view kiosks in a sortable, filterable table grouped by any field, show/hide columns, save a named view, and reload it later
  4. User can view kiosks as a Kanban board and drag a card between status columns to update its pipeline stage
  5. User can select multiple records, bulk-edit shared fields, and export filtered data to CSV
  6. Every change to a kiosk or location record is logged with who made it, what changed, and the old and new values; Admin can view the global audit log
**Plans**: 9 plans

Plans:
- [x] 02-00-PLAN.md — Wave 0: Playwright test stubs and shared helpers for all Phase 2 requirements
- [x] 02-01-PLAN.md — Kiosk CRUD with inline editing, venue assignment with history, schema migration (archivedAt), audit helper, pipeline stage seed
- [x] 02-02-PLAN.md — Location CRUD with inline editing, contract document upload (S3), banking details with role restriction, key contacts editor
- [x] 02-03-PLAN.md — Table view with TanStack Table v8, Zustand View Engine, filter/sort/group/column-visibility, saved views persisted to DB
- [x] 02-04-PLAN.md — Kanban board with dnd-kit drag-to-update, switchable grouping, pipeline stage management modal with color picker
- [x] 02-05-PLAN.md — Bulk operations (multi-select edit/archive), CSV export, per-record audit timeline, global admin audit log
- [ ] 02-06-PLAN.md — UAT gap closure: viewport overflow fix, save view button pinning, key contacts blur-save
- [ ] 02-07-PLAN.md — UAT gap closure: Kanban card click-to-overlay sheet
- [ ] 02-08-PLAN.md — UAT gap closure: inline table editing and header-based column filters/sort

### Phase 3: Advanced Views
**Goal**: Deployment planners can visualise kiosk rollout timelines on a Gantt chart and track deployments, milestones, and deadlines on a calendar.
**Depends on**: Phase 2
**Requirements**: GANTT-01, GANTT-02, GANTT-03, GANTT-04, CAL-01, CAL-02
**Success Criteria** (what must be TRUE):
  1. User can view kiosk deployment timelines as Gantt bars grouped by region or deployment phase, with drag-to-update date support
  2. User can set milestones (contract signing, go-live targets) and see them marked on the Gantt timeline
  3. User can view resource (team member) allocations on the Gantt view
  4. User can view all deployments, milestones, and deadlines on a calendar and filter by region, status, or hotel group
**Plans**: 5 plans

Plans:
- [ ] 03-01-PLAN.md — Schema extension (installations, milestones, members, kiosk links), server actions, Playwright test stubs
- [ ] 03-02-PLAN.md — Installation CRUD pages (list, create, detail/edit), sidebar nav, milestone and team member management
- [ ] 03-03-PLAN.md — Gantt view with @svar-ui/react-gantt, brand theming, grouped timeline bars, milestones, resource columns, pending-drag interactions
- [ ] 03-04-PLAN.md — Calendar view with react-big-calendar, 3 event types, filter controls, event popovers
- [ ] 03-05-PLAN.md — View integration: URL ?view= params, Gantt/Calendar tabs on Kiosks page, saved views extension

### Phase 4: Data Migration
**Goal**: All existing Monday.com kiosk and location records — including subitem product/provider/commission data — are imported into the platform with correct field mapping, zero data loss, a dry-run preview before committing, and a per-hotel product configuration UI.
**Depends on**: Phase 2
**Requirements**: MIGR-01, MIGR-02, MIGR-03
**Success Criteria** (what must be TRUE):
  1. Admin can run a dry-run import that shows a preview of mapped records without inserting data, including any field mapping warnings
  2. Admin can trigger a full import that transfers all 1,000+ records with correct field mapping from Monday.com board columns to kiosk/location fields
  3. The import handles pagination across large boards and recovers from rate limit errors without failing mid-import
  4. Products, providers, and commission tiers are imported from Monday.com subitems and configurable per hotel
**Plans**: 4 plans

Plans:
- [x] 04-00-PLAN.md — Wave 0: Schema extension (products, providers, location_products tables), Vitest config, unit test stubs, Playwright E2E stubs
- [x] 04-01-PLAN.md — Monday.com GraphQL client with pagination and retry, field mapper engine, subitem parser, server actions (explore, dry-run, import, progress)
- [x] 04-02-PLAN.md — Data Import UI: Settings card, data-import page with 6-state flow (connect, mapping, preview, import, complete), progress polling
- [x] 04-03-PLAN.md — Location product configuration: Products tab on location detail page, availability/provider/commission editing, add-product propagation

### Phase 4.1: Data Migration — Quality & Correctness (INSERTED)
**Goal**: Fix all data import quality issues discovered during initial Monday.com migration: correct field mappings, proper kioskId derivation, clean kiosk/location table displays, location schema extensions, product management as dedicated tab, and Kiosk Groups as a new entity imported from a separate Monday.com board.
**Depends on**: Phase 4
**Requirements**: MIGR-04, MIGR-05, MIGR-06, MIGR-07, MIGR-08, MIGR-09, MIGR-10, MIGR-11, MIGR-12, MIGR-13, MIGR-14, MIGR-15
**Success Criteria** (what must be TRUE):
  1. KioskId is derived from Region column + outlet code (not Monday.com group name), and "Assets" column maps to kiosk hardware serial number
  2. Kiosk notes are clean (no dumped location fields), CMS Config imports correctly, key contacts distinguish hotel contact from internal POC
  3. Hotels with same name but different [outlet_code] suffixes merge into one location with separate kiosks
  4. Kiosk table shows: Asset, outlet code, venue, region, stage, CMS config, install date — Location table shows all hotel metadata fields
  5. Location schema includes region, location group, internal POC, and status fields
  6. Products have a dedicated tab in the sidebar (not embedded in location detail)
  7. Kiosk Groups are imported from Monday.com board 1466686598 and viewable in a dedicated tab
  8. Import order supported: hardware/kiosks from board 1426737864 first, then hotel data
**Plans**: 6 plans

Plans:
- [ ] 04.1-01-PLAN.md — Schema extension + field mapper bug fixes: extend locations (4 new fields), add kioskConfigGroups/appSettings tables, fix 5 field mapper bugs, normaliseLocationName, unit tests
- [ ] 04.1-02-PLAN.md — Import flow extension: three board ID inputs with persistence, three-step sequential import, individual import buttons
- [ ] 04.1-03-PLAN.md — Kiosk table display fixes: add hardwareSerialNumber to KioskListItem/query, update default columns to Asset/outlet code/venue/region/stage/CMS config/install date
- [ ] 04.1-04-PLAN.md — Location table display fixes: extend LocationListItem/query with all 14 fields, update default columns to show full hotel metadata
- [ ] 04.1-05-PLAN.md — Dedicated Products tab: sidebar nav entry, server actions (list/create/delete), TanStack Table with hotel counts, add/delete dialogs
- [ ] 04.1-06-PLAN.md — Kiosk Config Groups: sidebar nav entry, server action with hotel/kiosk counts, TanStack Table with clickable count links

### Phase 5: Reporting and Dashboard
**Goal**: All users can see a real-time fleet health dashboard on login, and authorised users can explore time-series trends, drill down from region to individual kiosk, and filter report data by any dimension.
**Depends on**: Phase 4
**Requirements**: REPORT-01, REPORT-02, REPORT-03, REPORT-04
**Success Criteria** (what must be TRUE):
  1. User sees a dashboard on login showing total kiosks by status, pipeline breakdown, and key operational metrics
  2. User can view a time-series chart of kiosks live per month and new activations per month going back through history
  3. User can click from a summary metric through to a specific hotel and down to an individual kiosk record
  4. User can filter any report view by region, deployment phase, hotel group, and date range
**Plans**: TBD

Plans:
- [ ] 05-01: Dashboard overview — Recharts-powered fleet health KPIs, pipeline distribution chart, key metric cards
- [ ] 05-02: Reporting module — time-series charts, drill-down navigation, filter controls, PostgreSQL materialized views for performance

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 3/3 | Complete | 2026-03-18 |
| 2. Core Entities and Views | 9/9 | Complete | 2026-03-19 |
| 3. Advanced Views | 4/5 | In Progress | |
| 4. Data Migration | 4/4 | Complete | 2026-04-01 |
| 4.1 Data Migration — Quality & Correctness | 0/6 | Not started | - |
| 5. Reporting and Dashboard | 0/2 | Not started | - |
