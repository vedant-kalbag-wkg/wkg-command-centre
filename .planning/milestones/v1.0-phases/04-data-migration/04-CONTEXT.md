# Phase 4: Data Migration - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Monday.com data import into the platform: board exploration, auto-detected field mapping with admin review, dry-run preview, full import with progress tracking, and error recovery. Includes subitem migration for product availability and commission tiers per hotel. Delivers MIGR-01, MIGR-02, MIGR-03.

</domain>

<decisions>
## Implementation Decisions

### Board Discovery & Field Mapping
- **D-01:** Single Monday.com board contains all kiosk data — migration reads one board
- **D-02:** Auto-detect field mapping by column name similarity, then present a review table for admin to confirm/adjust mappings before import
- **D-03:** Locations (hotels) are extracted from kiosk columns — deduplicate by hotel name to create unique location records, then link kiosks to locations
- **D-04:** Pipeline stages auto-created for any Monday.com status values that don't match existing stages — admin reviews new stages after import

### Migration UI & Admin Experience
- **D-05:** Migration lives at Settings > Data Import — new card on Settings page, admin-only, at `/settings/data-import`
- **D-06:** Dry-run preview shows summary table: total records found, records mapped successfully, records with warnings (unmapped fields, missing data), sample of first 10-20 mapped records. Admin clicks "Import" to commit
- **D-07:** Full import shows progress bar (X/total records) with scrollable live log of actions and warnings — runs in-browser via polling or SSE

### Conflict & Duplicate Handling
- **D-08:** Duplicate kiosk IDs are skipped with a warning log entry — existing records left untouched. Dry-run flags duplicates. Admin can clear data first if they want a clean import
- **D-09:** Unmapped/unrecognized Monday.com columns stored in the kiosk/location `notes` field as key:value pairs — dry-run preview shows which columns couldn't be mapped

### Error Recovery & Resilience
- **D-10:** Rate limits handled with exponential backoff + retry (1s, 2s, 4s... cap at 5 retries per request). Each retry logged in progress feed
- **D-11:** Partial failures don't stop the import — all failures collected in an error summary shown at completion. Safe to re-run since duplicates are skipped

### Product & Commission Schema
- **D-12:** Three new tables: `products` (id, name, unique), `providers` (id, name, unique), `location_products` (id, location_id FK, product_id FK, provider_id FK nullable, availability text "yes"/"no"/"unavailable", commission_tiers JSONB, timestamps)
- **D-13:** `commission_tiers` JSONB is an array of `{ minRevenue: number, maxRevenue: number | null, rate: number }` — configurable per product per hotel. Monday.com's two columns (<£3000pm and >£3000pm) seed the initial two tiers
- **D-14:** Import seeds `products` and `providers` tables from distinct subitem values across the board (e.g., products: Transfers, Airport Shuttle, Tours & Activities, Theatre, Sightseeing Pass, Hop-on Hop-off Bus Tour; providers: Uber, WeKnow, TUI Musement, London Theatre Direct, Go City, Big Bus, Toot Bus)
- **D-15:** When a new product is added from the hotel configuration UI, a `location_products` row is created for **every** location with availability defaulting to "unavailable" — ensures all hotels show all products
- **D-16:** Hotel configuration page shows all products in a grid/table — admin sets availability, provider, and commission tiers per product per hotel
- **D-17:** Monday.com subitems live on subboard `1413119149` — fetched via `subitems { id name column_values { id text value } }` nested inside the main items query. Subitem column IDs: `label2__1` (Provider), `color5__1` (Availability), `dup__of_commission9__1` (Commission <£3000pm), `numeric_mkse455j` (Commission >£3000pm)

### Claude's Discretion
- Monday.com API client implementation details (GraphQL query structure, pagination cursor handling)
- Exact UI layout of the data import page and mapping review table
- SSE vs polling for progress updates
- Field mapping heuristics (exact name match vs fuzzy matching)
- Dry-run sample size and table column selection
- Error summary format and display
- Hotel configuration page layout for product/commission editing (beyond what UI-SPEC covers)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project & Requirements
- `.planning/PROJECT.md` — Project vision, constraints, Monday.com migration context
- `.planning/REQUIREMENTS.md` — MIGR-01, MIGR-02, MIGR-03 define Phase 4 requirements

### Prior Phase Context
- `.planning/phases/01-foundation/01-CONTEXT.md` — Auth flow, role permissions, app shell/sidebar structure
- `.planning/phases/02-core-entities-and-views/02-CONTEXT.md` — Kiosk/Location data model decisions, server action patterns, Settings page layout

### Database Schema
- `src/db/schema.ts` — Complete Drizzle schema: kiosks (20+ fields), locations (15+ fields), kioskAssignments, pipelineStages — these are the target tables for migration. Phase 4 adds products, providers, location_products tables

### Existing Patterns
- `src/app/(app)/settings/page.tsx` — Settings page card grid layout (add Data Import card here)
- `src/app/(app)/settings/users/actions.ts` — Server action pattern (requireRole, Zod validation, error handling)
- `src/lib/rbac.ts` — requireRole("admin") guard for admin-only features

### Monday.com API
- `.env.test` — Contains `MONDAY_API_TOKEN` for API access
- Monday.com API uses GraphQL — board columns, items, and pagination via cursor-based queries

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Settings page** (`src/app/(app)/settings/page.tsx`): Card grid with admin-gated cards — add "Data Import" card
- **AppShell** (`src/components/layout/app-shell.tsx`): Page header component — use for data import page
- **RBAC helpers** (`src/lib/rbac.ts`): requireRole("admin") — gate migration to admin-only
- **Server action pattern** (`src/app/(app)/settings/users/actions.ts`): Try/catch, Zod validation, role guard
- **Progress component** (`src/components/ui/progress.tsx`): shadcn progress bar — use for import progress
- **Table component** (`src/components/ui/table.tsx`): shadcn table — use for dry-run preview and mapping review
- **Badge component** (`src/components/ui/badge.tsx`): Use for status indicators (mapped/unmapped/warning)
- **Scroll Area** (`src/components/ui/scroll-area.tsx`): Use for live log scrolling

### Established Patterns
- **Server actions**: Try/catch with Error union returns, Zod validation, requireRole() guard
- **Client hydration**: Server component fetches data → client component for interactivity
- **Toast feedback**: Sonner toast for success/error notifications
- **Design tokens**: WeKnow CSS variables in globals.css (wk-graphite, wk-azure, tints)

### Integration Points
- **Settings page**: Add "Data Import" card to existing grid at `src/app/(app)/settings/page.tsx`
- **App router**: New routes at `src/app/(app)/settings/data-import/` for migration UI
- **Database**: Drizzle ORM client at `src/db/index.ts` for inserting imported records
- **Pipeline stages**: `src/db/schema.ts` pipelineStages table — auto-create missing stages

</code_context>

<specifics>
## Specific Ideas

- Migration is a one-time (or few-times) operation — keep the UI functional but don't over-engineer
- Board exploration step (Plan 04-01) must document actual column names and types before mapping can be written
- Location deduplication by hotel name — the key linking field between kiosks and locations in Monday.com
- The "notes" field as a catch-all for unmapped data preserves information without schema changes
- Re-runnable import (skip duplicates) means admin can safely retry after fixing errors

</specifics>

<deferred>
## Deferred Ideas

- Full product/commission management UI (CRUD for products, bulk commission editing) — Phase 4 delivers the import and per-hotel config view, not a dedicated product management admin section

</deferred>

---

*Phase: 04-data-migration*
*Context gathered: 2026-04-01*
