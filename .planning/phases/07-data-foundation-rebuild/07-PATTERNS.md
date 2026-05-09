# Phase 7: Data Foundation Rebuild - Pattern Map

**Mapped:** 2026-05-04
**Files analyzed:** 18 new/modified files
**Analogs found:** 15 / 18

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/(app)/locations/merge-action.ts` | server-action | request-response | `src/app/(app)/settings/data-import/monday/actions.ts` | role-match (advisory lock + error envelope) |
| `src/lib/location-merge.ts` | service | CRUD (N→1 batch-write + transaction) | `src/lib/multi-pos-merge.ts` | exact |
| `src/db/schema.ts` (location_merge_snapshots table) | model/migration | CRUD | existing `src/db/schema.ts` tables | self-analog |
| `src/db/schema.ts` (normalised_name + partial index) | model/migration | CRUD | existing `src/db/schema.ts` tables | self-analog |
| `src/app/(app)/locations/undo-merge-action.ts` | server-action | request-response | `src/app/(app)/settings/data-import/monday/actions.ts` | role-match |
| `src/app/(app)/locations/merge-dialog.tsx` (extend) | component | request-response | `src/components/ui/merge-dialog.tsx` | exact |
| `src/app/(app)/locations/bulk-toolbar.tsx` (extend) | component | event-driven | `src/components/ui/bulk-toolbar.tsx` | exact |
| `src/app/(app)/locations/page.tsx` (same-name banner) | component | request-response | `src/app/(app)/locations/page.tsx` | self-analog |
| `src/app/(app)/admin/health/page.tsx` (same-name row) | component | request-response | `src/app/(app)/admin/health/page.tsx` | self-analog |
| `src/lib/monday/import-hotel-locations.ts` | service | request-response (cursor paged) | `src/lib/monday/import-location-products.ts` | exact |
| `src/app/(app)/settings/data-import/monday/actions.ts` (extend) | server-action | request-response | `src/app/(app)/settings/data-import/monday/actions.ts` | self-analog |
| `scripts/v2-reset.ts` (orchestrator) | utility/script | batch | `scripts/backfill-kiosk-install-dates.ts` | role-match |
| `scripts/v2-preflight.ts` | utility/script | batch | `scripts/backfill-kiosk-install-dates.ts` | role-match |
| `scripts/v2-wipe-and-reseed.ts` | utility/script | batch | `scripts/backfill-kiosk-install-dates.ts` | role-match |
| `scripts/verify-data-reset.ts` | utility/script | batch | `scripts/backfill-kiosk-install-dates.ts` | role-match |
| `tests/locations/merge.spec.ts` | test | request-response | no existing test in `tests/locations/` | no analog |
| `tests/locations/sentinel-triage.spec.ts` | test | request-response | no existing test in `tests/locations/` | no analog |
| `tests/data-reset/verify.spec.ts` | test | batch | no existing test in `tests/data-reset/` | no analog |

---

## Pattern Assignments

### `src/lib/location-merge.ts` (service, CRUD transaction)

**Analog:** `src/lib/multi-pos-merge.ts` (REPLACE — lift logic into this new file)

**Imports pattern** (multi-pos-merge.ts lines 1-19):
```typescript
import { sql, inArray, and } from "drizzle-orm";
import {
  locations,
  kioskAssignments,
  salesRecords,
  locationProducts,
  locationRegionMemberships,
  locationGroupMemberships,
  locationHotelGroupMemberships,
  locationFlags,
  actionItems,
} from "@/db/schema";
import { writeAuditLog } from "@/lib/audit";
import { db as defaultDb } from "@/db/client";
```

**Type definitions pattern** (multi-pos-merge.ts lines 20-40):
```typescript
export type MergePair = { canonicalId: string; defunctId: string };
export type MergeActor = { id: string; name: string };
export type BulkMergeResult = {
  pairsMerged: number;
  salesRecordsRewritten: number;
  kioskAssignmentsRewritten: number;
  locationProductsRewritten: number;
  locationRegionMembershipsRewritten: number;
  locationGroupMembershipsRewritten: number;
  locationHotelGroupMembershipsRewritten: number;
  locationFlagsRewritten: number;
  actionItemsRewritten: number;
  locationsArchived: number;
  auditEntriesWritten: number;
  durationMs: number;
};
export type MergeDb = any; // loose — works with both pg and postgres-js
```

NOTE: Phase 7 changes the signature from N pairs to N→1: instead of `pairs: MergePair[]`, use `canonicalId: string; defunctIds: string[]`. Build the pairs internally: `defunctIds.map(id => ({ canonicalId, defunctId: id }))`.

**Core transaction pattern** (multi-pos-merge.ts lines 129-507):
```typescript
export async function applyBulkMerge(
  pairs: MergePair[],
  actor: MergeActor,
  db: MergeDb,
): Promise<BulkMergeResult> {
  const t0 = Date.now();
  const result: BulkMergeResult = { pairsMerged: 0, /* ... zero-init all counters */ };

  await db.transaction(async (tx: MergeDb) => {
    for (const { canonicalId, defunctId } of pairs) {
      // Step 1-4: collision pre-deletion for join tables (location_region_memberships,
      //   location_group_memberships, location_hotel_group_memberships, location_flags)
      //   Pattern: DELETE WHERE defunctId AND canonicalId already has same FK
      await tx.delete(locationRegionMemberships).where(
        and(
          eq(locationRegionMemberships.locationId, defunctId),
          inArray(
            locationRegionMemberships.regionId,
            tx.select({ id: locationRegionMemberships.regionId })
              .from(locationRegionMemberships)
              .where(eq(locationRegionMemberships.locationId, canonicalId)),
          ),
        ),
      );

      // Step 5: UPDATE all 9 FK tables
      const srSeller = await tx.update(salesRecords)
        .set({ sellerLocationId: canonicalId })
        .where(eq(salesRecords.sellerLocationId, defunctId));
      // ... repeat for each FK column ...

      // Step 6: Archive defunct
      await tx.update(locations)
        .set({ archivedAt: sql`NOW()` })
        .where(and(eq(locations.id, defunctId), isNull(locations.archivedAt)));

      // Step 7: Per-table audit entries (inside tx)
      await writeAuditLog({ action: "update", field: "sales_records.seller_location_id",
        metadata: { table: "sales_records", oldLocationId: defunctId, newLocationId: canonicalId,
          rowsRewritten: rowCount(srSeller) } }, tx);

      // Step 8: Pair-level merge audit entry
      await writeAuditLog({
        action: "merge", field: "mergedInto", newValue: canonicalId,
        entityId: defunctId, entityType: "location",
        actorId: actor.id, actorName: actor.name,
      }, tx);

      result.pairsMerged++;
    }
  });

  result.durationMs = Date.now() - t0;
  return result;
}
```

**Snapshot-before-commit addition** (D-03 — new, inside the same transaction before FK rewrites):
```typescript
// Capture pre-merge state of all affected rows into location_merge_snapshots
// keyed by the merge's audit_log.id (insert audit entry first, capture its id)
const auditId = await insertMergeAuditEntry(tx, { canonicalId, defunctIds, actor });
const payload = await capturePreMergeSnapshot(tx, { canonicalId, defunctIds });
await tx.insert(locationMergeSnapshots).values({
  auditLogId: auditId,
  payload, // JSONB — full rows from locations, kiosk_assignments, salesRecords FK cols
  createdAt: sql`NOW()`,
});
// then proceed with FK rewrites...
```

**rowCount helper** (multi-pos-merge.ts lines 520-529):
```typescript
function rowCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === "object") {
    if ("rowCount" in result && typeof (result as { rowCount: unknown }).rowCount === "number")
      return (result as { rowCount: number }).rowCount;
    if ("count" in result && typeof (result as { count: unknown }).count === "number")
      return (result as { count: number }).count;
  }
  return 0;
}
```

---

### `src/app/(app)/locations/merge-action.ts` (server-action, request-response)

**Analog:** `src/app/(app)/settings/data-import/monday/actions.ts` (advisory lock + error envelope)
**Also reference:** `src/lib/merge.ts` (auth pattern + error envelope shape)

**Full action shape** (actions.ts lines 1-91 + merge.ts lines 1-50):
```typescript
"use server";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { sql } from "drizzle-orm";
import { applyBulkMerge } from "@/lib/location-merge";
import { writeAuditLog } from "@/lib/audit";
import { revalidateTag } from "next/cache";

// New LOCK_KEY — must be distinct from existing keys:
//   738294105 = Azure ETL, 738294106 = Monday import
const LOCK_KEY = 738294108; // location merge UI

export type MergeLocationsResult =
  | { success: true; merged: number }
  | { error: string }
  | { status: "lock_contention" };

export async function mergeLocationsAction(
  canonicalId: string,
  defunctIds: string[],
): Promise<MergeLocationsResult> {
  // Auth gate — copy from merge.ts lines 15-17
  const session = await requireRole("admin");

  // Advisory lock — copy from actions.ts lines 42-50
  const lockResult = await db.execute(sql`SELECT pg_try_advisory_lock(${LOCK_KEY})::boolean AS lock`);
  const lockRows = lockResult && "rows" in lockResult
    ? (lockResult as { rows: Array<{ lock: boolean }> }).rows
    : (lockResult as unknown as Array<{ lock: boolean }>);
  const acquired = lockRows[0]?.lock === true;
  if (!acquired) return { status: "lock_contention" };

  try {
    const actor = { id: session.user.id, name: session.user.name ?? session.user.email };
    const pairs = defunctIds.map(id => ({ canonicalId, defunctId: id }));
    const result = await applyBulkMerge(pairs, actor, db);
    revalidateTag("locations");
    return { success: true, merged: result.pairsMerged };
  } catch (err) {
    // Error envelope — copy from merge.ts lines 46-48
    return { error: err instanceof Error ? err.message : "Failed to merge locations" };
  } finally {
    try { await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`); } catch { /* ignore */ }
  }
}
```

**Lock key registry** (to avoid collisions — extracted from actions.ts):
```
738294105  →  Azure ETL (existing)
738294106  →  Monday import (existing)
738294107  →  wipe runbook (new, Plan B)
738294108  →  location merge UI (new, Plan C)
```

---

### `src/app/(app)/locations/undo-merge-action.ts` (server-action, request-response)

**Analog:** `src/app/(app)/settings/data-import/monday/actions.ts` (same wrapper shape)
**Also reference:** `src/lib/merge.ts` (error envelope)

**Shape** (no existing undo action — net-new; follow advisory lock + requireRole + error envelope pattern):
```typescript
"use server";
import { requireRole } from "@/lib/auth";
import { db } from "@/db/client";
import { locationMergeSnapshots, auditLog } from "@/db/schema";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";
import { revalidateTag } from "next/cache";

export type UndoMergeResult =
  | { success: true }
  | { error: string }
  | { status: "locked"; reason: string };

export async function undoMergeAction(mergeAuditLogId: string): Promise<UndoMergeResult> {
  const session = await requireRole("admin");
  try {
    // 1. Fetch snapshot keyed by audit_log.id
    // 2. Check lock condition: any kiosk_assignment in snapshot mutated post-merge?
    //    If yes → return { status: "locked", reason: "kiosk_assignment N modified at <ts> after merge" }
    // 3. Replay snapshot in reverse inside single transaction
    // 4. Write paired audit entry citing original mergeAuditLogId
    // 5. revalidateTag("locations")
    return { success: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to undo merge" };
  }
}
```

---

### `src/db/schema.ts` — `location_merge_snapshots` table (model, CRUD)

**Analog:** existing tables in `src/db/schema.ts` (self-analog — copy column declaration style)

**Table declaration pattern** (follow existing Drizzle pgTable style in schema.ts):
```typescript
export const locationMergeSnapshots = pgTable("location_merge_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  auditLogId: uuid("audit_log_id").notNull().references(() => auditLog.id),
  // JSONB payload: pre-merge rows from locations, kiosk_assignments, salesRecords FK cols
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

**Discretion note:** Planner chooses JSONB vs typed columns. JSONB is simpler; recommend JSONB for v1 of snapshot since the full row shape may vary as schema evolves.

---

### `src/db/schema.ts` — `normalised_name` column + partial unique index (model/migration)

**Analog:** self-analog; follow Drizzle column + index declaration style in schema.ts

**Column and index pattern:**
```typescript
// In the locations table definition:
normalisedName: text("normalised_name"),

// After the table, declare the partial unique index:
export const locationsNormalisedNameUniqueIdx = uniqueIndex(
  "locations_normalised_name_unique_active"
).on(locations.normalisedName).where(sql`archived_at IS NULL`);
```

**Populate on insert/update:** normalise = `name.trim().toLowerCase().replace(/\s+/g, " ")` (or equivalent server-side). Drizzle does not support expression columns natively; populate in the insert/update code path.

---

### `src/lib/monday/import-hotel-locations.ts` (service, request-response cursor-paged)

**Analog:** `src/lib/monday/import-location-products.ts` (exact structural match)

**Imports pattern** (import-location-products.ts lines 1-15):
```typescript
import { sql } from "drizzle-orm";
import { db as defaultDb } from "@/db/client";
import { locations, locationRegionMemberships } from "@/db/schema";
import { mondayFetch } from "@/lib/monday/client";
```

**Deps injection pattern** (import-location-products.ts lines 30-35):
```typescript
export type HotelLocationImportDeps = {
  mondayApiToken: string;
  db: typeof defaultDb;
  logger?: (phase: string, msg: string) => void;
};

const noopLogger = (_phase: string, _msg: string) => {};

export async function runHotelLocationImport(
  deps: HotelLocationImportDeps,
): Promise<HotelLocationImportResult> {
  const { mondayApiToken, db, logger = noopLogger } = deps;
```

**Board IDs constant** (import-location-products.ts lines 38-40 — same 4 hotel boards):
```typescript
const HOTEL_BOARD_IDS = [1356570756, 1743012104, 5026387784, 5092887865];
const BOARD_REGION: Record<number, string> = { 5092887865: "AU" };
```

**Cursor pagination pattern** (import-location-products.ts lines 151-190):
```typescript
for (const boardId of HOTEL_BOARD_IDS) {
  let cursor: string | null = null;
  while (true) {
    const query = cursor
      ? `{ next_items_page(limit: 100, cursor: "${cursor}") { cursor items { id name column_values { id text value } } } }`
      : `{ boards(ids:[${boardId}]) { items_page(limit: 100) { cursor items { id name column_values { id text value } } } } }`;
    const data = await mondayFetch(mondayApiToken, query);
    const page = cursor ? data.next_items_page : data.boards[0].items_page;
    // process page.items ...
    if (!page.cursor || page.items.length === 0) break;
    cursor = page.cursor;
  }
}
```

**Upsert pattern** (import-location-products.ts lines 330-335):
```typescript
await db.insert(locations).values({ ...locationRow })
  .onConflictDoNothing({ target: [locations.mondayId] })
  .returning({ id: locations.id });
```

**Batch insert with retry** (import-location-products.ts lines 530-558):
```typescript
const BATCH_SIZE = 20;
for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
  const batch = allRows.slice(i, i + BATCH_SIZE);
  let attempt = 0;
  while (attempt < 3) {
    try {
      await db.insert(targetTable).values(batch).onConflictDoNothing();
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if ((msg.includes("ECONNRESET") || msg.includes("ETIMEDOUT")) && attempt < 2) {
        attempt++;
        await new Promise(r => setTimeout(r, 500 * attempt));
      } else throw err;
    }
  }
}
```

**Result type** (import-location-products.ts lines 20-28):
```typescript
export type HotelLocationImportResult = {
  locationsUpserted: number;
  locationsSkipped: number;
  sentinelEnsured: boolean;
  durationMs: number;
};
```

---

### `scripts/v2-reset.ts` + `scripts/v2-preflight.ts` + `scripts/v2-wipe-and-reseed.ts` (utility/script, batch)

**Analog:** `scripts/backfill-kiosk-install-dates.ts`

**Imports + dry-run flag pattern** (backfill-kiosk-install-dates.ts lines 1-20):
```typescript
import { Pool, PoolClient } from "pg";
import { writeAuditLog } from "@/lib/audit";

const APPLY = process.argv.includes("--apply");
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
```

**pg Pool pattern — required for SET LOCAL session variables** (backfill-kiosk-install-dates.ts lines 25-50):
```typescript
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const pool = new Pool({ connectionString: url });
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL only visible within this transaction:
    await client.query(`SET LOCAL app.allow_assigned_at_mutation = 'on'`);
    // ... work ...
    if (APPLY) {
      await client.query("COMMIT");
      console.log("Applied.");
    } else {
      await client.query("ROLLBACK");
      console.log("Dry-run — no changes committed.");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
```

**Advisory lock pattern for wipe runbook** (adapted from actions.ts lines 42-50):
```typescript
// Wipe lock key — distinct from UI and ETL locks
const LOCK_KEY = 738294107;
const lockResult = await client.query(
  `SELECT pg_try_advisory_lock($1)::boolean AS lock`, [LOCK_KEY]
);
if (!lockResult.rows[0]?.lock) {
  console.error("Another wipe/import process holds the lock — aborting.");
  process.exit(1);
}
try {
  // ... runbook steps ...
} finally {
  await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]);
}
```

NOTE: Wipe runbook MUST use `pg` Pool (not Drizzle) because `SET LOCAL app.allow_assigned_at_mutation = 'on'` must be issued in the same connection as the transaction for the trigger bypass to work (Phase 5.3 immutability trigger).

---

### `scripts/verify-data-reset.ts` (utility/script, batch)

**Analog:** `scripts/backfill-kiosk-install-dates.ts` (dry-run-only shape — no `--apply` flag needed)

**Output pattern** (D-12/D-13 — structured JSON + human-readable Markdown):
```typescript
const APPLY = false; // verify script is always read-only

interface InvariantResult {
  name: string;
  status: "pass" | "fail" | "warn";
  expected?: number | string;
  actual?: number | string;
  detail?: string;
}

const results: InvariantResult[] = [];

// Example invariant check:
const kioskCount = (await client.query(`SELECT COUNT(*) FROM kiosks WHERE archived_at IS NULL`)).rows[0].count;
results.push({
  name: "kiosk count vs golden snapshot",
  status: Number(kioskCount) === GOLDEN_KIOSK_COUNT ? "pass" : "fail",
  expected: GOLDEN_KIOSK_COUNT,
  actual: Number(kioskCount),
});

// Emit JSON
process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
// Emit Markdown to stderr (Claude reads both)
process.stderr.write(renderMarkdownReport(results));
```

**Minimum invariants** (D-13 — planner MUST expand):
- kiosk count vs golden snapshot
- location count (active, archived)
- sales row count + total-revenue invariant
- no orphan `kiosk_assignments` (every assignment → live kiosk + live location)
- no active same-name groups (`normalised_name` dupes among `archived_at IS NULL`)
- `LOCATION_NEEDED` sentinel exists + sentinel orphan count (warn, not fail)
- two-pass `assigned_at` coverage (NULL count before vs after)
- audit_log integrity: entries cite `ETL_SYSTEM_USER_ID` for runbook steps

---

### `src/app/(app)/locations/page.tsx` — same-name banner (component, request-response)

**Analog:** self-analog (existing page.tsx)

**Banner pattern** (D-08 — yellow banner at top of locations list):
```tsx
// Server component — query duplicates on render
const sameNameGroups = await db
  .select({ normalisedName: locations.normalisedName, count: sql<number>`COUNT(*)` })
  .from(locations)
  .where(isNull(locations.archivedAt))
  .groupBy(locations.normalisedName)
  .having(sql`COUNT(*) > 1`);

const dupeCount = sameNameGroups.length;

// Render banner:
{dupeCount > 0 && (
  <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-4 flex items-center gap-2">
    <span className="text-yellow-800 text-sm font-medium">
      {dupeCount} same-name group{dupeCount > 1 ? "s" : ""} detected — review and merge
    </span>
    <a href="/locations?filter=dupes" className="text-yellow-700 underline text-sm">View groups</a>
  </div>
)}
```

---

### `src/app/(app)/admin/health/page.tsx` — same-name status row (component, request-response)

**Analog:** self-analog (existing health page)

**Status row pattern** (D-08 — follow existing health check row shape):
```tsx
// Same query as locations banner, surfaced as a health row:
{
  label: "Same-name location groups",
  value: dupeCount === 0 ? "None" : `${dupeCount} group(s)`,
  status: dupeCount === 0 ? "ok" : "warn",
}
```

---

### `src/app/(app)/settings/data-import/monday/actions.ts` — extend with hotel-location importer trigger (server-action)

**Analog:** self-analog (existing file, extend with new exported action)

**New action shape** (follow triggerMondayImportAction pattern exactly — lines 1-91 of existing file):
```typescript
// New distinct lock key for hotel location import:
const HOTEL_LOCATION_LOCK_KEY = 738294109;

export type HotelLocationImportActionResult =
  | { status: "success"; result: HotelLocationImportResult }
  | { status: "lock_contention" }
  | { status: "missing_token" }
  | { status: "error"; message: string };

export async function triggerHotelLocationImportAction(): Promise<HotelLocationImportActionResult> {
  // Identical advisory lock + requireRole("admin") + try/catch/finally shape as triggerMondayImportAction
  // Replace runMondayImport → runHotelLocationImport({ mondayApiToken, db })
}
```

---

## Shared Patterns

### Authentication Gate
**Source:** `src/lib/merge.ts` (lines 15-17) + `src/app/(app)/settings/data-import/monday/actions.ts` (line 20)
**Apply to:** ALL server actions in Phase 7 (merge-action.ts, undo-merge-action.ts, hotel-location import action)
```typescript
const session = await requireRole("admin");
// session.user.id and session.user.name available for actor attribution
```

### Advisory Lock Wrapper
**Source:** `src/app/(app)/settings/data-import/monday/actions.ts` (lines 42-55)
**Apply to:** merge-action.ts, undo-merge-action.ts, wipe runbook scripts, hotel-location import action
```typescript
const lockResult = await db.execute(sql`SELECT pg_try_advisory_lock(${LOCK_KEY})::boolean AS lock`);
const lockRows = lockResult && "rows" in lockResult
  ? (lockResult as { rows: Array<{ lock: boolean }> }).rows
  : (lockResult as unknown as Array<{ lock: boolean }>);
const acquired = lockRows[0]?.lock === true;
if (!acquired) return { status: "lock_contention" };
// ... work ...
// in finally:
try { await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`); } catch { /* ignore */ }
```

**Lock key registry** (never reuse a key):
```
738294105  →  Azure ETL          (existing — do not touch)
738294106  →  Monday import       (existing — do not touch)
738294107  →  Wipe runbook        (new, Plan B)
738294108  →  Location merge UI   (new, Plan C)
738294109  →  Hotel location import action (new, Plan B/C)
```

### Error Envelope
**Source:** `src/lib/merge.ts` (lines 44-50)
**Apply to:** All server actions
```typescript
// Success path:
return { success: true, merged: N };
// or for process-stateful actions:
return { status: "success", result: importResult };

// Error path (always catch-wrapped):
return { error: err instanceof Error ? err.message : "Failed to <action>" };
// or:
return { status: "error", message: err instanceof Error ? err.message : "Unknown error" };
```

### Audit Log Entry
**Source:** `src/lib/audit.ts` (called throughout multi-pos-merge.ts)
**Apply to:** All destructive server actions and runbook scripts
```typescript
await writeAuditLog({
  action: "merge",          // or "update", "archive", "undo_merge", "wipe", "reseed"
  field: "mergedInto",
  entityId: defunctId,
  entityType: "location",
  newValue: canonicalId,
  actorId: actor.id,        // session.user.id for UI; ETL_SYSTEM_USER_ID for scripts
  actorName: actor.name,
  metadata: { /* operation-specific counts, table names, etc. */ },
}, tx);                      // pass tx to write inside transaction; omit for script-level entries
```

**Script actor constant:**
```typescript
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";
```

### Drizzle Transaction Shape
**Source:** `src/lib/multi-pos-merge.ts` (lines 129-507)
**Apply to:** location-merge.ts, undo-merge-action.ts (inner logic)
```typescript
await db.transaction(async (tx) => {
  // All reads and writes inside tx — snapshot capture + FK rewrites + audit entries
  // tx is typed as MergeDb (any) to work with both pg and postgres-js adapters
});
```

### Cache Invalidation
**Source:** `src/app/(app)/settings/data-import/monday/actions.ts` (line 65)
**Apply to:** All server actions that mutate locations, kiosk_assignments, or sales data
```typescript
revalidateTag("locations");
// Also revalidate analytics if sales data changes:
revalidateTag("analytics", "max");
```

### pg Pool + SET LOCAL (runbook scripts only)
**Source:** `scripts/backfill-kiosk-install-dates.ts` (lines 25-50)
**Apply to:** v2-wipe-and-reseed.ts (the only Phase 7 script that needs the trigger bypass)
```typescript
// MUST use pg Pool, not Drizzle, to issue SET LOCAL in the same connection:
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
await client.query("BEGIN");
await client.query(`SET LOCAL app.allow_assigned_at_mutation = 'on'`);
// ... backfill assigned_at ...
await client.query("COMMIT");
client.release();
await pool.end();
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `tests/locations/merge.spec.ts` | test | request-response | No existing E2E tests in `tests/locations/` — Playwright spec is net-new |
| `tests/locations/sentinel-triage.spec.ts` | test | request-response | No existing E2E tests in `tests/locations/` — Playwright spec is net-new |
| `tests/data-reset/verify.spec.ts` | test | batch | No existing tests in `tests/data-reset/` — Playwright spec is net-new |

**Planner guidance for net-new tests:** Follow the Playwright config pattern in `playwright.config.ts` (workers: 1, serial, screenshot on failure, `PLAYWRIGHT_BASE_URL` env var skips webServer). Auth via `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` env vars (see existing test fixtures if any exist). Locate auth login fixture at `tests/` root if shared.

---

## Metadata

**Analog search scope:** `src/lib/`, `src/app/(app)/locations/`, `src/app/(app)/settings/data-import/monday/`, `src/app/(app)/admin/health/`, `scripts/`, `src/db/`
**Files scanned:** 8 analog files fully read
**Pattern extraction date:** 2026-05-04

**Critical implementation notes for planner:**
1. `merge-action.ts` REPLACES the current thin 12-line file — the new file has auth, advisory lock, N→1 pairs, snapshot trigger, and proper error envelope.
2. `src/lib/location-merge.ts` is a NEW file — `src/lib/merge.ts` remains but is superseded for the location merge flow (can be archived/deleted after Plan C ships).
3. The hotel location importer (`runHotelLocationImport`) is entirely net-new — no analog function exists. `import-location-products.ts` provides the structural/deps pattern only.
4. Wipe runbook MUST use `pg` Pool (not Drizzle) for the `SET LOCAL` trigger bypass. Drizzle does not expose the raw connection needed for session-variable isolation.
5. Lock key 738294107 is reserved for the wipe runbook — do not assign to any other process.
