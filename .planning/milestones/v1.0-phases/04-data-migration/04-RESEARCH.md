# Phase 4: Data Migration - Research

**Researched:** 2026-04-01
**Domain:** Monday.com GraphQL API, Next.js server actions, Drizzle ORM bulk insert, pagination
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Single Monday.com board contains all kiosk data — migration reads one board
- **D-02:** Auto-detect field mapping by column name similarity, then present a review table for admin to confirm/adjust mappings before import
- **D-03:** Locations (hotels) are extracted from kiosk columns — deduplicate by hotel name to create unique location records, then link kiosks to locations
- **D-04:** Pipeline stages auto-created for any Monday.com status values that don't match existing stages — admin reviews new stages after import
- **D-05:** Migration lives at Settings > Data Import — new card on Settings page, admin-only, at `/settings/data-import`
- **D-06:** Dry-run preview shows summary table: total records found, records mapped successfully, records with warnings (unmapped fields, missing data), sample of first 10-20 mapped records. Admin clicks "Import" to commit
- **D-07:** Full import shows progress bar (X/total records) with scrollable live log of actions and warnings — runs in-browser via polling or SSE
- **D-08:** Duplicate kiosk IDs are skipped with a warning log entry — existing records left untouched. Dry-run flags duplicates. Admin can clear data first if they want a clean import
- **D-09:** Unmapped/unrecognized Monday.com columns stored in the kiosk/location `notes` field as key:value pairs — dry-run preview shows which columns couldn't be mapped
- **D-10:** Rate limits handled with exponential backoff + retry (1s, 2s, 4s... cap at 5 retries per request). Each retry logged in progress feed
- **D-11:** Partial failures don't stop the import — all failures collected in an error summary shown at completion. Safe to re-run since duplicates are skipped

### Claude's Discretion

- Monday.com API client implementation details (GraphQL query structure, pagination cursor handling)
- Exact UI layout of the data import page and mapping review table
- SSE vs polling for progress updates
- Field mapping heuristics (exact name match vs fuzzy matching)
- Dry-run sample size and table column selection
- Error summary format and display

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MIGR-01 | Admin can trigger a Monday.com data import that maps Monday.com board columns to kiosk/location fields | Field mapping table from reference project + GraphQL column_values patterns |
| MIGR-02 | Migration supports dry-run mode (preview imported data before committing) | Server action dry-run pattern; no DB write, return preview payload |
| MIGR-03 | Migration handles pagination and rate limits for 1,000+ records | `next_items_page` cursor loop (up to 500/page); exponential backoff on rate limit response |
</phase_requirements>

---

## Summary

Phase 4 delivers a one-shot data migration from a single Monday.com board into the kiosk-management platform. The primary technical work is an authenticated GraphQL client that cursor-paginates through all board items, maps Monday.com column values to Drizzle schema fields, deduplicates locations by hotel name, auto-creates missing pipeline stages, and offers a dry-run preview before any database writes.

A reference implementation exists at `/Users/vedant/Work/WeKnowGroup/reporting-automation/src/monday_api.py`. It covers authentication, column value parsing by type, and field mapping heuristics. It does **not** implement pagination — the reference project reads at most 500 items in a single `items_page(limit: 500)` call and stops. For MIGR-03 (1,000+ records) a `next_items_page` cursor loop is net-new work.

The UI is a new route at `/settings/data-import`, admin-gated, with two steps: (1) a field mapping review table populated after fetching board column metadata, and (2) a dry-run/full-import action that streams progress via polling a server action.

**Primary recommendation:** Build the Monday.com GraphQL client as a plain `fetch` function (no SDK) matching the reference project's pattern, implement cursor pagination with `next_items_page`, use polling (not SSE) for progress updates to stay within the existing server-action architecture.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | `^0.45.1` (already installed) | Database writes for migrated records | Already the project ORM |
| `zod/v4` | `^4.3.6` (already installed) | Validate field mapping inputs | Already used in all server actions |
| `next` (server actions) | 16.1.7 (already installed) | API surface for migration triggers | No new dependencies needed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Built-in `fetch` | Node 18+ / Next 16 | Monday.com GraphQL requests | Already available, no extra package |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Built-in `fetch` | `monday-sdk-js` | SDK adds a dependency for simple POST calls; fetch is sufficient |
| Polling | SSE (Server-Sent Events) | SSE requires a Route Handler; polling works with existing server actions |

No additional packages need to be installed. Everything required is already in `package.json`.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── lib/
│   └── monday-client.ts       # GraphQL fetch wrapper, pagination loop, rate-limit retry
├── app/(app)/settings/
│   ├── page.tsx               # ADD Data Import card (admin-gated, like Audit Log card)
│   └── data-import/
│       ├── page.tsx           # Server component — fetch board columns, pass to client
│       ├── actions.ts         # Server actions: exploreBoardColumns, dryRunImport, runImport
│       └── data-import-client.tsx  # Client component — mapping table, progress UI, log
```

### Pattern 1: Monday.com GraphQL Client (fetch-based)

**What:** Thin wrapper over `fetch` to `https://api.monday.com/v2` — posts a GraphQL query with Authorization header, returns parsed data, throws typed errors.

**When to use:** All Monday.com API calls — board column fetch, items_page initial, next_items_page continuation.

```typescript
// Source: reference project monday_api.py adapted to TypeScript
const MONDAY_API_URL = "https://api.monday.com/v2";

async function mondayQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = process.env.MONDAY_API_TOKEN;
  if (!token) throw new Error("MONDAY_API_TOKEN not set");

  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(data.errors.map((e: { message: string }) => e.message).join("; "));
  return data.data as T;
}
```

### Pattern 2: Cursor Pagination with next_items_page

**What:** Iterative cursor loop — fetch up to 500 items, get cursor, call `next_items_page` until cursor is null.

**When to use:** Full board fetch (MIGR-03). The reference project does NOT implement this.

```typescript
// Source: developer.monday.com/api-reference/docs/querying-board-items
async function* fetchAllItems(boardId: number): AsyncGenerator<MondayItem[]> {
  // Initial page
  const INITIAL_QUERY = `
    query ($boardId: [ID!], $limit: Int!) {
      boards(ids: $boardId) {
        items_page(limit: $limit) {
          cursor
          items { id name column_values { id text value type ... on StatusValue { label } } }
        }
      }
    }
  `;
  const first = await mondayQuery<InitialResult>(INITIAL_QUERY, { boardId: [boardId], limit: 500 });
  let cursor = first.boards[0].items_page.cursor;
  yield first.boards[0].items_page.items;

  // Continuation pages
  const NEXT_QUERY = `
    query ($cursor: String!) {
      next_items_page(cursor: $cursor, limit: 500) {
        cursor
        items { id name column_values { id text value type ... on StatusValue { label } } }
      }
    }
  `;
  while (cursor) {
    const page = await mondayQueryWithRetry<NextResult>(NEXT_QUERY, { cursor });
    cursor = page.next_items_page.cursor;
    yield page.next_items_page.items;
  }
}
```

### Pattern 3: Exponential Backoff Retry (D-10)

**What:** Wrap `mondayQuery` calls with retry logic. Monday returns `retry_in_seconds` on rate limit (HTTP 429 or error code `rateLimitExceeded`).

**When to use:** All paginated item fetches.

```typescript
// Source: developer.monday.com/api-reference/docs/rate-limits — "retry_in_seconds" field
async function mondayQueryWithRetry<T>(
  query: string,
  variables?: Record<string, unknown>,
  maxRetries = 5
): Promise<T> {
  let delayMs = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await mondayQuery<T>(query, variables);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const isRateLimit = err instanceof Error && err.message.includes("rate");
      if (!isRateLimit) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 32000); // cap at 32s
    }
  }
  throw new Error("Max retries exceeded");
}
```

### Pattern 4: Server Action Pattern (existing project pattern)

**What:** `"use server"` module, `requireRole("admin")` guard, try/catch with typed return.

**When to use:** All migration triggers — matches `src/app/(app)/settings/users/actions.ts`.

```typescript
// Source: src/app/(app)/settings/users/actions.ts (project pattern)
"use server";
import { requireRole } from "@/lib/rbac";

export async function runDryImport() {
  try {
    await requireRole("admin");
    // ... fetch + map, no DB write
    return { success: true, preview: { ... } };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Import failed" };
  }
}
```

### Pattern 5: Progress via Polling

**What:** Server action writes progress to a temporary in-memory or DB store (e.g., a `migrationSessions` map or a simple DB row), client polls every 1-2s.

**When to use:** Full import progress feed (D-07). Chosen over SSE because the project has no Route Handlers and all server-to-client communication is action-based.

**Recommended approach:** Store progress state in a module-level `Map` keyed by session ID (acceptable for a one-time admin tool on single-server Next.js). Client calls a `getImportProgress(sessionId)` server action on an interval.

### Pattern 6: Settings Page Card (existing project pattern)

**What:** Add a Data Import card to `src/app/(app)/settings/page.tsx`, wrapped in `{isAdmin && ...}`.

```typescript
// Source: src/app/(app)/settings/page.tsx (project pattern)
{isAdmin && (
  <Link href="/settings/data-import" className="group">
    <Card className="h-full cursor-pointer border-wk-mid-grey/40 transition-shadow group-hover:shadow-md">
      <CardHeader>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg bg-wk-sky-blue flex items-center justify-center">
            <Database className="w-5 h-5 text-wk-azure" />
          </div>
          <CardTitle className="text-base font-medium">Data Import</CardTitle>
        </div>
        <CardDescription className="text-sm text-wk-night-grey">
          Import kiosk and location records from Monday.com.
        </CardDescription>
      </CardHeader>
    </Card>
  </Link>
)}
```

### Anti-Patterns to Avoid

- **Single items_page(limit: 500) call:** Only retrieves first 500 rows. For 1,000+ records, `next_items_page` cursor loop is mandatory. The reference project `monday_api.py` makes this mistake — do not copy it.
- **Blocking the server action thread for 1,000+ items:** The full import should accumulate progress state and return immediately, running async work via a detached promise or background task. Client polls for updates.
- **Importing without duplicate check:** Always check `kioskId` against existing DB records before insert. The Drizzle schema has `.unique()` on `kiosk_id` — duplicate inserts will throw FK/unique violations if not pre-checked.
- **Hard-coding the board ID in server code:** Board ID should come from env var (`MONDAY_BOARD_ID`) so it can be changed without code deployment.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| GraphQL request | Custom HTTP client | `fetch` + JSON body | GraphQL is just POST; no library needed for a single endpoint |
| Field name fuzzy matching | Edit-distance algorithm | Exact match first, then includes/startsWith | Reference project shows variation aliases work fine; edit-distance adds complexity for minimal gain |
| Cursor pagination | Custom offset/page numbering | Monday.com `next_items_page` cursor | Cursor is the only supported pagination; offset-based queries don't exist on this API |
| UI progress bar | Custom animation | `src/components/ui/progress.tsx` (shadcn) | Already in the project |
| Live log scrolling | Custom scroll component | `src/components/ui/scroll-area.tsx` (shadcn) | Already in the project |
| Status badges (mapped/warning/error) | Custom span styling | `src/components/ui/badge.tsx` (shadcn) | Already in the project |

**Key insight:** The entire migration stack uses only existing infrastructure — no new npm packages are needed.

---

## Known Field Mapping (from Reference Project)

The reference project (`reporting-automation/src/monday_config.py`) documents actual Monday.com column names for the WeKnow boards. Plan 04-01 must verify these against the actual board, but this gives a strong starting hypothesis:

| Monday.com Column Name | Target Drizzle Field | Table | Notes |
|------------------------|---------------------|-------|-------|
| Item name (board row name) | `kiosk_id` or hotel `name` | kiosks / locations | Row name is primary identifier in Monday |
| `Outlet Code` | `outlet_code` | kiosks | |
| `Cust_cd (RPS)` | `customer_code_1` | kiosks | |
| `Number of SSMs` | (kiosk count, not a field) | — | Used to count kiosks per location, not a kiosk field |
| `Hotel's Number of Rooms` | `room_count` | locations | |
| `Hotel Star Rating` | `star_rating` | locations | |
| `Location Group` | `region_group` | kiosks | Or `hotel_group` on locations |
| `Hotel Address` | `address` | locations | |
| `Live Date` | `installation_date` | kiosks | Parse as timestamp |
| `Hotel Group` | `hotel_group` | locations | May be comma-separated — take first value |
| `Region` | `region_group` | kiosks | |
| `Status` (pipeline column) | `pipeline_stage_id` | kiosks | Auto-create stage if not found (D-04) |

**Location deduplication key:** Hotel name (Monday.com row name on the hotel/location rows, or `Hotel Address` if kiosk rows embed hotel names).

**How kiosks link to locations (D-03):** The Monday.com board appears to be kiosk-centric — each row is a kiosk, with hotel info in columns. Extract hotel name from the kiosk row, deduplicate hotels by name into the `locations` table, then create `kiosk_assignments` records linking each kiosk to its location.

---

## Common Pitfalls

### Pitfall 1: Cursor Expiry During Long Imports

**What goes wrong:** Monday.com cursors expire after 60 minutes (confirmed in API docs). If a large import pauses mid-loop (e.g., waiting for user confirmation), the cursor becomes invalid and the subsequent `next_items_page` fails.

**Why it happens:** Cursors are stateless tokens tied to the initial query result window.

**How to avoid:** Fetch ALL items from Monday.com in one complete cursor loop before doing any DB writes. Do not interleave user confirmation steps with the pagination loop.

**Warning signs:** API error "cursor not found" or similar invalid cursor error mid-import.

### Pitfall 2: MONDAY_API_TOKEN Not in .env.local

**What goes wrong:** `process.env.MONDAY_API_TOKEN` is undefined at runtime; all API calls fail with "MONDAY_API_TOKEN not set".

**Why it happens:** The token is in `.env.test` but `.env.local` only has `DATABASE_URL` and `BETTER_AUTH_URL`. Next.js loads `.env.local` at runtime; `.env.test` is loaded by `dotenv` in Python scripts only.

**How to avoid:** Plan 04-01 must add `MONDAY_API_TOKEN` to `.env.local`. Also add it to the `.env.example` or document it in the canonical refs. Server actions read from `process.env`, not from any `.env.test` file.

**Warning signs:** First API call in Plan 04-01 exploration throws an error about missing env var.

### Pitfall 3: Reference Project Does Not Paginate

**What goes wrong:** Copying `monday_api.py`'s `items_page(limit: 500)` pattern without adding `next_items_page` — silently drops all records beyond 500.

**Why it happens:** The reference project only handles ~28 rows from one board; pagination was never needed.

**How to avoid:** Always implement the `next_items_page` cursor loop. Test with a count check: total inserted should match total items on the board.

**Warning signs:** Import reports fewer records than expected; board shows 1,000+ but import only inserts ~500.

### Pitfall 4: Kiosk vs Location Row Ambiguity

**What goes wrong:** The Monday.com board may contain both kiosk rows AND group/section rows (e.g., hotel group headers). Treating every item as a kiosk inserts junk records.

**Why it happens:** Monday.com boards use item groups visually, but all items appear in `items_page` regardless of group.

**How to avoid:** In Plan 04-01 exploration, examine board group structure. Filter items by group title or by presence of kiosk-specific columns (e.g., non-null `Outlet Code`). Items missing the kiosk-identifying column should be skipped with a warning log entry.

**Warning signs:** Dry-run shows many "unmapped" records or records with near-empty field coverage.

### Pitfall 5: Status Column Values Require Type Fragment

**What goes wrong:** Querying `column_values { text }` for a Status column returns an empty string. The `text` field on `ColumnValue` is unreliable for Status columns.

**Why it happens:** Monday.com's typed column values API (2023-10+) moved status labels out of `text` and into the typed `StatusValue.label` field.

**How to avoid:** Use inline fragments in the GraphQL query:
```graphql
column_values {
  id
  type
  text
  ... on StatusValue { label }
  ... on DateValue { date }
  ... on DropdownValue { text }
}
```

**Warning signs:** All kiosks imported with null pipeline stage even though status columns are populated.

### Pitfall 6: Duplicate Unique Constraint Violation at DB Insert

**What goes wrong:** Drizzle insert throws a unique constraint violation on `kiosk_id` if a duplicate slips through the pre-check.

**Why it happens:** Race condition or coding error — checked for existence, then inserted, but another row with the same `kioskId` already exists.

**How to avoid:** Use Drizzle's `onConflictDoNothing()` as a safety net alongside the explicit duplicate check. Log skipped rows.

**Warning signs:** Import fails mid-run with a constraint violation error rather than gracefully skipping duplicates.

---

## Code Examples

### Board Column Discovery Query

```typescript
// Source: reference project monday_api.py + developer.monday.com docs
const BOARD_COLUMNS_QUERY = `
  query ($boardId: [ID!]) {
    boards(ids: $boardId) {
      id
      name
      columns {
        id
        title
        type
      }
    }
  }
`;
```

### Items Page with Typed Column Values

```typescript
// Source: developer.monday.com/api-reference/reference/column-values-v2
const ITEMS_PAGE_QUERY = `
  query ($boardId: [ID!], $limit: Int!) {
    boards(ids: $boardId) {
      items_page(limit: $limit) {
        cursor
        items {
          id
          name
          group { id title }
          column_values {
            id
            type
            text
            value
            ... on StatusValue { label }
            ... on DateValue { date }
            ... on MirrorValue { display_value }
          }
        }
      }
    }
  }
`;
```

### Drizzle Bulk Insert with Conflict Handling

```typescript
// Source: drizzle-orm docs — onConflictDoNothing for safe re-runs
import { db } from "@/db";
import { kiosks } from "@/db/schema";

await db.insert(kiosks)
  .values(kioskRows)
  .onConflictDoNothing(); // kiosk_id has .unique() constraint
```

### Location Deduplication Pattern

```typescript
// Collect unique hotel names across all kiosk items
const uniqueHotels = new Map<string, Partial<Location>>();
for (const item of allItems) {
  const hotelName = extractHotelName(item);
  if (hotelName && !uniqueHotels.has(hotelName)) {
    uniqueHotels.set(hotelName, buildLocationRecord(item));
  }
}
// Insert locations first, collect IDs
const locationIdMap = new Map<string, string>(); // hotel name → DB uuid
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `column_values { text value }` only | Typed fragments `... on StatusValue { label }` | 2023-10 API version | Status text is empty without fragment |
| Offset pagination (`page: N`) | Cursor pagination (`next_items_page`) | 2022+ | Offset unavailable; cursor is the only option |
| `items_page` max 100 | `items_page` max 500 (API 2024-01) | 2024-01 release | Fewer pages needed for 1,000 records |

---

## Open Questions

1. **Actual board ID for kiosk data**
   - What we know: Reference project uses `1356570756` (Live board) for hotel/SSM data
   - What's unclear: This is the Live board — is this also the board containing the kiosk records to migrate?
   - Recommendation: Plan 04-01 exploration step — call boards query with token, list all boards, confirm the correct board ID, add to `MONDAY_BOARD_ID` env var

2. **Is one Monday.com row = one kiosk?**
   - What we know: Reference project treats rows as hotels; kiosk count is a column
   - What's unclear: Phase 4 context says "kiosk data" — the board structure may be hotel-centric (each row = hotel) with a kiosk count column, not kiosk-centric (each row = one kiosk)
   - Recommendation: Plan 04-01 must verify row semantics before field mapping can be finalized; the answer changes whether we insert 1 kiosk per row or N kiosks per row

3. **Actual Monday.com column IDs vs. column titles**
   - What we know: Column titles change in Monday.com UI; column IDs are stable
   - What's unclear: The migration should use column IDs internally but display titles for the admin mapping review UI
   - Recommendation: Board columns query returns both `id` and `title` — use `id` for mapping logic, `title` for display

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `MONDAY_API_TOKEN` env var | All API calls | Partial — in `.env.test` only | — | Move to `.env.local` in Plan 04-01 |
| Monday.com API (https://api.monday.com/v2) | All data fetch | ✓ (token validated in reference project) | API 2024-01 | — |
| Supabase / PostgreSQL | DB writes | ✓ | Running (Phase 1-3 verified) | — |
| Node.js `fetch` | HTTP client | ✓ | Next.js 16 / Node 18+ | — |

**Action required before Plan 04-01:**
- Add `MONDAY_API_TOKEN=<value from .env.test>` to `.env.local` — without this, all server actions will fail with a missing env var error at runtime.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Playwright 1.58.2 |
| Config file | `playwright.config.ts` (root) |
| Quick run command | `npx playwright test tests/admin/` |
| Full suite command | `npx playwright test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MIGR-01 | Settings page shows Data Import card for admin | E2E (Playwright) | `npx playwright test tests/admin/data-import.spec.ts` | Wave 0 |
| MIGR-01 | Data Import page renders field mapping table | E2E (Playwright) | `npx playwright test tests/admin/data-import.spec.ts` | Wave 0 |
| MIGR-02 | Dry-run returns preview with mapped/warning counts | E2E (Playwright) | `npx playwright test tests/admin/data-import.spec.ts` | Wave 0 |
| MIGR-03 | Pagination: all items fetched across multiple pages | Unit/integration (mock) | Manual verification in Plan 04-01 | No test possible — external API |
| MIGR-03 | Rate limit retry does not crash import | Unit/integration (mock) | Manual verification in Plan 04-02 | No test possible without mock infra |

**Note on external API testing:** The Monday.com API cannot be mocked in Playwright E2E tests without a proxy layer. Tests should verify the UI states (loading, preview table rendered, progress bar visible, completion summary shown) using a seeded or stubbed server action response — not a live Monday.com call. Live API integration is validated manually during Plan 04-01 exploration.

### Sampling Rate

- **Per task commit:** `npx playwright test tests/admin/data-import.spec.ts`
- **Per wave merge:** `npx playwright test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/admin/data-import.spec.ts` — covers MIGR-01, MIGR-02 UI flow
- [ ] Settings page "Data Import" card navigation test
- [ ] Dry-run preview table renders with mock data
- [ ] Import progress bar visible during active import

---

## Sources

### Primary (HIGH confidence)

- `/Users/vedant/Work/WeKnowGroup/reporting-automation/src/monday_api.py` — field mapping, column parsing, auth pattern
- `/Users/vedant/Work/WeKnowGroup/reporting-automation/src/monday_config.py` — MONDAY_FIELD_MAPPING, board IDs
- `https://developer.monday.com/api-reference/docs/rate-limits` — rate limits, retry_in_seconds, minute/daily caps
- `https://developer.monday.com/api-reference/docs/querying-board-items` — cursor pagination, next_items_page pattern
- `https://developer.monday.com/api-reference/reference/column-values-v2` — typed column fragments (StatusValue, DateValue)
- `src/db/schema.ts` — target table columns, types, and constraints
- `src/app/(app)/settings/page.tsx` — Settings card pattern for Data Import card
- `src/app/(app)/settings/users/actions.ts` — server action pattern

### Secondary (MEDIUM confidence)

- Monday.com community forum on items_page limit (500 in 2024-01 API)
- Monday.com community forum on cursor expiry (60 minutes confirmed)

### Tertiary (LOW confidence)

- None

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all tools already in package.json; no new dependencies needed
- Field mapping: MEDIUM — column names from reference project are hypotheses until Plan 04-01 confirms against actual board
- Architecture (pagination, polling, server actions): HIGH — verified against official docs and existing project patterns
- Pitfalls: HIGH — most are derived from official docs or direct inspection of the reference codebase

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (Monday.com API is stable; rate limits and pagination behavior unlikely to change)
