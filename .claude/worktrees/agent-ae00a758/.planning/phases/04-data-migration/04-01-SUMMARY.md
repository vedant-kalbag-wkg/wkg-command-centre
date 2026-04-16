---
phase: 04-data-migration
plan: 01
subsystem: data-migration
tags: [monday-api, graphql, field-mapping, server-actions, import]
dependency_graph:
  requires: [04-00]
  provides: [monday-client, field-mapper, import-actions]
  affects: [04-02]
tech_stack:
  added: []
  patterns: [graphql-fetch, cursor-pagination, exponential-backoff, module-level-session, onConflictDoNothing]
key_files:
  created:
    - src/lib/monday-client.ts
    - src/lib/field-mapper.ts
    - src/app/(app)/settings/data-import/actions.ts
  modified:
    - src/db/schema.ts
decisions:
  - "Used MondayItem[] type import at top of actions.ts — typeof import() pattern not supported for exported interface types in Next.js RSC"
  - "Async generator fetchAllItems yields pages — caller collects all pages before DB writes (Pitfall 1: cursor expires after 60 min)"
  - "runFullImport uses detached void async — returns sessionId immediately; client polls getImportProgress"
  - "Module-level importSessions Map — acceptable for single-server one-time admin tool (per RESEARCH.md Pattern 5)"
metrics:
  duration: 4min
  completed: 2026-04-01T13:10:41Z
  tasks: 2
  files: 4
---

# Phase 04 Plan 01: Monday.com Client, Field Mapper, and Import Actions Summary

**One-liner:** Monday.com GraphQL client with cursor pagination and exponential backoff retry, field mapping engine with subitem parser, and four admin-gated server actions (explore/dry-run/import/progress).

## What Was Built

### Task 1: Monday.com GraphQL Client (`src/lib/monday-client.ts`)

- `mondayQuery<T>`: POST to `https://api.monday.com/v2` with `Authorization`, `Content-Type`, `API-Version: 2024-01` headers. Throws if `MONDAY_API_TOKEN` not set. Throws on HTTP errors or GraphQL errors.
- `mondayQueryWithRetry<T>`: Wraps `mondayQuery` with exponential backoff. Initial delay 1000ms, doubles each retry, capped at 32000ms. Max 5 retries. Only retries on rate-limit errors. Accepts optional `onRetry` callback.
- `fetchBoardColumns(boardId)`: Returns `BoardColumn[]` (id, title, type) for admin mapping review UI.
- `fetchAllItems(boardId, onProgress?)`: Async generator. Fetches `items_page(limit: 500)` then follows `next_items_page` cursor until null. Subitems fetched inline per D-17 — not a separate API call.
- Full TypeScript types exported: `MondayItem`, `MondaySubitem`, `MondayColumnValue`, `BoardColumn`.

### Task 2: Field Mapper Engine (`src/lib/field-mapper.ts`)

- `KNOWN_FIELD_MAP`: Static lookup from Monday.com column title to Drizzle field (10 known mappings from reference project).
- `autoDetectMappings(columns)`: Exact match first, then case-insensitive includes fallback. Returns `FieldMapping[]` with status `"mapped"` or `"unmapped"`.
- `mapMondayItemToKiosk`: Uses item name as `kioskId`. Extracts kiosk fields from column values. Status label via `StatusValue` fragment (Pitfall 5). Returns `newStageName` for unknown statuses. Collects unmapped columns for notes (D-09).
- `mapMondayItemToLocation`: Extracts location fields; uses item name as location name.
- `extractLocationName`: Returns item name as deduplication key (D-03).
- `mapSubitemsToLocationProducts`: Maps subitems using column IDs `label2__1` (provider), `color5__1` (availability), `dup__of_commission9__1` (<£3000 commission), `numeric_mkse455j` (>£3000 commission). Builds two-tier commission JSONB (D-13).

### Task 2 (continued): Server Actions (`src/app/(app)/settings/data-import/actions.ts`)

- `exploreBoardColumns(boardId)`: Admin-only. Fetches board columns + runs `autoDetectMappings`. Returns `{ columns, mappings }`.
- `runDryImport(boardId, mappings)`: Fetches all items (no DB write). Checks duplicates. Maps fields. Returns `ImportPreview` with counts, first-20 samples, product/provider lists.
- `runFullImport(boardId, mappings)`: Returns `sessionId` immediately. Detached async: deduplicate locations (D-03), auto-create stages (D-04), upsert products/providers (D-14), insert kiosks with `onConflictDoNothing` (D-08, Pitfall 6), create assignments and location_products. Per-item errors logged, import continues (D-11). Unmapped columns → notes (D-09).
- `getImportProgress(sessionId)`: Reads from module-level `importSessions` Map. Client polls for progress updates (D-07).

### Deviation: Schema Extension

The three Phase 4 tables (`products`, `providers`, `locationProducts`) were not present in `schema.ts` because Plan 04-00 (wave 0 setup) had not been executed. Added as a **[Rule 3 - Blocking]** deviation since `actions.ts` requires these tables at compile time.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added products/providers/locationProducts tables to schema.ts**
- **Found during:** Pre-task analysis — Plan 04-00 (depends_on prerequisite) not yet executed
- **Issue:** `actions.ts` imports and inserts into `products`, `providers`, `locationProducts` tables; build would fail without them
- **Fix:** Added all three table definitions to `src/db/schema.ts` following the Phase 4 section pattern from 04-00-PLAN.md
- **Files modified:** `src/db/schema.ts`
- **Commit:** 11e3228

**2. [Rule 1 - Bug] Fixed invalid `typeof import()` type annotation**
- **Found during:** Task 2 — `npx next build` TypeScript check
- **Issue:** `const allItems: (typeof import("@/lib/monday-client").MondayItem)[]` — Next.js build rejected this pattern for exported interfaces
- **Fix:** Added `MondayItem` to the named imports from `@/lib/monday-client`; replaced all occurrences with `MondayItem[]`
- **Files modified:** `src/app/(app)/settings/data-import/actions.ts`
- **Commit:** 499db27 (fix included in same commit)

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Async generator for fetchAllItems | Yields pages progressively; callers collect all pages before DB writes to avoid cursor expiry (Pitfall 1) |
| Module-level importSessions Map | Per RESEARCH.md Pattern 5 — acceptable for single-server, one-time admin tool; avoids DB dependency for transient state |
| onConflictDoNothing on all inserts | Safety net against race conditions and re-runs; explicit duplicate check before insert for user-visible skip logging |
| Status label via StatusValue fragment | Per Pitfall 5 — `text` field empty for Status columns in API-Version 2024-01; `label` from typed fragment is required |

## Known Stubs

None — all exported functions are fully implemented.

## Self-Check

- [x] `src/lib/monday-client.ts` created
- [x] `src/lib/field-mapper.ts` created
- [x] `src/app/(app)/settings/data-import/actions.ts` created
- [x] `src/db/schema.ts` updated
- [x] `npx next build` passes (no TypeScript errors)
- [x] All acceptance criteria pass (grep checks)
