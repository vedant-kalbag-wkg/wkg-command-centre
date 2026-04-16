# Pitfalls Research

**Domain:** Internal kiosk/asset lifecycle management platform (replacing Monday.com)
**Researched:** 2026-03-18
**Confidence:** HIGH (domain-specific; cross-verified across official docs, community post-mortems, and architectural patterns)

---

## Critical Pitfalls

### Pitfall 1: Treating Kiosk-to-Venue as a Simple Foreign Key

**What goes wrong:**
A single `venue_id` column on the `kiosks` table is the first instinct. This breaks immediately when a kiosk is reassigned — you lose the historical record of where it was, when it left, and why. Querying "which kiosks were at Venue X in Q3 2024?" becomes impossible.

**Why it happens:**
Developers model the current state, not the history. It looks correct for reads (give me this kiosk's current venue) until the first reassignment reveals you've destroyed data.

**How to avoid:**
Model the assignment as a first-class entity: `kiosk_assignments` table with `kiosk_id`, `venue_id`, `assigned_at`, `unassigned_at` (nullable = current), and `reason`. Never update the current row — always close it (`unassigned_at = now()`) and insert a new one. Use a partial unique index to enforce only one open assignment per kiosk at a time (`WHERE unassigned_at IS NULL`). PostgreSQL 18 adds `WITHOUT OVERLAPS` temporal constraints to enforce non-overlapping periods at the DB level.

**Warning signs:**
- Schema has `venue_id` directly on `kiosks` with no assignment table
- "Move kiosk" feature calls `UPDATE kiosks SET venue_id = ?` with no history insert
- Reports can only answer "where is it now?" not "where was it then?"

**Phase to address:**
Foundation / Data Model phase — must be correct before any data is entered. Cannot be retrofitted cheaply once assignment records exist.

---

### Pitfall 2: Integer Positions for Pipeline Stage Ordering

**What goes wrong:**
Storing stage order as `position INTEGER` (1, 2, 3...) means every reorder operation requires updating N rows — a batch UPDATE on all stages from the drop point onwards. In a multi-user environment this causes race conditions and optimistic lock conflicts. Inserting a new stage between positions 2 and 3 forces renumbering everything after position 2.

**Why it happens:**
Integer positions are the obvious first approach and work fine until users start reordering frequently or two admins reorder simultaneously.

**How to avoid:**
Use a floating-point or lexicographic fractional position (Trello's "Squeezing" algorithm). Store position as `FLOAT8` or a `VARCHAR` using LexoRank. When inserting between positions 1.0 and 2.0, assign 1.5. Only rebalance (re-number all) when precision is exhausted (rare). This reduces stage reorder to a single row UPDATE. For this scale (< 20 pipeline stages), a float approach is sufficient and simplest.

**Warning signs:**
- Schema has `position SMALLINT NOT NULL` on stages table
- Reorder logic fetches all stages, increments integers, mass-updates
- Admin UI is sluggish when reordering under concurrent use

**Phase to address:**
Foundation / Data Model phase — pipeline stage schema design. Fix the position column type before the first migration runs.

---

### Pitfall 3: Deleting Pipeline Stages That Kiosks Are Assigned To

**What goes wrong:**
An admin renames or deletes a lifecycle stage. All kiosks currently in that stage lose their status. Worse: historical audit log entries now reference a stage ID that no longer exists. Reports break. Filters return nothing.

**Why it happens:**
Admin UI for "manage stages" is built before anyone thinks about referential integrity with live kiosk records and audit history.

**How to avoid:**
Never hard-delete pipeline stages. Use soft-delete: `archived_at` timestamp. Archived stages are hidden from the pipeline UI but remain queryable for history. When an admin tries to delete a stage with active kiosks, block the delete and prompt them to migrate kiosks first, or auto-archive instead of delete. Audit log rows must store the stage name as a denormalized string, not just the stage ID.

**Warning signs:**
- Pipeline stage `DELETE` endpoint exists with no guard on active kiosk count
- Audit log stores only `stage_id` foreign key, not a snapshot of the stage name
- No `archived_at` column on stages table

**Phase to address:**
Foundation / Data Model + Admin Configuration phase.

---

### Pitfall 4: Monday.com Migration Assumes Clean, Structured Data

**What goes wrong:**
Monday.com boards use free-text columns, inconsistent naming, and per-board custom columns. When you pull data via the GraphQL API, you get column values as raw JSON strings keyed by column ID (not column name). A "Status" dropdown column in Monday returns `{"index": 2}` — you have to map the integer index to the label by fetching the column's settings separately. Teams assume they can do a direct INSERT and instead spend weeks on data cleaning.

**Why it happens:**
Monday.com's data model is schema-on-read. It stores everything as JSON blobs. The API reflects this — column values are serialized per-column-type with no consistent structure.

**How to avoid:**
Build the migration as a two-phase ETL:
1. **Extract + Inspect**: Pull all boards, items, and column definitions. Produce a JSON inventory showing every column type and sample values. Do this before writing any import logic.
2. **Transform + Load**: Write explicit field mappers per column type (status, text, date, link, file, dropdown, person). Test on a sample of 50 items before bulk import.

Key Monday.com API constraints to work around:
- Max 500 items per `items_page` query (cursor-based pagination required)
- 100 item max when fetching by ID array
- 10M complexity points/minute rate limit — batch inserts need backoff + retry
- Column value JSON format changed in API version 2025-04 (breaking: `column_type` no longer appends "Column")
- API versions 2024-10 and 2025-01 deprecated as of February 15, 2026 — use 2025-04

**Warning signs:**
- Migration script uses column names (not column IDs) to access values
- No retry/backoff logic for rate limit errors
- Migration runs in a single transaction against all 1,000+ items at once
- No dry-run mode that maps but does not insert

**Phase to address:**
Dedicated Migration phase — must come after data model is finalized, before go-live.

---

### Pitfall 5: Building the Gantt View from Scratch

**What goes wrong:**
The Gantt view is the most complex of the four view types by an order of magnitude. Building it from scratch — scroll synchronisation between the label column and the timeline, drag-to-resize bars, zoom levels, dependency arrows, today marker, row virtualization for 1,000+ kiosks — takes 6-10x longer than estimated. Teams start late, ship a broken version, and it becomes the permanent "we'll fix it later" feature.

**Why it happens:**
Gantt looks like "just a bar chart with dragging." It is not. It is a custom rendering engine. The mistake is scoping it as a UI component rather than a sub-product.

**How to avoid:**
Use an established React Gantt library (SVAR Gantt, Frappe Gantt, or similar). Do not build the timeline rendering engine. Customise the library to match WeKnow brand (Azure/Graphite tokens). Scope the Gantt to read-only + drag-to-update dates only — do not add dependency arrows in v1. Defer milestone overlays to a later phase.

**Warning signs:**
- Gantt estimated at 1-2 weeks
- No library selected during scoping — "we'll build it"
- Gantt and Kanban lumped into the same phase with equal weight

**Phase to address:**
Views phase — Gantt should be its own sub-phase with a library selection decision locked before development starts.

---

### Pitfall 6: Saveable Views Stored Only in localStorage

**What goes wrong:**
Custom views (saved filters, column visibility, sort order, grouping) are persisted in `localStorage` for speed. A user opens the app on a second device: their views are gone. IT clears browser storage during troubleshooting: all saved views lost. Users share a browser profile: views bleed between users. Support cannot reproduce a user's state because the state is client-side only.

**Why it happens:**
localStorage is the fastest path to "it works in the demo." The per-device problem only surfaces in production.

**How to avoid:**
Store saved views in the database: `saved_views` table with `user_id`, `name`, `is_shared` (bool), `view_type`, `config JSONB`. Shared views have `shared_by_user_id` and are visible to all users. Use URL parameters for ephemeral filter state (so users can share a filtered URL without saving). Use localStorage only as a write-through cache for the current session's unsaved filter state.

**Warning signs:**
- `views` data is written only to `localStorage` or `sessionStorage`
- No `saved_views` table in the database schema
- Sharing a view requires copy-pasting a long URL with encoded state

**Phase to address:**
Core Data / Views phase — design the saved views schema alongside the table view, not as a later addition.

---

### Pitfall 7: Audit Log Missing Business Context

**What goes wrong:**
The audit log captures `UPDATE kiosks SET status = 'live' WHERE id = 123` at the database level. When an ops manager asks "who moved this kiosk to Live last Tuesday and what was the reason?" the log shows a user ID, a timestamp, and a column name — but no business context. No previous value. No reason code. No readable stage name. Ops teams reject the audit log as useless and revert to email paper trails.

**Why it happens:**
Audit logging is treated as a database concern (triggers or ORM hooks) rather than a business event. The log captures the data change, not the intention.

**How to avoid:**
Log at the application layer, not the database trigger layer. Each audit entry must include: `actor_id`, `actor_name` (denormalized), `entity_type`, `entity_id`, `entity_name` (denormalized, e.g. "Kiosk KSK-0042"), `action` (human-readable verb), `field_changed`, `old_value` (serialized), `new_value` (serialized), `reason` (optional free text), `ip_address`, `created_at`. Store stage names and user names as strings — do not rely on joins to reconstruct what a stage was called at the time of the event.

**Warning signs:**
- Audit log is a database trigger writing raw diffs
- Log entries reference only IDs with no denormalized names
- No `old_value` / `new_value` columns
- Audit log UI is a raw JSON dump with no human-readable formatting

**Phase to address:**
Foundation phase — audit log schema must be defined before any write operations are built. Retrofitting is expensive.

---

### Pitfall 8: RBAC Implemented as a Single "Admin" Flag

**What goes wrong:**
The first implementation adds `is_admin BOOLEAN` to the users table. This is fine until Operations needs write access but not IT configuration, or Read-only stakeholders need to export but not edit. Adding role complexity after the fact requires refactoring every permission check in the codebase.

**Why it happens:**
Three roles (Ops, IT, Read-only) looks manageable with if/else checks. The explosion happens when you discover operations need field-level restrictions (IT can see banking details, Ops cannot) or when a fourth role is requested.

**How to avoid:**
Implement a proper `roles` table from day one: `users.role_id` FK to `roles`. Define permission checks as named constants in a central permissions module (e.g. `can(user, 'kiosk:update')`) — never inline `user.role === 'admin'` checks. For v1, three roles (ops, it, viewer) are sufficient. The central permissions module means adding a fourth role is a data change, not a code change.

**Warning signs:**
- `is_admin` boolean on users table
- Permission checks scattered inline across route handlers
- No central permissions/authorization module
- "Read-only" implemented by hiding buttons rather than server-side enforcement

**Phase to address:**
Foundation phase — authentication and RBAC schema must precede any feature that writes data.

---

### Pitfall 9: Bulk Edit Without Conflict Detection

**What goes wrong:**
A user selects 200 kiosks and bulk-moves them to "Configured" status. Simultaneously another user is editing one of those kiosks. The bulk operation silently overwrites the concurrent change. Alternatively, the bulk operation fails halfway through — 100 kiosks update successfully, 100 do not — and the UI reports "done" while the data is in a split state.

**Why it happens:**
Bulk edits are often built as N sequential single-record updates. When one fails, the loop continues. No transaction wraps the batch. No conflict detection (e.g. `updated_at` timestamp check) is applied.

**How to avoid:**
Bulk edits must be a single database transaction — all-or-nothing. If partial success is acceptable business behavior, it must be explicit and surfaced to the user ("18 of 200 failed — reasons: X"). Use optimistic concurrency on each record (`WHERE id = ? AND updated_at = ?`). Return a per-record result from the bulk endpoint, not a single 200 OK.

**Warning signs:**
- Bulk update API loops over records with individual UPDATE calls
- No database transaction wrapping the batch
- Bulk endpoint returns `{ success: true }` rather than per-record results
- No `updated_at` version field on kiosk records

**Phase to address:**
Core Features / Table View phase — when bulk edit is first built.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `venue_id` FK on kiosks instead of assignment table | Simpler schema to start | Cannot query assignment history; requires schema migration with data transform | Never — design it correctly from the start |
| `position INTEGER` for stage ordering | Obvious to implement | Race conditions on reorder; batch UPDATE required | Never — use float or LexoRank from the start |
| Store views in localStorage only | Zero backend work | Views lost on device switch; no sharing; no support visibility | Never for named saved views; acceptable for ephemeral unsaved state |
| Database trigger audit log | Low dev effort | Missing business context; hard to query human-readable history | Only if compliance requirement is binary (changed/not) with no human review |
| `is_admin` boolean for RBAC | Ships fast for 2 roles | Must refactor every permission check when 3rd role needed | Only for proof-of-concept, never in production data model |
| Single Monday migration script without dry-run | Faster to write | Silent data corruption; no way to validate before commit | Never — dry-run mode is mandatory for a 1,000+ record import |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Monday.com GraphQL API | Fetch all items in one request | Use cursor-based pagination with `items_page` (max 500/page); implement retry on rate limit errors using `retry_in_seconds` |
| Monday.com GraphQL API | Access column values by column name string | Fetch column definitions first; map column IDs to types; parse JSON values per column type |
| Monday.com GraphQL API | Use deprecated API version | Pin to `2025-04`; versions 2024-10 and 2025-01 auto-route to 2025-04 as of Feb 2026 which breaks field names |
| Monday.com GraphQL API | Run migration without rate limit awareness | Budget for 1,000 items at 500/page = 2 pages for items; multiply by columns depth for complexity; add `await sleep(retry_in_seconds * 1000)` on 429 |
| File attachments (contracts/banking docs) | Store binary in PostgreSQL | Store files in S3 (or Vercel Blob); store only the URL + metadata in the DB |
| File attachments | No virus scanning | At minimum, restrict MIME types and file extensions server-side; do not trust `Content-Type` header |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unindexed filters on kiosk table | Table view loads slowly when filtering by region/status/hotel group | Add composite indexes on the columns used in filter dropdowns before data is imported | 1,000+ rows without indexes; noticeable at 500+ |
| N+1 queries in kiosk list with venue join | Each row triggers a separate venue lookup query | Use eager loading (Prisma `include`) in list queries; never fetch venue inside a loop | Visible at ~50 kiosks in a single page load |
| Unindexed audit log queries | "Recent changes" panel loads slowly; audit log pagination hangs | Index `(entity_type, entity_id)` and `(actor_id, created_at DESC)` on audit_log table | Noticeable once > 10,000 audit entries (accumulates fast) |
| Full history query for assignment timeline | Kiosk detail page slow when showing full assignment history | Paginate assignment history; index `(kiosk_id, assigned_at DESC)` | Not an issue at current scale (< 50 assignments per kiosk), but build the index anyway |
| Reporting aggregates without materialized views | Monthly kiosk activation reports scan full history tables | For time-series metrics, pre-aggregate into a `monthly_snapshots` table or use materialized views | Reports become slow at > 5,000 historical records |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Server-side permission checks missing — only UI hides buttons | Any user with DevTools can call write endpoints; Read-only users can edit records | Enforce permissions at the API handler level on every route; never rely only on UI visibility |
| Banking details returned in all kiosk API responses | Sensitive financial data exposed to Read-only and Ops users | Scope banking detail fields to IT role only; exclude from default kiosk serializer; require explicit field request |
| File upload endpoint accepts any file type | Malicious file upload; XSS via SVG | Validate MIME type and extension server-side; restrict to PDF, DOCX, XLSX, PNG, JPG; serve files via signed S3 URLs, not directly |
| Audit log endpoint has no authorization | Any logged-in user can view all changes by all users | Restrict audit log access to IT role and above; audit log itself is sensitive (reveals user activity patterns) |
| Monday.com API key stored in source code | Key leaked via git history | Store in environment variable only; document in `.env.example` with placeholder; never commit `.env.test` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Pipeline stage changes require page refresh to reflect in Kanban/Table | Ops user drags a kiosk card, another user sees stale status; confusion about who moved what | Invalidate and refetch the affected kiosk record after any status change; use TanStack Query's mutation + cache invalidation |
| Bulk edit confirmation is a generic "Are you sure?" modal | Users cannot tell which fields will change for which records; irreversible mass-updates | Show a preview diff: "200 kiosks will move from [current mixed statuses] to Configured. This cannot be undone." |
| Gantt view does not degrade gracefully for large fleets | With 1,000 kiosks, Gantt is unusable without grouping | Default Gantt view to filtered/grouped (by region or phase tag); warn when > 100 rows are visible |
| Saving a custom view silently overwrites the previous one | User accidentally overwrites a shared view used by others | Distinguish "save" (update existing) from "save as new" (create copy); shared views require explicit overwrite confirmation |
| Filter state is lost on browser back navigation | User configures a complex filter, clicks into a kiosk record, presses Back — filter is gone | Persist ephemeral filter state in URL query params; this also enables sharing filtered views via URL copy |

---

## "Looks Done But Isn't" Checklist

- [ ] **Assignment History:** The kiosk detail page shows current venue — verify it also shows the full history (date in, date out, reason) as a timeline/table, not just the current assignment.
- [ ] **Pipeline Stage Delete:** The admin can "delete" a stage — verify deletion is blocked when kiosks are assigned to that stage, and verify archived stages still appear in audit history with their original name.
- [ ] **Bulk Edit:** The bulk status update appears to work — verify it is wrapped in a single DB transaction, returns per-record results, and fails atomically if any record has a conflict.
- [ ] **Saved Views:** A saved view appears in the dropdown — verify it persists after clearing localStorage, verify it appears on a different device logged in as the same user.
- [ ] **Audit Log:** The audit log shows entries — verify it captures old AND new values for every field change, not just that a change occurred.
- [ ] **RBAC:** Read-only users cannot see Edit buttons — verify that the API endpoints also return 403 for write operations by a Read-only token (test via curl/Postman, not just UI).
- [ ] **Monday.com Migration:** The migration script runs successfully on 10 items — verify it handles the full 1,000+ items with pagination, rate limit backoff, and a dry-run mode that reports mapping issues without inserting.
- [ ] **Banking Details:** Banking details display for IT users — verify the API response for an Ops-role user does NOT include banking fields (inspect the raw network response, not just the UI).
- [ ] **File Attachments:** A PDF uploads successfully — verify the upload endpoint rejects non-allowed MIME types and that the stored URL is a signed S3 URL, not a public-access URL.
- [ ] **Reporting Time-Series:** The "kiosks live per month" chart renders — verify it counts kiosks that were live at any point during the month, not just those created that month.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong assignment model (FK instead of history table) | HIGH | Write migration to create `kiosk_assignments` table; backfill from `kiosks.venue_id` with synthetic `assigned_at = kiosk.created_at`; accept that pre-migration history is lost |
| Integer stage positions with race condition | MEDIUM | Write migration to recalculate positions as floats from current order; update all INSERT/UPDATE logic; no data loss |
| Views stored in localStorage discovered post-launch | MEDIUM | Create `saved_views` table; write one-time migration that cannot recover lost views; communicate to users; build sync from localStorage on first login |
| Monday.com migration corrupted records | MEDIUM | Implement migration with `--dry-run` and `--rollback` modes before running on production; keep a `migrated_from_monday` boolean + `monday_item_id` column to identify and purge/reimport specific records |
| Audit log missing old values | HIGH | Cannot recover historical old values — data is gone. Prevent by requiring old_value/new_value in the schema before any writes are built. |
| RBAC `is_admin` boolean requiring refactor | MEDIUM | Create `roles` table; migrate `is_admin = true` to an "admin" role; replace `user.is_admin` checks with `can(user, permission)` checks across all routes |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Assignment history model | Phase 1: Foundation / Data Model | Query `SELECT * FROM kiosk_assignments WHERE kiosk_id = ?` returns dated rows; reassigning a kiosk closes previous row and opens a new one |
| Integer stage positions | Phase 1: Foundation / Data Model | Confirm `position` column is `FLOAT8` or equivalent; reorder 3 stages, verify only 1 row updated |
| Stage delete cascading | Phase 2: Admin Configuration | Attempt to delete a stage with an active kiosk — must be blocked; verify archived stage name appears in audit log |
| Monday.com migration | Dedicated Migration Phase | Dry-run reports field mapping for all column types; full run handles rate limits and paginates all 1,000+ items; rollback removes migrated records |
| Gantt from scratch | Phase 4: Views (Gantt sub-phase) | Library selected in scoping; drag-to-resize works; 1,000 kiosks render without browser freeze |
| Saved views in localStorage | Phase 2: Core Views | Saved view persists after `localStorage.clear()`; same view appears on different device same user |
| Audit log missing context | Phase 1: Foundation | Every write operation produces an audit entry with actor name, old value, new value as human-readable strings |
| RBAC as boolean flag | Phase 1: Foundation | Three roles confirmed in `roles` table; Read-only API token returns 403 on write endpoint (verified via API client) |
| Bulk edit no transaction | Phase 3: Bulk Operations | Simulate a mid-batch DB error; verify zero records were updated (not partial); verify per-record result array in response |
| Banking detail exposure | Phase 1: Foundation / RBAC | Assert Ops-role API response for kiosk detail does not contain `banking_details` key |

---

## Sources

- [Monday.com API Rate Limits — Official Developer Docs](https://developer.monday.com/api-reference/docs/rate-limits)
- [Monday.com Migrating to 2025-04 — Official Developer Docs](https://developer.monday.com/api-reference/docs/migrating-to-version-2025-04)
- [Monday.com items_page Query Limits 2024 — Community Forum](https://community.monday.com/t/2024-01-api-items-page-query-limits-500-or-100/74835)
- [Monday.com API Delay Between Board Update and API Data Availability](https://community.monday.com/t/delay-between-board-update-and-api-data-availability/30127)
- [PostgreSQL Temporal Constraints (PostgreSQL 18 WITHOUT OVERLAPS)](https://betterstack.com/community/guides/databases/postgres-temporal-constraints/)
- [Temporal Database — Wikipedia (valid-time / transaction-time concepts)](https://en.wikipedia.org/wiki/Temporal_database)
- [Kanban Board Column Indexing — A Robust Mechanism (fractional indexing)](https://nickmccleery.com/posts/08-kanban-indexing/)
- [6 Common RBAC Implementation Pitfalls — Idenhaus](https://idenhaus.com/rbac-implementation-pitfalls/)
- [Enterprise Ready: Audit Logging Guide](https://www.enterpriseready.io/features/audit-log/)
- [Audit Logging Best Practices — Sonar](https://www.sonarsource.com/resources/library/audit-logging/)
- [SVAR React Gantt — High-performance React Gantt library](https://github.com/svar-widgets/react-gantt)
- [TanStack Query Optimistic Updates](https://tanstack.com/query/v4/docs/framework/react/guides/optimistic-updates)
- [Saving Data Historically with Temporal Tables — Red Gate Simple Talk](https://www.red-gate.com/simple-talk/databases/postgresql/saving-data-historically-with-temporal-tables-part-1-queries/)

---
*Pitfalls research for: Internal kiosk/asset lifecycle management platform (WeKnow Group)*
*Researched: 2026-03-18*
