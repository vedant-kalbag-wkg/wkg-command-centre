---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 04.1-05-PLAN.md
last_updated: "2026-04-01T17:24:08.977Z"
last_activity: 2026-04-01
progress:
  total_phases: 5
  completed_phases: 3
  total_plans: 17
  completed_plans: 17
  percent: 28
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-18)

**Core value:** Operations and IT teams can accurately track, plan, and report on every kiosk deployment across all regions from a single tool that models the business's actual data structure.
**Current focus:** Phase 1 — Foundation

## Current Position

Phase: 2 of 5 (Core Entities and Views)
Plan: 2 of 5 in current phase
Status: Ready to execute
Last activity: 2026-04-01

Progress: [####░░░░░░] 28%

## Performance Metrics

**Velocity:**

- Total plans completed: 3
- Average duration: 15.3min
- Total execution time: 0.77 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Foundation | 3/3 | 46min | 15.3min |
| 2. Core Entities and Views | 1/5 | ~180min | ~180min |

**Recent Trend:**

- Last 5 plans: 01-01 (10min), 01-02 (11min), 01-03 (25min), 02-00 (15min), 02-01 (~180min)
- Trend: Plan 02-01 longer due to Supabase session-mode pooler issues, base-ui SelectValue bug fix, and 12 E2E tests

*Updated after each plan completion*
| Phase 02-core-entities-and-views P01 | ~180min | 2 tasks | 17 files |
| Phase 02-core-entities-and-views P02 | ~28min | 2 tasks | 11 files |
| Phase 02-core-entities-and-views P03 | 15min | 2 tasks | 14 files |
| Phase 02-core-entities-and-views P04 | 28 | 2 tasks | 10 files |
| Phase 02-core-entities-and-views P05 | 525595 | 2 tasks | 16 files |
| Phase 02-core-entities-and-views P06 | 15 | 3 tasks | 3 files |
| Phase 02-core-entities-and-views P07 | 10 | 1 tasks | 4 files |
| Phase 02-core-entities-and-views P08 | 8 | 2 tasks | 6 files |
| Phase 03-advanced-views P01 | 5 | 2 tasks | 8 files |
| Phase 03-advanced-views P02 | 5 | 2 tasks | 10 files |
| Phase 03-advanced-views P03 | 6min | 2 tasks | 8 files |
| Phase 03-advanced-views P04 | 5 | 2 tasks | 9 files |
| Phase 03-advanced-views P05 | 9min | 2 tasks | 11 files |
| Phase 04.1 P05 | 3 | 2 tasks | 6 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Pre-Phase 1]: Use Better Auth 1.5.x for auth/RBAC — Auth.js on security-only maintenance, Lucia deprecated
- [Pre-Phase 1]: Use `kiosk_assignments` temporal join table (not a simple `venue_id` FK) — assignment history is the primary Monday.com differentiator
- [Pre-Phase 1]: Use FLOAT8 for pipeline stage ordering positions — avoids batch UPDATE race conditions on reorder
- [Pre-Phase 1]: Use application-layer audit log with denormalized actor/entity names — DB triggers cannot provide business context
- [Pre-Phase 1]: Phase 4 (Migration) depends on Phase 2, not Phase 3 — schema must be stable before importing; Gantt/Calendar can run in parallel
- [Plan 01-01]: Wrapped sidebar nav in semantic `<nav>` element for ARIA accessibility — shadcn Sidebar renders divs
- [Plan 01-01]: Used rgba() directly for Azure tints — avoids Tailwind v4 oklch conversion colour shift
- [Plan 01-01]: Scoped brand CSS variables to :root only (no dark mode) — internal tool with fixed brand palette
- [Plan 01-02]: Used @better-auth/drizzle-adapter (extracted package) — better-auth/adapters/drizzle subpath doesn't exist in v1.5.5
- [Plan 01-02]: Used (authClient as any).forgetPassword() — Better Auth runtime-generates password methods not reflected in client types
- [Plan 01-02]: Used #password CSS selector in Playwright — avoids collision with show/hide button aria-label
- [Plan 01-02]: Added BETTER_AUTH_URL=http://localhost:3000 to .env.local — suppresses base URL warnings
- [Plan 01-03]: Better Auth createUser only accepts "user"|"admin" — create as "user" then setRole for member/viewer
- [Plan 01-03]: Better Auth setRole types restricted but runtime accepts any string — cast to bypass TypeScript
- [Plan 01-03]: Server API uses requestPasswordReset (not forgetPassword) for invite email flow
- [Plan 01-03]: AppShell extended with optional action prop for page-level CTA buttons
- [Phase 02-core-entities-and-views]: Used test.fixme() over test.skip() for Wave 0 stubs — fixme shows in --list without requiring a callback
- [Phase 02-core-entities-and-views]: DB test helpers are compile-only stubs until CRUD pages exist in Plans 02-01/02-02 — avoids navigating non-existent pages
- [Phase 02-core-entities-and-views]: Seed script only creates admin user — member/viewer helpers TODO until db:seed updated before LOC-04/RBAC tests
- [Plan 02-01]: Used drizzle-kit push instead of migrate — session-mode pooler on port 5432 causes migrate to hang indefinitely
- [Plan 02-01]: Changed actor_id and assigned_by from uuid to text — Better Auth v1.5 uses TEXT IDs (not UUID)
- [Plan 02-01]: DB pool capped at max:2, Playwright workers:1 — Supabase session-mode pooler limit (MaxClientsInSessionMode)
- [Plan 02-01]: InlineEditField requires items prop on base-ui Select.Root — required for SelectValue to display label instead of raw UUID
- [Plan 02-01]: Blur via Tab key press in tests — clicking section header toggles collapsible, Tab is a safe non-destructive blur
- [Phase 02-core-entities-and-views]: canAccessSensitiveFields computed server-side — rbac.ts imports next/headers (server-only), cannot be imported in client components; pass canSeeSensitive boolean as prop instead
- [Phase 02-core-entities-and-views]: S3 upload via XHR not fetch — XHR supports upload progress events; fetch API does not expose upload progress
- [Phase 02-core-entities-and-views]: Separate useKioskViewStore/useLocationViewStore instances via factory — Zustand module singletons need per-entity instances to prevent filter bleed
- [Phase 02-core-entities-and-views]: Zustand store setters accept Updater<T> — TanStack Table passes functional updaters; resolveUpdater helper handles both T and (old: T) => T
- [Phase 02-core-entities-and-views]: base-ui Select items prop required for SelectValue label display — applies to all Select usage (same pattern as Plan 02-01 InlineEditField)
- [Phase 02-core-entities-and-views]: getStageKioskCount server action instead of internal API route — Next.js server actions callable from client components directly
- [Phase 02-core-entities-and-views]: PointerSensor activationConstraint distance:8px on Kanban — allows click-to-navigate while requiring deliberate drag intent
- [Phase 02-core-entities-and-views]: Fixed-bottom BulkToolbar uses CSS translate for slide-up animation — no JS visibility state needed
- [Phase 02-core-entities-and-views]: fetchAuditEntries admin gate: entity-specific = any auth user; global (no entityId) = admin-only
- [Phase 02-core-entities-and-views]: Used h-dvh (not h-screen) on layout wrapper — dvh handles mobile viewport with address bar correctly
- [Phase 02-core-entities-and-views]: SavedViewsBar: Save view button is flex sibling of scrollable div (not child inside it) — structural key for pinning
- [Phase 02-core-entities-and-views]: KeyContactsEditor: contactsRef.current = contacts inline each render ensures blur handler reads latest state; isSaving removed from disabled prop
- [Phase 02-core-entities-and-views]: Used buttonVariants directly on Link instead of Button asChild — base-ui/react/button has no asChild prop
- [Phase 02-core-entities-and-views]: KioskCard onSelect prop optional and backwards-compatible — absent prop falls back to router.push navigation
- [Phase 02-core-entities-and-views]: TableMeta declaration merging requires TData extends RowData (not object) — matches tanstack/table-core interface signature
- [Phase 02-core-entities-and-views]: Row-level onClick removed from data rows in kiosk/location tables — navigation via identifier link column avoids click conflict with inline editable cells
- [Phase 02-core-entities-and-views]: meta.updateField injected at table level, accessed via table.options.meta in EditableCell — no prop drilling through column defs
- [Phase 03-advanced-views]: test.fixme requires async callback in current Playwright version — test.fixme('title') without callback fails TypeScript overload resolution
- [Phase 03-advanced-views]: audit.ts entityType extended to include 'installation'; action extended to include 'delete' — installations use hard delete not archive
- [Phase 03-advanced-views]: inArray() from drizzle-orm used for multi-row WHERE IN queries — Drizzle column objects have no .in() method
- [Phase 03-advanced-views]: Detail page server+client split: page.tsx server component fetches data; InstallationDetailActions client component handles delete button and dialog
- [Phase 03-advanced-views]: listUsersForSelect in installations/actions.ts: settings listUsers requires admin role; installations need member-accessible user list from Drizzle directly
- [Phase 03-advanced-views]: zod .default() removed from enum fields in react-hook-form schemas — causes Resolver type mismatch; use useForm defaultValues instead
- [Phase 03-advanced-views]: base-ui PopoverTrigger has no asChild prop — render trigger content directly as children, not via asChild slot pattern
- [Phase 03-advanced-views]: PopoverTrigger no asChild in base-ui — render trigger content directly as children (same constraint as Plan 02-02)
- [Phase 03-advanced-views]: Milestone quick-add as toolbar button (not click-on-timeline) — @svar-ui/react-gantt has no click-on-timeline-position API event
- [Phase 03-advanced-views]: buildGanttTasks uses new Date(val as unknown as string) — RSC boundary converts Date objects to ISO strings; coercion handles both forms
- [Phase 03-advanced-views]: REGION_COLORS defined locally in calendar-utils.ts — gantt-utils.ts may not exist during parallel Plan 03-03 execution; avoids import error
- [Phase 03-advanced-views]: CalendarEventPopover implemented as fixed overlay not base-ui Popover — react-big-calendar onSelectEvent provides no DOM anchor; overlay is simpler and avoids anchor problem
- [Phase 03-advanced-views]: hotelGroup calendar filter uses kiosk.regionGroup — hotelGroup exists on locations table not kiosks; regionGroup is best available kiosk-level grouping field
- [Phase 03-advanced-views]: KioskListItem used for CalendarView instead of KioskWithRelations — listKiosks() returns KioskListItem[]; added freeTrialEndDate to KioskListItem to satisfy CalendarView trial-expiry events without a second DB fetch
- [Phase 03-advanced-views]: viewType defaults to 'table' in views-actions — existing saved views have viewType='table' in DB (schema default); listSavedViews now filters by viewType isolating Gantt/Calendar saved views
- [Phase 04.1]: products/providers/locationProducts tables added to schema.ts as Rule 3 deviation — CONTEXT.md referenced them as existing but they were never added by prior plans in 04.1 branch
- [Phase 04.1]: TooltipTrigger uses render prop not asChild — base-ui Tooltip has no asChild; consistent with Phase 02/03 PopoverTrigger pattern

### Pending Todos

None yet.

### Blockers/Concerns

- [Phase 4]: Monday.com actual board column structure is underdocumented — an extraction/inspection step is required before field mapping logic can be written
- [Phase 3]: @svar-ui/react-gantt brand customisation depth (WeKnow Azure/Graphite token overrides) needs hands-on prototyping before full Gantt implementation
- [Phase 5]: Neon's support for `REFRESH MATERIALIZED VIEW CONCURRENTLY` and `pg_ivm` needs verification before materialized view reporting is implemented

## Session Continuity

Last session: 2026-04-01T17:24:08.975Z
Stopped at: Completed 04.1-05-PLAN.md
Resume file: None
