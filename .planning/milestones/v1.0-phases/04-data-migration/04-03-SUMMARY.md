---
phase: 04-data-migration
plan: 03
subsystem: ui
tags: [nextjs, drizzle, react, postgresql, server-actions, shadcn]

# Dependency graph
requires:
  - phase: 04-00
    provides: products, providers, locationProducts schema tables
  - phase: 02-core-entities-and-views
    provides: location detail page with tab structure (location-detail-form.tsx)

provides:
  - Products tab on location detail page
  - Server actions for per-location product configuration CRUD
  - addProduct action propagates new products to all locations as "unavailable" (D-15)
  - Inline commission tier editor (min/max revenue, rate per tier)

affects:
  - 04-01 (data import — products/providers are now queryable via actions)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Self-fetching client tab component using useEffect + server actions (same pattern as AuditTimeline)"
    - "Inline tab content — Products tab added directly to location-detail-form.tsx alongside Kiosks/Audit tabs"
    - "Optimistic UI update on product configuration changes with toast feedback"

key-files:
  created:
    - src/app/(app)/locations/[id]/products/actions.ts
    - src/app/(app)/locations/[id]/products/location-products-client.tsx
  modified:
    - src/db/schema.ts
    - src/components/locations/location-detail-form.tsx

key-decisions:
  - "Products tab implemented as inline client-side tab (not a route/page) — existing tab architecture uses shadcn Tabs inside location-detail-form.tsx client component, not layout.tsx"
  - "LocationProductsClient self-fetches on mount via useEffect + server actions — tab is inside a client component so cannot receive server-fetched props directly"
  - "Schema tables added to worktree without running drizzle-kit push — parallel worktree shares DB with agent running 04-00; push happens once 04-00 merges"
  - "addProduct uses onConflictDoNothing for both product insert and locationProducts batch insert — safe re-runs when product already exists"

patterns-established:
  - "Tab content components self-fetch via useEffect when embedded inside client component tabs (not inside server page)"
  - "Commission tiers stored as JSONB array with minRevenue/maxRevenue(nullable)/rate fields"

requirements-completed: [MIGR-01]

# Metrics
duration: 25min
completed: 2026-04-01
---

# Phase 04 Plan 03: Location Products Tab Summary

**Per-hotel product configuration UI with availability dropdowns, provider assignment, inline commission tier editing, and global product propagation (D-15/D-16)**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-01T13:10:00Z
- **Completed:** 2026-04-01T13:35:00Z
- **Tasks:** 1 of 2 (Task 2 is human-verify checkpoint)
- **Files modified:** 4

## Accomplishments

- Added Phase 4 schema tables (products, providers, locationProducts) to schema.ts
- Created 5 server actions: listLocationProducts, listAllProducts, listAllProviders, updateLocationProduct, addProduct
- addProduct inserts into products table and creates locationProducts rows for ALL locations with availability="unavailable" (D-15)
- Built LocationProductsClient with availability dropdown (yes/no/unavailable with coloured dots), provider dropdown, and inline commission tier editor
- Added "Products" tab to location-detail-form.tsx alongside existing Kiosks/Audit tabs
- Build passes with zero TypeScript errors

## Task Commits

1. **Task 1: Server actions + Products tab UI** - `156c266` (feat)

## Files Created/Modified

- `src/db/schema.ts` — Added products, providers, locationProducts Drizzle table definitions
- `src/app/(app)/locations/[id]/products/actions.ts` — 5 server actions for product config CRUD
- `src/app/(app)/locations/[id]/products/location-products-client.tsx` — Client component with product table, availability/provider dropdowns, tier editor, add product form
- `src/components/locations/location-detail-form.tsx` — Added Products tab trigger and content

## Decisions Made

- **Products tab as inline tab, not route** — plan referenced `products/page.tsx` and `layout.tsx` but existing tab architecture uses shadcn Tabs inline inside `location-detail-form.tsx` (a client component). The route-based approach would create an orphaned page nobody navigates to. Followed existing Kiosks/Audit tab pattern instead.
- **Self-fetching client component** — Since `LocationProductsClient` lives inside a "use client" component, it can't receive server-fetched props. Uses `useEffect` + server actions on mount, matching how `AuditTimeline` works.
- **No drizzle-kit push in worktree** — Running push from a parallel worktree risks collision with agent executing plan 04-00 which also modifies the schema. Schema definitions are correct; push will succeed when 04-00 merges.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Tab architecture mismatch — route vs inline tab**
- **Found during:** Task 1 (initial analysis)
- **Issue:** Plan specified `products/page.tsx` + update `layout.tsx`, but no `layout.tsx` exists and tabs are inline in `location-detail-form.tsx` (client component)
- **Fix:** Created `location-products-client.tsx` as self-fetching client component; added tab to existing inline tab structure in `location-detail-form.tsx`; skipped `products/page.tsx` (would be orphaned route)
- **Files modified:** location-detail-form.tsx (tab added), location-products-client.tsx (created)
- **Verification:** Build passes; Products tab visible in tab list
- **Committed in:** 156c266

---

**Total deviations:** 1 auto-fixed (architectural mismatch — followed existing codebase pattern)
**Impact on plan:** No scope change. Same functionality delivered through the correct pattern.

## Issues Encountered

None beyond the tab architecture mismatch documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Products tab ready for verification with real data (requires data import from plan 04-01/04-02)
- Schema tables (products, providers, locationProducts) ready — push to DB required after 04-00 merges
- Human verification checkpoint (Task 2) required before plan is complete

---
*Phase: 04-data-migration*
*Completed: 2026-04-01*

## Self-Check: PASSED

- `src/app/(app)/locations/[id]/products/actions.ts` — FOUND
- `src/app/(app)/locations/[id]/products/location-products-client.tsx` — FOUND
- `src/components/locations/location-detail-form.tsx` (Products tab) — FOUND
- `src/db/schema.ts` (locationProducts table) — FOUND
- Commit `156c266` — FOUND
