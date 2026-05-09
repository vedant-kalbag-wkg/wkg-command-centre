# Project Research Summary

**Project:** Kiosk Management Platform (WeKnow Group)
**Domain:** Internal asset/kiosk deployment management — replacing Monday.com
**Researched:** 2026-03-18
**Confidence:** HIGH

## Executive Summary

This is a purpose-built internal operations platform for managing a fleet of 1,000+ hotel kiosks across their full deployment lifecycle — from initial configuration through live operation, moves, and decommission. The platform replaces Monday.com, which cannot model the core business requirement: kiosks move between venues over time, and the organisation needs an auditable record of where every kiosk was, when, and why. The recommended approach is a Next.js 16 full-stack application with a PostgreSQL data model purpose-built around temporal assignment history, a configurable pipeline, and multi-view data exploration (Table, Kanban, Gantt, Calendar).

The stack is well-understood and mature for this class of problem. The three non-negotiable architectural decisions are: (1) a temporal `kiosk_assignments` join table instead of a simple FK, (2) an application-layer audit log with before/after values and business context, and (3) proper role-based access control implemented from day one. All three are the kind of decisions that cost 10x more to retrofit than to do correctly upfront. The data model must be finalised and stable before any view work begins — every view type and reporting query depends on the kiosk, location, and assignment schema.

The primary delivery risk is scope: the Gantt view, full reporting module, and Monday.com migration each carry HIGH complexity that is frequently underestimated. The recommended mitigation is explicit phase gating — build and validate the core data platform (auth, models, table view, Kanban) before committing to the advanced views and reporting. The Monday.com migration should be run against staging before go-live and treated as a dedicated phase with dry-run mode, field-mapping validation, and rollback capability.

---

## Key Findings

### Recommended Stack

The stack centres on Next.js 16 (App Router, Server Actions, Turbopack) with React 19 and TypeScript throughout. Drizzle ORM with Neon serverless PostgreSQL replaces the Prisma + managed RDS combination that would have been standard in 2024 — Drizzle's smaller bundle and edge compatibility are the deciding factors for Vercel-deployed serverless functions. Better Auth (v1.5.x) is the clear recommendation for authentication and RBAC in 2026, with Auth.js now on security-only maintenance and Lucia officially deprecated.

For view types, TanStack Table (headless, virtualized) handles the primary data grid, dnd-kit powers the Kanban, @svar-ui/react-gantt (MIT, React 19 tested) handles the Gantt timeline, and react-big-calendar covers the calendar. All are MIT-licensed and brand-customisable via shadcn/ui + Tailwind v4 with WeKnow brand tokens. Recharts handles reporting dashboards.

**Core technologies:**
- Next.js 16 + React 19: Full-stack framework — Server Actions eliminate separate API layer, App Router provides route grouping for auth shell
- TypeScript 5.x: End-to-end type safety from DB schema through server actions to client components — non-negotiable for multi-team internal tool
- Drizzle ORM 0.45.x + Neon: TypeScript-native schema, no Rust binary, Vercel-edge compatible, serverless Postgres with scale-to-zero pricing
- Better Auth 1.5.x: Built-in RBAC via `createAccessControl`, Organization plugin, replaces deprecated Auth.js and Lucia
- TanStack Table 8.21.x + TanStack Virtual: Headless virtualized grid, full WeKnow brand control, handles 1,000+ rows
- TanStack Query 5.x + Zustand 5.x: Server state caching (Query) and client UI state (Zustand) — clean separation, no Redux
- shadcn/ui CLI v4 + Tailwind v4: Copy-paste components with Circular Pro font and Azure/Graphite brand tokens
- @svar-ui/react-gantt 2.4.x: Only credible MIT Gantt library for React 19 in 2026; Bryntum/DHTMLX are commercial
- dnd-kit 6.x: Industry-standard replacement for deprecated react-beautiful-dnd for Kanban drag-and-drop
- AWS S3 + presigned URLs: Contract/document file storage bypassing Vercel's 4.5MB payload limit
- Recharts 2.x: SVG-based dashboard charts, easiest to theme with CSS variables for WeKnow brand

### Expected Features

See `.planning/research/FEATURES.md` for the full prioritisation matrix.

**Must have (table stakes — v1 launch):**
- Rich kiosk data model (20+ fields: status, hardware, software version, CMS config, kiosk ID, outlet code, install date, deployment phase tags, maintenance fee, trial info, region) — core system of record
- Rich location/hotel data model (name, address, contacts, hotel group, contracts with structured fields + file attachments, banking details) — hotels are first-class entities
- Kiosk-to-venue assignment with full history — the primary differentiator from Monday.com; must capture date in, date out, reason
- Configurable lifecycle pipeline (9 default stages, admin-editable without developer involvement) — tracking backbone
- Filterable/sortable table view with grouping and column visibility — primary daily-use interface
- Kanban board view — status management for Ops team; columns = pipeline stages
- Bulk editing — essential for managing 1,000+ records efficiently
- Saveable custom views (filter + grouping + columns + sort persisted to DB) — daily productivity blocker without this
- Full audit log with old/new values and actor context — accountability on every change
- CSV export — minimum reporting output for non-platform stakeholders
- Dashboard overview (fleet health, pipeline distribution, key metrics) — first screen on login
- Email/password authentication + RBAC (Ops/IT/Read-only) — cannot open to 30 users without this
- Monday.com data migration — 1,000+ existing records; manual re-entry is infeasible

**Should have (differentiators — v1.x after validation):**
- Gantt view for deployment planning — HIGH complexity; add once Table and Kanban are validated
- Calendar view for milestones and deadlines — add when deployment date tracking is actively requested
- Reporting module: time-series metrics, drill-down, custom filter slices — add once data model is stable and teams trust data quality
- Scheduled/automated email reports — requires reporting module
- Contract file attachments (S3-backed PDF/document storage) — add when structured fields prove insufficient
- Field-level access control (banking details gated to IT role) — add if basic RBAC creates access issues

**Defer (v2+):**
- SSO/OAuth — out of scope for a 30-user internal tool in v1
- External-facing hotel portal — different audience, different UX requirements
- AI-assisted deployment planning — requires telemetry data this platform does not collect
- Real-time collaborative editing — WebSocket complexity not justified for 30 users

### Architecture Approach

The recommended architecture is a layered monolith: Next.js App Router for routing and Server Actions for mutations, a service layer that owns all business logic (never fat actions), repository functions for data access, and PostgreSQL as the single source of truth. The four view types (Table, Kanban, Gantt, Calendar) are self-contained lazy-loaded components sharing state through a View Engine layer above them — they share filters and selected records but have no cross-dependencies. This makes each view independently buildable and testable.

**Major components:**
1. View Engine — shared filter/sort/column/save-state; owns TanStack Query calls; views receive data, not fetch it
2. Service Layer (KioskService, LocationService, AssignmentService, ReportingService, AuditService) — all business logic, pipeline validation, assignment transitions
3. RBAC Guard (Next.js middleware + per-action permission checks) — route and server action protection; never UI-only
4. Temporal Assignment Model (`kiosk_assignments` with `assigned_at` / `unassigned_at`) — the central data model decision
5. Audit Service — append-only log called inside the same DB transaction as every mutation
6. Reporting Layer — read-only queries, materialized views for time-series; built last when real data exists
7. Monday.com Migration Script — isolated one-off Node.js script; never part of the production bundle

**Key patterns to follow:**
- Server Actions are thin: validate auth/permissions → call one service method → return result. Zero business logic in actions.
- Temporal join table for assignment history. Never a simple `venue_id` FK on kiosks.
- Saved views stored in `user_views` DB table (JSONB config). Never localStorage-only.
- Audit log at application layer with denormalized actor name, entity name, old value, new value as strings.
- Lazy-load each view type — never a monolithic `if (viewType === 'kanban')` component.

### Critical Pitfalls

See `.planning/research/PITFALLS.md` for the full list with recovery strategies and phase mappings.

1. **Kiosk-to-venue as a simple FK** — Implement `kiosk_assignments` temporal join table from day one. A `venue_id` on the kiosks table loses all assignment history permanently. Use a partial unique index (`WHERE unassigned_at IS NULL`) to enforce one active assignment per kiosk. This decision cannot be retrofitted cheaply after data is entered.

2. **Integer positions for pipeline stage ordering** — Use `FLOAT8` (or LexoRank) for stage position column. Integer ordering requires batch UPDATE for every reorder and causes race conditions under concurrent use. A float approach reduces any reorder to a single row update.

3. **Audit log without business context** — Log at the application layer with `actor_name`, `entity_name`, `old_value`, `new_value` as denormalized strings. Database-trigger audit logs capture raw diffs but cannot answer "who moved Kiosk KSK-0042 to Live on Tuesday and why?" — ops teams will reject them as useless.

4. **RBAC as an `is_admin` boolean** — Define a `roles` table and a central permissions module (`can(user, 'kiosk:write')`) from the start. The three-role structure (Ops/IT/Viewer) is required from day one — retrofitting after the codebase has scattered inline role checks is a full refactor.

5. **Monday.com migration without dry-run mode** — Build the migration as a two-phase ETL with an explicit dry-run that maps and reports without inserting. Monday.com column values are raw JSON keyed by column ID, not column name — field mapping requires fetching column definitions separately. Use API version 2025-04; cursor-based pagination at 500 items/page; retry with backoff on rate limits.

---

## Implications for Roadmap

Based on the combined research, the feature dependency graph and pitfall phase mapping strongly suggest the following phase structure. The build order from ARCHITECTURE.md is the clearest signal: the data model must be complete before any view work begins, and reporting must come last when real data exists.

### Phase 1: Foundation and Data Model
**Rationale:** Everything depends on this. Auth, RBAC, the temporal assignment schema, audit log structure, and pipeline stage model must all be correct before any features are built on top. The three most expensive-to-retrofit decisions (assignment model, audit log structure, RBAC implementation) all live here. This phase has zero UI that users see, but it determines the structural integrity of everything after it.
**Delivers:** Working auth with three roles, complete DB schema (kiosks, locations, kiosk_assignments, pipeline_stages, users, roles, audit_logs, user_views), Drizzle ORM setup, Next.js app shell with route groups, WeKnow brand tokens in Tailwind v4
**Addresses:** Auth + RBAC, schema design, audit log foundation
**Avoids:** Assignment FK pitfall, integer position pitfall, is_admin boolean pitfall, audit log missing context pitfall

### Phase 2: Core Entities and Primary View
**Rationale:** Once the schema is stable, deliver the first usable product slice — kiosk and location CRUD with the table view. This is the minimum viable replacement for Monday.com's daily-use spreadsheet interface. Saveable views must be built alongside the table view (not added later) because users immediately start saving their preferred configurations.
**Delivers:** Full kiosk CRUD (all 20+ fields), full location/hotel CRUD, kiosk-to-venue assignment with history UI, filterable/sortable/groupable table view with column visibility, saveable custom views persisted to DB, audit log wired to all kiosk/location mutations
**Addresses:** Kiosk data model, location data model, assignment history, table view, saveable views, audit log surfaced in UI
**Avoids:** Saved views localStorage pitfall (built into DB from the start), bulk-edit transaction pitfall (address when bulk edit is added this phase)
**Uses:** TanStack Table 8.21.x + TanStack Virtual, View Engine (Zustand), TanStack Query

### Phase 3: Kanban, Bulk Operations, and Export
**Rationale:** Kanban is the second primary daily-use interface for Ops and depends on the configurable pipeline stage system. Bulk editing and CSV export are table stakes for a 1,000-record ops tool and are natural extensions of the Table View built in Phase 2. Admin pipeline stage configuration (add/rename/reorder/archive) also belongs here — it is required for Kanban to be meaningful.
**Delivers:** Admin-configurable pipeline stages (CRUD with soft-delete and float ordering), Kanban board view with drag-to-change-status, bulk field editing with transactional all-or-nothing semantics and per-record results, CSV/Excel export, dashboard overview (fleet health KPIs, pipeline distribution)
**Addresses:** Configurable pipeline, Kanban view, bulk editing, CSV export, dashboard
**Avoids:** Stage delete cascading pitfall (soft-delete enforced), bulk edit without transaction pitfall, pipeline integer position pitfall
**Uses:** dnd-kit 6.x, React Hook Form + Zod for admin forms

### Phase 4: Monday.com Data Migration
**Rationale:** Migration requires a stable target schema (built in Phases 1-3) and should be executed and validated before advanced features are built on top. Running migration after Phase 3 means the core system is functional for manual data entry while migration is prepared and validated against staging. This is a dedicated phase because the migration complexity is equivalent to a major feature.
**Delivers:** Working migration script with dry-run mode, field mapping for all Monday.com column types, cursor-based pagination for 1,000+ items, rate limit retry/backoff, rollback capability, production import of all existing data
**Addresses:** Monday.com data migration
**Avoids:** Migration assumes clean data pitfall, missing dry-run pitfall, API version deprecation pitfall (pin to 2025-04)
**Uses:** @mondaydotcomorg/api SDK, Monday.com GraphQL API v2025-04

### Phase 5: Advanced Views (Gantt and Calendar)
**Rationale:** Gantt and Calendar are differentiators, not table stakes. The Gantt view in particular is HIGH complexity — approximately 6-10x more effort than it appears. Deferring to Phase 5 means: (a) the team has proven the data model is correct with real usage, (b) the View Engine is mature and battle-tested, (c) Gantt can be scoped correctly based on what users actually need rather than assumptions. These views must be scoped as a separate sub-phase with a library decision locked before development starts.
**Delivers:** Gantt timeline view using @svar-ui/react-gantt (drag-to-update dates, grouped by region/phase tag, graceful degradation for large fleets), Calendar view using react-big-calendar (deployment dates, trial expiry, maintenance windows), contract file attachments (S3 presigned URL upload for PDFs/docs linked to location records)
**Addresses:** Gantt view, Calendar view, contract file attachments
**Avoids:** Building Gantt from scratch pitfall, Gantt not degrading for large fleets pitfall
**Uses:** @svar-ui/react-gantt 2.4.x, react-big-calendar 1.19.x, AWS SDK v3 presigned URLs, react-dropzone

### Phase 6: Reporting Module
**Rationale:** Reporting must come last — it requires real data to exist (from migration + usage), a stable time-series from the assignment history, and trust in data quality. Building reporting before the data model is validated with real usage produces reports users do not trust. This phase also includes field-level access control for sensitive data (banking details) and scheduled report delivery.
**Delivers:** Time-series charts (kiosks live per month, new activations), drill-down from summary → region → hotel → kiosk, custom filter slices, scheduled/automated email reports (Resend or AWS SES), field-level access control for banking details (IT role only), PostgreSQL materialized views for reporting performance
**Addresses:** Reporting module, scheduled reports, field-level access control
**Avoids:** Reporting aggregation without materialized views performance trap, banking detail exposure security mistake
**Uses:** Recharts 2.x, PostgreSQL materialized views, cron-triggered Server Actions

### Phase Ordering Rationale

- **Foundation before everything**: The temporal assignment model, audit log schema, and RBAC implementation are the three decisions with the highest retrofit cost. Any of these wrong in Phase 1 requires touching every subsequent phase.
- **Table view before Kanban**: The View Engine (filter/sort/save infrastructure) is shared by all four view types. Building it solidly for the table view means Kanban, Gantt, and Calendar can layer on top cleanly.
- **Migration after stable schema**: Monday.com import cannot produce correct data until the target schema is finalised. Phase 3 completion marks the schema stability checkpoint for migration.
- **Gantt after validated core**: Gantt is scoped separately to prevent it from blocking the more immediately valuable Kanban and Table features. The @svar-ui/react-gantt library decision must be locked before Phase 5 development starts.
- **Reporting last**: Time-series reporting requires historical data to be meaningful. Materialized views for reporting performance should only be added when p95 query time exceeds 500ms — not prematurely.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4 (Monday.com Migration):** Monday.com's column value JSON format is underdocumented. The field mapping logic for each column type (status, person, dropdown, date, link, file) will require exploration of actual board data before the migration script can be written. Reserve time for an extraction/inspection step before any import logic.
- **Phase 5 (Gantt):** @svar-ui/react-gantt customisation surface (brand token overrides, column config API) should be prototyped before committing to a phase estimate. The library is well-documented but brand customisation depth needs hands-on validation.
- **Phase 6 (Reporting):** Materialized view refresh strategy on Neon (managed PostgreSQL) needs verification — `REFRESH MATERIALIZED VIEW CONCURRENTLY` requires a unique index, and Neon's support for `pg_ivm` (incremental refresh) is not confirmed.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Better Auth + Drizzle on Next.js 16 is a well-documented, high-confidence stack. No surprises expected.
- **Phase 2 (Core Entities + Table View):** TanStack Table is extensively documented; the temporal join table pattern is standard PostgreSQL practice.
- **Phase 3 (Kanban + Bulk Ops):** dnd-kit Kanban with shadcn/ui is a canonical pattern with multiple reference implementations. Bulk transaction patterns are standard.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All core libraries verified against official docs and npm. Version compatibility matrix validated (Next.js 16/React 19/Tailwind v4/shadcn v4 alignment confirmed). The one uncertainty is @svar-ui/react-gantt brand customisation depth — prototype early. |
| Features | HIGH | Validated against project requirements, Monday.com limitations research, and kiosk lifecycle management literature. Feature dependency graph is solid. Anti-features are well-reasoned. |
| Architecture | HIGH | Layered service architecture, temporal join table, and append-only audit log are established patterns with strong source backing. Build order is derived from the dependency graph, not opinion. |
| Pitfalls | HIGH | All 9 pitfalls are domain-specific and sourced. The top 5 (assignment FK, integer positions, audit log context, RBAC boolean, migration dry-run) are universally agreed across sources. |

**Overall confidence:** HIGH

### Gaps to Address

- **@svar-ui/react-gantt brand customisation**: Exact API for overriding colors, fonts, and timeline bar styles with WeKnow Azure/Graphite tokens needs hands-on prototyping in Phase 5 planning. The library is MIT and React 19 tested, but custom styling depth is unconfirmed.
- **Neon materialized view refresh support**: Confirm whether `REFRESH MATERIALIZED VIEW CONCURRENTLY` works without issue on Neon managed PostgreSQL and whether `pg_ivm` is available. Relevant only in Phase 6 — low urgency.
- **Monday.com actual board structure**: The field mapping for the migration script depends on the actual column types and IDs in the existing Monday.com boards. An extraction/inspection run is required before Phase 4 mapping logic can be written.
- **File attachment MIME validation**: The exact server-side MIME validation approach for contract documents (PDF, DOCX) needs a decision — either file-type npm package or magic bytes inspection. Low complexity, but must be explicit to avoid the file upload security mistake.

---

## Sources

### Primary (HIGH confidence)
- [Next.js 16 official release post](https://nextjs.org/blog/next-16) — Turbopack stable, React 19.2, React Compiler stable
- [shadcn/ui changelog](https://ui.shadcn.com/docs/changelog) — CLI v4, Tailwind v4 + React 19 support confirmed
- [Better Auth 1.4 blog](https://better-auth.com/blog/1-4) + [Organization plugin docs](https://better-auth.com/docs/plugins/organization) — RBAC, v1.5.5 on npm confirmed
- [drizzle-orm npm](https://www.npmjs.com/package/drizzle-orm) — v0.45.1 stable
- [TanStack Table docs](https://tanstack.com/table/latest) — v8.21.3 stable, v9 alpha
- [SVAR React Gantt v2.4 release post](https://svar.dev/blog/react-gantt-pro-2-4-released/) — MIT license, React 19 support
- [react-big-calendar npm](https://www.npmjs.com/package/react-big-calendar) — v1.19.4 stable
- [Neon pricing post-Databricks acquisition](https://neon.com/blog/new-usage-based-pricing) — serverless model, price cuts confirmed
- [Monday.com API 2025-04 migration guide](https://developer.monday.com/api-reference/docs/migrating-to-version-2025-04) — GraphQL v2025-04, @mondaydotcomorg/api SDK confirmed
- [Tailwind v4 + shadcn/ui official docs](https://ui.shadcn.com/docs/tailwind-v4) — CSS-first config, `@theme` directive
- [Monday.com API Rate Limits — Official Developer Docs](https://developer.monday.com/api-reference/docs/rate-limits) — 500 items/page, 10M complexity/min
- [PostgreSQL Temporal Constraints](https://betterstack.com/community/guides/databases/postgres-temporal-constraints/) — WITHOUT OVERLAPS (PG18), partial unique index pattern

### Secondary (MEDIUM confidence)
- [Better Auth vs Auth.js — Wisp CMS](https://www.wisp.blog/blog/authjs-vs-betterauth-for-nextjs-a-comprehensive-comparison) — Auth.js team joined Better Auth
- [Drizzle vs Prisma — Makerkit](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma) — v0.45.x stable confirmed
- [TanStack Table vs AG Grid — Simple Table](https://www.simple-table.com/tanstack-table-vs-ag-grid-comparison) — bundle and licensing comparison
- [dnd-kit kanban — LogRocket](https://blog.logrocket.com/build-kanban-board-dnd-kit-react/) — community standard for React kanban
- [Best React chart libraries 2025 — LogRocket](https://blog.logrocket.com/best-react-chart-libraries-2025/) — Recharts for admin panel
- [Neon vs Supabase — Bytebase](https://www.bytebase.com/blog/neon-vs-supabase/) — pricing and architecture comparison
- [Monday.com Limitations 2025 — Witify](https://witify.io/en/blog/monday.com-limitations-for-businesses-in-2025) — board-level RBAC limitations
- [Kiosk Lifecycle Management Guide — Hexnode](https://www.hexnode.com/blogs/the-definitive-guide-to-kiosk-management-and-strategy-2026-edition/) — domain context
- [Fractional indexing for Kanban ordering](https://nickmccleery.com/posts/08-kanban-indexing/) — float position approach
- [6 Common RBAC Pitfalls — Idenhaus](https://idenhaus.com/rbac-implementation-pitfalls/) — RBAC anti-patterns
- [Enterprise Ready: Audit Logging Guide](https://www.enterpriseready.io/features/audit-log/) — audit log best practices
- [State management in 2025 — Makers Den](https://makersden.io/blog/react-state-management-in-2025) — Zustand + TanStack Query pattern

---
*Research completed: 2026-03-18*
*Ready for roadmap: yes*
