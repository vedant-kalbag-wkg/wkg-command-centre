---
phase: 03-advanced-views
plan: 02
subsystem: ui
tags: [tanstack-table, react-hook-form, zod, server-actions, next-js, base-ui]

# Dependency graph
requires:
  - phase: 03-advanced-views
    plan: 01
    provides: installations table, milestones table, installation_members table, all 11 server actions

provides:
  - /installations list page with InstallationTable (TanStack Table v8)
  - /installations/new create form page
  - /installations/[id] detail page with editable form, milestone management, team management, delete
  - Installations nav item in sidebar (CalendarClock icon)
  - InstallationForm (create + edit modes)
  - MilestoneList (inline add form, type badges, delete confirmation)
  - ResourceMemberList (popover add with user+role select, X remove)
  - InstallationDetailActions (delete button + confirmation dialog)
  - listUsersForSelect action (member-accessible user list)

affects:
  - 03-03 (Gantt view can link to /installations/[id] for detail panel)
  - 03-04 (Calendar view can link to /installations/[id])
  - 03-05 (Integration tests can navigate full CRUD flow)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "base-ui Select requires items prop for SelectValue to display label — same pattern as Plan 02-01 InlineEditField"
    - "Server page + client action component pattern for detail pages with delete — page.tsx is server, *-detail-actions.tsx is client"
    - "listUsersForSelect added to installations/actions.ts (not settings/users/actions.ts) to allow member-role access without admin gate"
    - "zodResolver with zod v4: avoid .default() on enum fields — causes type mismatch with react-hook-form Resolver generic"

key-files:
  created:
    - src/app/(app)/installations/page.tsx
    - src/app/(app)/installations/new/page.tsx
    - src/app/(app)/installations/[id]/page.tsx
    - src/components/installations/installation-table.tsx
    - src/components/installations/installation-form.tsx
    - src/components/installations/milestone-list.tsx
    - src/components/installations/resource-member-list.tsx
    - src/components/installations/installation-detail-actions.tsx
  modified:
    - src/components/layout/app-sidebar.tsx
    - src/app/(app)/installations/actions.ts

key-decisions:
  - "Detail page is server component; delete button lives in InstallationDetailActions (client component) — clean separation of server data fetch and client interaction"
  - "listUsersForSelect added to installations/actions.ts with requireRole(admin, member) — settings listUsers requires admin only and uses auth.api which cannot be used client-side from member context"
  - "zod .default() removed from status enum in formSchema — causes Resolver type mismatch with react-hook-form when zod infers optional default; defaultValues in useForm handles the default instead"
  - "base-ui PopoverTrigger has no asChild prop — render trigger content directly as PopoverTrigger children"

patterns-established:
  - "Page-level delete actions extracted to *-detail-actions.tsx client components to keep server page clean"
  - "MilestoneList inline add form (no separate page) using useState + react-hook-form"

requirements-completed:
  - GANTT-01
  - GANTT-03
  - GANTT-04

# Metrics
duration: 5min
completed: 2026-03-19
---

# Phase 3 Plan 02: Installation CRUD Pages Summary

**Full Installation CRUD at /installations — list page, create form, detail/edit page with inline milestone management and team member management, plus Installations sidebar nav item**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-19T11:52:50Z
- **Completed:** 2026-03-19T11:59:23Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Added Installations nav item (CalendarClock icon) to sidebar between Locations and Settings
- Created /installations list page with InstallationTable using TanStack Table v8
- Created /installations/new create form with react-hook-form + zod validation
- Created /installations/[id] detail page (server component) with two-column layout
- InstallationForm supports both create and edit modes via optional installationId prop
- MilestoneList: inline add form, 4 type options, delete with confirmation dialog
- ResourceMemberList: popover add with user select + role select, X remove button
- InstallationDetailActions: delete button + confirmation dialog matching UI-SPEC copy
- Added listUsersForSelect action (member-accessible) to installations/actions.ts
- TypeScript compiles clean; zero errors

## Task Commits

1. **Task 1: Sidebar nav + installation list page + create form** - `41f1bc2` (feat)
2. **Task 2: Installation detail page with milestones and resource members** - `06aacf9` (feat)

## Files Created/Modified

- `src/components/layout/app-sidebar.tsx` - Added CalendarClock import + Installations nav item
- `src/app/(app)/installations/page.tsx` - Server component list page with InstallationTable
- `src/app/(app)/installations/new/page.tsx` - Server component wrapping InstallationForm
- `src/app/(app)/installations/[id]/page.tsx` - Server component detail page with two-column layout
- `src/components/installations/installation-table.tsx` - TanStack Table with status badges, date formatting, member/milestone counts
- `src/components/installations/installation-form.tsx` - Create + edit form with react-hook-form + zod
- `src/components/installations/milestone-list.tsx` - Inline add/remove milestone management
- `src/components/installations/resource-member-list.tsx` - Popover-based member add with role select
- `src/components/installations/installation-detail-actions.tsx` - Client component for delete CTA + dialog
- `src/app/(app)/installations/actions.ts` - Added listUsersForSelect (member-accessible)

## Decisions Made

- **Server + client split for detail page**: page.tsx is a server component that fetches data; InstallationDetailActions is a client component for the delete button + dialog interaction. Keeps data fetching server-side while enabling interactive UI.
- **listUsersForSelect in installations/actions.ts**: The existing settings `listUsers` requires admin role and uses `auth.api.listUsers`. For member-accessible user listing in the resource member popover, a separate action queries the user table directly from Drizzle with `requireRole("admin", "member")`.
- **zod .default() removed**: Using `.default("planned")` on a z.enum field causes TypeScript overload errors with react-hook-form's Resolver. Removed `.default()` and handled the default in `useForm({ defaultValues })` instead.
- **PopoverTrigger no asChild**: base-ui PopoverTrigger (unlike Radix) has no `asChild` prop. Render trigger content directly as its children.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed zod .default() incompatibility with react-hook-form Resolver**
- **Found during:** Task 1 (TypeScript check on installation-form.tsx)
- **Issue:** `z.enum([...]).default("planned")` changes inferred type from `"planned"|"active"|"complete"` to `"planned"|"active"|"complete"|undefined` which conflicts with react-hook-form's `Resolver<TFieldValues>` generic
- **Fix:** Removed `.default()` from schema; set default in `useForm({ defaultValues: { status: "planned" } })`
- **Files modified:** src/components/installations/installation-form.tsx
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 41f1bc2 (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added listUsersForSelect server action**
- **Found during:** Task 2 (implementing ResourceMemberList)
- **Issue:** Plan referenced "reuse existing admin listUsers action or create a lightweight version" — admin listUsers requires admin role, but ResourceMemberList needs to work for member role
- **Fix:** Added `listUsersForSelect` to installations/actions.ts querying user table directly with `requireRole("admin", "member")`
- **Files modified:** src/app/(app)/installations/actions.ts
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 06aacf9 (Task 2 commit)

**3. [Rule 1 - Bug] Extracted delete into separate client component**
- **Found during:** Task 2 (implementing detail page)
- **Issue:** Plan spec "server component" for the page but delete button needs `useRouter`, `useTransition`, dialog state — all client-only hooks
- **Fix:** Created `InstallationDetailActions` client component for delete button + dialog; page.tsx remains a server component
- **Files modified:** src/app/(app)/installations/[id]/page.tsx, created src/components/installations/installation-detail-actions.tsx
- **Verification:** `npx tsc --noEmit` passes
- **Committed in:** 06aacf9 (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 missing critical, 2 bugs)
**Impact on plan:** All auto-fixes necessary for correctness. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- /installations CRUD fully functional — Plans 03-03 and 03-04 can render Gantt/Calendar from this data
- Installation data in Neon DB is accessible via all 11 server actions + new listUsersForSelect
- No blockers for 03-03 (Gantt) or 03-04 (Calendar)

---
*Phase: 03-advanced-views*
*Completed: 2026-03-19*
