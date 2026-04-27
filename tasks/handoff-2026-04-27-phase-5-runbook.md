# Post-merge runbook — Phase 4 deferred close + Phase 5.1/5.2/5.3

**Date authored**: 2026-04-27 (fourth session of the day)
**Branch**: `gsd/phase-04-deferred-and-5-1-investigation`
**Pre-flight assumption**: PR for this branch is merged to `main`; Vercel deploy is in flight or done.

The standing prod-migration runbook from `tasks/handoff-2026-04-27-post-merge.md` covered migrations `0027`–`0034`. This addendum covers what's new on this branch and must run before the Maturity dashboard re-validation (Phase 5.4) can pass.

---

## 1. Apply migrations 0035 + 0036

Both new migrations are idempotent. Run the standard migrator:

```bash
DATABASE_URL='postgresql://neondb_owner:npg_DpVZPe52KWLY@ep-blue-bonus-abey47wj-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require' \
  npx drizzle-kit migrate
```

What lands:

| # | What it does |
|---|---|
| 0035 | `UNIQUE INDEX (created_by, name) ON experiment_cohorts`. Enforces per-user cohort name uniqueness; surfaces in the `CohortForm` UI as `DuplicateCohortNameError`. Prod has 0 cohorts so no data conflict. |
| 0036 | `BEFORE UPDATE` trigger `kiosk_assignments_assigned_at_immutable` rejecting any change to `assigned_at` unless the transaction has set `app.allow_assigned_at_mutation = 'on'`. Phase 5.2 backfill (next step) is the only intended write through this trigger. |

Verify both applied:

```bash
DATABASE_URL='...' npx tsx -e "
import { sql } from 'drizzle-orm';
import { db } from '/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/src/db';
async function main() {
  const m: any = await db.execute(sql\`SELECT id FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5\`);
  console.log('migration ids:', (m.rows ?? m).map((r:any)=>r.id));
  const idx: any = await db.execute(sql\`SELECT indexname FROM pg_indexes WHERE indexname='experiment_cohorts_created_by_name_unique'\`);
  console.log('cohort UNIQUE index present:', (idx.rows ?? idx).length === 1);
  const trg: any = await db.execute(sql\`SELECT tgname FROM pg_trigger WHERE tgname='kiosk_assignments_assigned_at_immutable'\`);
  console.log('immutability trigger present:', (trg.rows ?? trg).length === 1);
}
main().catch(e => { console.error(e); process.exit(1); });
"
```

---

## 2. Run the Phase 5.2 backfill

```bash
export DATABASE_URL='postgresql://neondb_owner:npg_DpVZPe52KWLY@ep-blue-bonus-abey47wj-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'

# Dry-run first (read-only — confirms the plan against prod live state).
npx tsx scripts/backfill-kiosk-install-dates.ts

# If the plan matches expectation (362 live_date, 0 min_sales, 7 untouched
# — see "Expected output" below), apply:
npx tsx scripts/backfill-kiosk-install-dates.ts --apply
```

The script wraps the UPDATE + audit-log writes in one transaction, sets `SET LOCAL app.allow_assigned_at_mutation = 'on'` to bypass the immutability trigger added in 0036, and writes one `audit_logs` row per assignment for traceability.

**Expected output as of dry-run on 2026-04-27**:

```
--- Backfill plan ---
  → live_date source : 362 assignments
  → min_sales source : 0 assignments
  Skipped (intentional):
    • already correct (idempotent re-run): 0
    • no live_date and no sales         : 7 (left at import-time stamp; per D4)
    • ended assignments (unassigned_at)  : 0 (preserve history)
    • archived locations                  : 11
```

If the apply numbers diverge meaningfully (say, ±20 from these), pause and investigate — it likely means new outlets have been added or ETL has rewritten timestamps in the meantime.

---

## 3. Phase 5.4 — Maturity dashboard re-validation

After the backfill commits, the Maturity dashboard should show install cohorts spread across years rather than a single April-2026 spike. Probes:

```sql
-- 1. assigned_at distribution should now span multiple months/years.
SELECT date_trunc('month', assigned_at) AS m, COUNT(*) AS c
FROM kiosk_assignments
WHERE unassigned_at IS NULL
GROUP BY 1
ORDER BY 1;

-- 2. Compare locations.live_date with the resolved kiosk assigned_at.
-- For active locations with live_date set, they should now match within 1 sec.
SELECT COUNT(*) AS misaligned
FROM kiosk_assignments ka
JOIN locations l ON l.id = ka.location_id
WHERE l.archived_at IS NULL
  AND ka.unassigned_at IS NULL
  AND l.live_date IS NOT NULL
  AND ABS(EXTRACT(EPOCH FROM (ka.assigned_at - (l.live_date AT TIME ZONE 'UTC')))) > 1;
-- expect 0

-- 3. Idempotent self-check — re-running the backfill script should print
--    "Nothing to update — re-run is a no-op (idempotent)."
```

Then UAT the dashboard at `/analytics/maturity` and confirm:
- Install cohorts span multiple months (not all April-2026).
- Ramp curve shows a real growth shape, not a single vertical step.
- Maturity bucket distribution looks reasonable (a healthy mix of `0-1 / 1-3 / 3-6 / 6-9 / 9+`).

If all three pass, tick `5.4` in `tasks/todo.md`.

---

## 4. Smoke-check the immutability trigger

The trigger is the safety net against another silent reseed. Confirm it works *after* the backfill commits:

```sql
-- Outside any transaction with `app.allow_assigned_at_mutation = on`, the
-- following must raise: "kiosk_assignments.assigned_at is immutable …"
UPDATE kiosk_assignments
   SET assigned_at = NOW()
 WHERE id = (SELECT id FROM kiosk_assignments LIMIT 1);
-- expect: ERROR (do NOT actually run this in prod — but you can run it
-- inside a transaction and ROLLBACK to verify the trigger fires).

BEGIN;
  UPDATE kiosk_assignments
     SET assigned_at = NOW()
   WHERE id = (SELECT id FROM kiosk_assignments LIMIT 1);
ROLLBACK;
-- expect: ERROR before ROLLBACK takes effect.
```

If the error fires, the safeguard works as designed.

---

## 5. Memory updates

After Phase 5.4 ticks green:

- Update `~/.claude/projects/-Users-vedant-Work-WeKnowGroup-wkg-kiosk-tool/memory/project_next_steps.md` to mark Phase 5.1–5.3 done and Phase 5.4 verified, and tighten the focus to Phase 5.5/5.6/5.7 (D8 multi-POS merge) plus Phase 7 P0s (`7.1`, `7.3`, `7.10`).

---

## 6. Rollback plan (if Phase 5.4 fails)

The backfill writes `audit_logs` rows with the old → new `assigned_at` values for every modified row. To revert:

```sql
BEGIN;
  SET LOCAL app.allow_assigned_at_mutation = 'on';
  UPDATE kiosk_assignments ka
     SET assigned_at = al.old_value::timestamptz
    FROM audit_logs al
   WHERE al.entity_id = ka.id::text
     AND al.entity_type = 'kiosk_assignment'
     AND al.field = 'assigned_at'
     AND al.metadata->>'script' = 'scripts/backfill-kiosk-install-dates.ts';
COMMIT;
```

Then re-run the dry-run to confirm the residual count returns to the original ~362.
