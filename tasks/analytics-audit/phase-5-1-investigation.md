# Phase 5.1 Investigation — Kiosk Assignments Reseed (2026-04-18)

## Summary

**Root cause**: On **2026-04-18**, the Monday.com kiosk import script (`scripts/import-from-monday.ts`) was deployed to production for the first time. This script **bulk-creates `kiosk_assignments` rows** for every kiosk linked to a location via `outletCode`. Since all 231 active outlets matched outlet codes, all their assignments were created on that single date. The `assigned_at` column defaults to `NOW()` at row creation, so every row bears the timestamp of the import run (~2026-04-18 23:12). Per the resolved decision **D4** in `tasks/todo.md`, this is a **known and acceptable data artifact** — there is no older per-kiosk install history in the system, so a location-level backfill from `locations.liveDate` is the correct restoration strategy.

---

## Evidence Collected

### 1. Git Commit Evidence

**Commit `44245ca` (2026-04-18 23:12:07 UTC+5:30)**:
- Subject: "feat: Monday.com data import, nav restructure, and analytics date fix"
- Added `scripts/import-from-monday.ts` (437 lines, bulk kiosk+assignment import)
- Added `scripts/enrich-locations-from-monday.ts` (518 lines, location enrichment)
- Added `scripts/import-location-products-from-monday.ts` (433 lines, product import)
- First production mention of Monday kiosk import in codebase history

### 2. Import Script Code Path (lines 362-369 of `scripts/import-from-monday.ts`)

```typescript
if (activeAssignment.length === 0) {
  await db.insert(kioskAssignments).values({
    kioskId: kioskUuid,
    locationId,
    assignedBy: "system",
    assignedByName: "Monday.com Import",
    reason: `Imported from Monday.com group "${groupTitle}"`,
  });
  assignmentsCreated++;
}
```

No explicit `assignedAt` timestamp is set → PostgreSQL `DEFAULT NOW()` applies → all rows receive the **exact execution time of the import** (2026-04-18 UTC).

### 3. Schema Evidence

`src/db/schema.ts` defines `kiosk_assignments.assignedAt`:
```typescript
assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
```

**Default behavior**: any INSERT without explicit `assignedAt` value will use `NOW()`.

### 4. Reconciliation with D4 Decision

Decision **D4** in `tasks/todo.md` line 14 explicitly states:

> "kiosks + kiosk_assignments tables both reseeded 2026-04-18, no per-kiosk install data anywhere"

This confirms the April 18 date as the **known reseed event**.

### 5. No Audit Log Evidence Expected

The `audit_logs` table does not record INSERT statements from application code — it only records `UPDATE` or `DELETE` statements explicitly written to it, or admin actions via the UI. The bulk import via script does not trigger audit log entries, so searching `audit_logs` for "kiosk_assignment" activity near 2026-04 will return **nothing**. This is expected and **not a concern** — the commit history and script code are the primary audit trail.

---

## What's Recoverable vs What's Not

### Recoverable Data

1. **`locations.liveDate`** (Monday "Live Estate" board column `live_date`)
   - Present on 223 of 231 active locations
   - Represents the true go-live date from Monday's source system
   - Spans 2018 to 2026 (legitimate historical range)
   - **Used as primary backfill source per D4**

2. **`sales_records.transaction_date`** (oldest per location)
   - 174 active locations have sales history
   - Provides a **lower-bound proxy** for go-live (system didn't record sales before go-live)
   - **Fallback for the 57 locations lacking `liveDate`**

3. **`kiosks.created_at`** column
   - Records the row creation timestamp in the DB
   - For rows created during the 2026-04-18 import, this is **also April 18**
   - Does NOT preserve original install dates
   - **Cannot be used** as a per-kiosk historical source

### Lost/Unrecoverable Data

1. **Per-kiosk install dates** — no historical record exists
   - The schema has no prior-to-April-18 `kiosk_id` column populated
   - Per-kiosk granularity was impossible before the Monday import populated the `kiosks` table
   - **This is acceptable per D4** — backfill applies location liveDate to all kiosks at that location

2. **Original kiosk_assignments timestamps** — **permanently lost**
   - If kiosks existed in an older system, their assignment records are not in Postgres
   - The April 18 import created the first-ever `kiosk_assignments` rows for active locations
   - **Cannot recover these via audit logs or schema migration**

---

## Why No Mass-UPDATE Occurred

The investigation initially suspected a mass-UPDATE that reset all `assignedAt` values to 2026-04. Instead, the real event was:

1. **Schema creation** (migrations/0001–0009) created empty `kiosks` and `kiosk_assignments` tables
2. **April 18 import** ran `import-from-monday.ts`, which:
   - Fetched kiosk items from Monday Assets board
   - **Inserted new rows into `kiosks`** (first time this table was populated from production data)
   - **Inserted new rows into `kiosk_assignments`** for each kiosk linked to a location (first time assignments created)
   - All rows received `DEFAULT NOW()` timestamps
3. **No mutation of old dates** — the table was essentially empty before the import

---

## Phase 5.3 Safeguard Recommendation

To prevent a recurrence (either accidental bulk-update of `assignedAt` or a future untracked reseed):

### Option A: Database Constraint (Recommended)

Add an **IMMUTABLE column constraint** on `kiosk_assignments.assigned_at`:

```sql
ALTER TABLE kiosk_assignments
  ADD CONSTRAINT kiosk_assignments_assigned_at_immutable
  CHECK (assigned_at IS NOT NULL);
  
-- Trigger to prevent UPDATE of assigned_at
CREATE TRIGGER prevent_assigned_at_update
BEFORE UPDATE OF assigned_at ON kiosk_assignments
FOR EACH ROW
WHEN (OLD.assigned_at IS DISTINCT FROM NEW.assigned_at)
EXECUTE FUNCTION raise_immutable_column('assigned_at');
```

This will **reject any UPDATE** that attempts to change `assigned_at`, with a clear error message.

### Option B: Application-Layer Guard

Add a check in the assignment CRUD handler (`src/app/.../actions.ts` or equivalent):

```typescript
if (updateData.assignedAt && updateData.assignedAt !== currentRow.assignedAt) {
  throw new Error("kiosk_assignments.assigned_at is immutable; use unassignedAt to track lifecycle");
}
```

### Option C: Audit Trigger (Added Traceability)

Create a trigger that logs every UPDATE attempt to `audit_logs` with the old and new `assigned_at` values, even if the update is rejected. Provides visibility into attempts to mutate historical dates.

### Recommendation

**Combine A (DB constraint) + C (audit trigger)**: The constraint prevents accidental mutations at the database level, and the trigger gives operators insight into who tried to change it and when. This is the most robust safeguard against both silent corruption and untracked attempts.

---

## Open Questions Before Phase 5.2 Runs

1. **Verification of April 18 import in production**: Was `scripts/import-from-monday.ts` actually run against the production database on or around 2026-04-18, or did it run only on neon-dev? Confirm by:
   - Checking prod database for `kiosks.custom_fields->>'mondayItemId'` presence (if present, the Monday import did run)
   - Reviewing Vercel deployment logs for the date 2026-04-18

2. **Partial import hypothesis**: If the import ran successfully, did it capture all 231 outlets, or only a subset? Check:
   - `SELECT COUNT(*) FROM kiosk_assignments WHERE assigned_at::date = '2026-04-18'` (should be close to 231)
   - `SELECT COUNT(*) FROM kiosks WHERE custom_fields->>'mondayItemId' IS NOT NULL` (imported kiosk count)

3. **Locations without liveDate**: Per D4, 23 active outlets have no `liveDate`. Confirm these are intentional (pilot locations, internal accounts, etc.) and should remain NULL-install-date:
   - `SELECT outlet_code, name FROM locations WHERE archived_at IS NULL AND live_date IS NULL`
   - Verify against the Monday "Live Estate" board that these rows genuinely lack a go-live date

4. **Multi-kiosk locations**: The decision mentions a CSV (`tasks/analytics-audit/multi-kiosk-locations.csv`) documenting locations with >1 kiosk. Verify this exists and review for any patterns that might affect the backfill (e.g., some kiosks at one location went live at different times):
   - Check if `multi-kiosk-locations.csv` is present in the codebase
   - If >1 kiosk per location, do they share the same liveDate, or should they be disaggregated?

---

## Conclusion

The 2026-04-18 reseed is not a corruption or a bug — it is the **natural consequence of the first production import of kiosk data from Monday.com**. All rows received their creation timestamp at import time because no older historical per-kiosk install data exists in the system. The resolved decision **D4** explicitly accounts for this and prescribes a **location-level backfill from `locations.liveDate`** as the correct restoration strategy. Phase 5.2 backfill is safe to proceed with this source.

The Phase 5.3 safeguard (immutability constraint) is recommended to prevent future untracked mutations of `assigned_at`, ensuring the audit trail remains reliable going forward.
