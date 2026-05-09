---
phase: '09-poc-underperformance-alerts'
status: issues
findings_total: 9
findings_critical: 0
findings_high: 2
findings_medium: 0
findings_low: 3
findings_resolved: 4
reviewed_at: '2026-05-09T19:00:00Z'
remediated_at: '2026-05-09T22:30:00Z'
remediation_commit: 3570cbe
depth: deep
files_reviewed: 18
files_reviewed_list:
  - src/inngest/functions/weekly-poc-alerts.ts
  - src/inngest/functions/send-email.ts
  - src/lib/performance-alerts/classify-kiosks.ts
  - src/lib/performance-alerts/classify-dispatch.ts
  - src/lib/performance-alerts/poc-batching.ts
  - src/lib/performance-alerts/hash.ts
  - src/lib/performance-alerts/iso-week.ts
  - src/lib/performance-alerts/classify-dispatch.test.ts
  - src/lib/performance-alerts/poc-batching.test.ts
  - src/lib/performance-alerts/iso-week.test.ts
  - src/emails/poc-underperformance.tsx
  - src/emails/text-versions.ts
  - src/inngest/events.ts
  - src/app/(app)/admin/performance-alerts/page.tsx
  - src/app/(app)/admin/performance-alerts/actions.ts
  - src/app/(app)/admin/performance-alerts/run-now-button.tsx
  - src/app/(app)/kiosks/[id]/silence-actions.ts
  - src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx
---

# Phase 09: Code Review Report

**Reviewed:** 2026-05-09T19:00:00Z
**Depth:** deep
**Files Reviewed:** 18
**Status:** BLOCK — 3 critical bugs found

## Remediation Status (2026-05-09T22:30:00Z)

**All three critical issues + WR-03 RESOLVED in commit `3570cbe`** — `fix(phase-09): address gsd-code-review CR-01/CR-02/CR-03 + WR-03`. Status downgraded from `blocking` → `issues`. Remaining open: WR-01 (TOCTOU in `triggerRunNow` rate limiter) and WR-02 (`GROUP BY ka.location_id` over-counts kiosks with multiple active assignments) — both real but lower-risk; tracked for follow-up. Info-level findings unchanged.

Verification of remediation:
- `npx tsc --noEmit`: no errors
- `npx vitest run --project unit src/lib/performance-alerts/ src/emails/__tests__/`: PASS (35) FAIL (0)
- BST boundary unit test (`iso-week.test.ts`) now uses `2026-05-31T23:30:00Z` — actually exercises the UTC-Sunday/London-Monday crossing.

---

## Summary

Phase 9 implements the weekly POC underperformance alert pipeline: kiosk classification,
per-POC email batching, admin trigger UI, and per-kiosk silence controls. The pure-logic
libraries (`classify-dispatch`, `poc-batching`, `iso-week`, `hash`) are correct and
well-tested. The migration SQL is idempotent. RBAC is correctly applied across all server
actions.

The original review found three critical defects in the Inngest function layer that would
have caused production failures. **All three are now resolved in commit `3570cbe`.** The
detail below reflects the original findings; the remediation strategy used is documented
inline in `src/inngest/functions/weekly-poc-alerts.ts`.

1. **Plain-text email CTA will render `undefined`** — `portfolioUrl` is required by
   `pocUnderperformanceText` but is not included in the `templateProps` emitted by
   `weekly-poc-alerts.ts`. Every plain-text POC email sent in production will contain a
   broken `undefined` link in the call-to-action line.

2. **ISO-week deduplication breaks on Inngest retry across a Monday boundary** — `runIsoWeek`
   is computed with `new Date()` outside any step boundary. On retry the timestamp advances; if
   the retry crosses midnight into Monday (Europe/London), a different ISO week key is produced,
   defeating the `email_log` partial-unique-index deduplication guard.

3. **`alertedCount` / `skippedCount` always return 0 on Inngest replay** — these counters are
   mutated inside `step.run` closures. Inngest memoises completed steps and does not re-execute
   the closure body; the variables remain at their initial value of `0`. The function's return
   value `{ alerted, skipped, classified }` will always report zeros after any replay, corrupting
   run-level monitoring metrics.

None of the three critical bugs are covered by existing tests.

---

## Critical Issues

### CR-01: `pocUnderperformanceText` called without required `portfolioUrl` — broken plain-text CTA

**File:** `src/inngest/functions/send-email.ts:104-106`
**Also:** `src/inngest/functions/weekly-poc-alerts.ts:194-209` (emission site)

**Issue:** `send-email.ts` dispatches to `pocUnderperformanceText(props)` where `props` is
cast from `templateProps`. However the `templateProps` object constructed in
`weekly-poc-alerts.ts` contains only `{ pocName, kiosks, moreCount, windowDays, runIsoWeek }`.
`pocUnderperformanceText` requires `portfolioUrl: string` as a non-optional field. Because
the call site uses a `Parameters<typeof pocUnderperformanceText>[0]` cast, TypeScript does not
catch the missing field at compile time. At runtime, the `portfolioUrl` variable in the
plain-text template evaluates to `undefined`, producing output like:

```
View your full portfolio: undefined
```

Every POC underperformance email sent in production will have a broken CTA in the plain-text
part.

**Fix:** Add `portfolioUrl` to the `templateProps` emitted in `weekly-poc-alerts.ts`. The
HTML email template already computes it from `BRAND.prodUrl`; reuse that constant:

```typescript
// weekly-poc-alerts.ts — inside the event payload construction (~line 200)
import { BRAND } from "@/lib/brand";

// Add to templateProps:
templateProps: {
  pocName: poc,
  kiosks: batch,
  moreCount,
  windowDays: WINDOW_DAYS,
  runIsoWeek,
  portfolioUrl: `${BRAND.prodUrl}/analytics`,   // ← add this
},
```

---

### CR-02: `runIsoWeek` computed outside step boundary — breaks deduplication on Inngest retry

**File:** `src/inngest/functions/weekly-poc-alerts.ts:158`

**Issue:** The variable `runIsoWeek` is assigned between two `step.run` calls, outside any
step closure:

```typescript
// Step 4 (write-state) ends ~line 156
const runIsoWeek = isoWeekKey(new Date());   // ← line 158, no step wrapper
// Step 5 (emit-poc-emails) begins ~line 160
```

Inngest memoises completed steps. When the function retries starting at step 5, the step 4
closure is not re-executed — its stored return value is replayed. But `new Date()` at line 158
runs fresh on every execution, including retries. If the retry occurs after a Monday boundary
in Europe/London, `isoWeekKey(new Date())` returns a different ISO week string than the one
used in the original execution. The `payloadHash` computed in step 5 then differs from the
hash already written to `email_log` by the original execution, so the partial-unique-index
deduplication guard silently fails to deduplicate, and duplicate emails are dispatched to POCs.

**Fix:** Compute `runIsoWeek` inside step 4 and return it from the step closure so Inngest
memoises it:

```typescript
// Replace the separate step 4 and runIsoWeek assignment with:
const { runIsoWeek } = await step.run("write-state", async () => {
  const week = isoWeekKey(new Date());  // ← captured once, memoised
  for (const row of kioskRows) {
    await db.insert(kioskPerformanceAlertState)
      .values({ /* ... */ })
      .onConflictDoUpdate({ /* ... */ });
  }
  return { runIsoWeek: week };
});
```

---

### CR-03: `alertedCount` / `skippedCount` always 0 on Inngest replay — corrupts monitoring metrics

**File:** `src/inngest/functions/weekly-poc-alerts.ts:218,233`

**Issue:** `alertedCount` and `skippedCount` are declared as outer `let` variables and then
assigned inside `step.run` closures:

```typescript
let alertedCount = 0;
let skippedCount = 0;

await step.run("emit-poc-emails", async () => {
  // ...
  alertedCount = events.length;   // ← line 218
});

await step.run("emit-skip-rows", async () => {
  // ...
  skippedCount = skipKiosks.length;  // ← line 233
});

return { alerted: alertedCount, skipped: skippedCount, classified, firstRun };
```

Inngest memoises completed steps. On replay, neither closure body executes; only the stored
return value is replayed. The outer variables are never assigned; both remain `0`. The
function's final return value reports `{ alerted: 0, skipped: 0 }` on any replay path.

This corrupts the audit log entry written in step 6 (`write-audit-log`) and any downstream
observability that reads from that entry.

**Fix:** Capture the counts as return values from the step closures:

```typescript
const { alertedCount } = await step.run("emit-poc-emails", async () => {
  const events = /* ... */;
  await inngest.send(events);
  return { alertedCount: events.length };
});

const { skippedCount } = await step.run("emit-skip-rows", async () => {
  const rows = /* ... */;
  await db.insert(emailLog).values(rows);
  return { skippedCount: rows.length };
});

return { alerted: alertedCount, skipped: skippedCount, classified, firstRun };
```

---

## Warnings

### WR-01: TOCTOU race in `triggerRunNow` rate limiter — concurrent admin requests bypass gate

**File:** `src/app/(app)/admin/performance-alerts/actions.ts:20-43`

**Issue:** The rate-limit check is not atomic:

```typescript
const lastRun = await db.select(...).limit(1);      // ← check
if (lastRun[0] && elapsedMs < RATE_LIMIT_MS) {
  return { ok: false, error: "Rate limited" };
}
// ← gap: two concurrent requests can both reach here before either writes the audit log
await inngest.send({ ... });
await writeAuditLog({ ... });                        // ← use
```

Two concurrent admin requests (e.g., double-click, or two admin tabs) can both pass the
elapsed-time check before either writes the `performance_alert_run` audit log row. Inngest's
`id: performance-alerts-manual-${session.user.id}-${minuteBucket}` deduplication key provides
partial protection for the same user in the same minute bucket, but not across different users
or across minute boundaries.

**Fix (low-overhead):** Move to a DB-level advisory lock or an upsert-with-conflict pattern
so the gate is enforced in a single round-trip:

```sql
-- advisory lock approach (pg_try_advisory_xact_lock)
BEGIN;
SELECT pg_try_advisory_xact_lock(hashtext('performance_alert_run'));
-- if returns false: return rate-limited
-- else: proceed with inngest.send + audit log
COMMIT;
```

Or, simpler: insert the audit log row first with a unique constraint on
`(entity_type, created_at::date)` or a separate `performance_alert_runs` table with
`INSERT ... ON CONFLICT DO NOTHING RETURNING id`, then only call `inngest.send` if the
insert succeeded.

---

### WR-02: `GROUP BY ka.location_id` causes duplicate kiosk rows when multiple active assignments exist

**File:** `src/lib/performance-alerts/classify-kiosks.ts:79`

**Issue:** The classification query groups by `ka.location_id` among other columns. A kiosk
that has two concurrent active `kiosk_assignments` rows (both with `unassigned_at IS NULL`)
will produce two rows in the result set, with doubled revenue figures and duplicate
`ClassifiedKioskRow` entries for the same `kioskId`. The percentile rank will be computed
twice with inflated revenue, distorting the tier assignment.

There is no schema-level UNIQUE constraint on `(kiosk_id, unassigned_at IS NULL)` visible in
the migration files, so this is a live data integrity risk.

**Fix (defensive):** Add `DISTINCT ON (k.id)` or deduplicate the assignment join by selecting
the most-recent assignment row per kiosk:

```sql
-- Replace the JOIN with a lateral/subquery to select one active assignment:
JOIN LATERAL (
  SELECT location_id
  FROM kiosk_assignments
  WHERE kiosk_id = k.id AND unassigned_at IS NULL
  ORDER BY assigned_at DESC
  LIMIT 1
) ka ON true
```

Separately, add a partial unique index to the schema to enforce the invariant:
```sql
CREATE UNIQUE INDEX kiosk_assignments_one_active_per_kiosk
  ON kiosk_assignments (kiosk_id)
  WHERE unassigned_at IS NULL;
```

---

### WR-03: BST boundary test does not exercise the stated edge case

**File:** `src/lib/performance-alerts/iso-week.test.ts:38-43`

**Issue:** The test comment claims to test "a datetime that is Monday in London but Sunday in
UTC," but the timestamp used (`2026-06-01T00:00:00Z`) is June 1 in UTC (midnight UTC =
01:00 BST Monday). This is June 1 in both UTC and London; there is no UTC/London day boundary
crossing at this timestamp. The true "Sunday in UTC, Monday in London" boundary is
`YYYY-MM-DDT23:30:00Z` to `YYYY-MM-DDT23:59:59Z` on a Sunday when BST is in effect. The
test passes but provides no coverage for the claimed edge case.

If a retry of the Inngest function occurs in the real 23:30–00:00 UTC window on a Sunday
night, the `isoWeekKey` call in CR-02 (once fixed) may still produce different results in
different invocations depending on the execution timestamp. The test suite does not verify
this boundary is handled correctly.

**Fix:** Replace the timestamp to actually exercise the boundary:

```typescript
it("handles BST: a datetime that is Monday in London but Sunday in UTC", () => {
  // 2026-05-31T23:30:00Z = Sunday 31 May in UTC, but Monday 1 June in BST (UTC+1)
  expect(isoWeekKey(new Date("2026-05-31T23:30:00Z"))).toBe("2026-W23");
});
```

---

## Info

### IN-01: Dead `EmailKind` entries in `events.ts`

**File:** `src/inngest/events.ts`

**Issue:** `EmailKind` union includes `"digest_daily"` and `"kiosk_offline"` — features
dropped in D-01 scope reduction. These entries are dead code that pollute the type and
make the active kinds harder to see.

**Fix:** Remove `"digest_daily"` and `"kiosk_offline"` from the `EmailKind` union.

---

### IN-02: N serial DB upserts in `write-state` step

**File:** `src/inngest/functions/weekly-poc-alerts.ts:130-155`

**Issue:** The `write-state` step iterates over `kioskRows` and issues one `db.insert/upsert`
call per kiosk inside a loop. For a run with 100+ kiosks this is 100+ sequential round-trips
to the DB inside a single Inngest step.

**Fix:** Use a single `db.insert(...).values(allRows).onConflictDoUpdate(...)` call outside
the loop.

---

### IN-03: Skip rows don't record which kiosk was skipped

**File:** `src/inngest/functions/weekly-poc-alerts.ts:234-242`

**Issue:** Skip-log rows use `recipient: "[skip:no-poc]"` with no `entityId` or kiosk
identifier. If the email_log is audited to understand which kiosks were skipped on a given
run, the records are not queryable by kiosk.

**Fix:** Include the kiosk's `kioskId` field in the skip row, e.g.
`recipient: \`[skip:no-poc:${kiosk.kioskId}]\`` or add a dedicated `entityId` column.

---

### IN-04: Hardcoded brand hex in `kiosk-admin-panel.tsx`

**File:** `src/app/(app)/kiosks/[id]/kiosk-admin-panel.tsx:55-56`

**Issue:**
```tsx
style={{ borderLeft: "4px solid #00A6D3", backgroundColor: "#CCEDF6" }}
```

Inline hex values should use `BRAND.azure` (`#00A6D3`) and `BRAND.azureTint20` (or the
Tailwind token defined for that tint). Hardcoded colors break if brand tokens are updated.

**Fix:** Import brand constants or use the project's Tailwind config tokens for Azure and its
20% tint instead of inline hex strings.

---

### IN-05: No integration tests for `_handleWeeklyPocAlerts` or `_handleSendEmail`

**File:** `src/inngest/functions/weekly-poc-alerts.ts`, `src/inngest/functions/send-email.ts`

**Issue:** Both handlers are exported with underscore-prefixed names specifically to enable
testing, but no test file exercises them. The three critical bugs above (CR-01, CR-02, CR-03)
would have been caught by integration tests. The existing unit tests cover the pure-logic
libraries only.

**Fix:** Add integration tests using `@inngest/test` (or equivalent mocking) that exercise
at least: (1) full happy-path run producing correct `alerted`/`skipped` counts, (2) retry
idempotency (second run with same week key does not re-send emails), (3) plain-text email
content includes a non-undefined `portfolioUrl`.

---

## Merge Recommendation

**BLOCK — FIX BEFORE MERGE**

CR-01 (`portfolioUrl` missing) will send broken emails to POCs on the first production run.
CR-02 (`runIsoWeek` step boundary) will silently send duplicate emails if any Inngest retry
crosses a Monday boundary. CR-03 (counter mutation in step closures) will record zeroed
monitoring metrics on any replay path.

All three are confined to `weekly-poc-alerts.ts` and `send-email.ts`. The fixes are
mechanical (CR-01: add one field to `templateProps`; CR-02: move `isoWeekKey` inside the
step closure and return it; CR-03: return counts from step closures instead of mutating
outer variables). No schema changes or migrations are needed.

Suggested fix order:
1. CR-01 (highest user-visible impact — broken plain-text email)
2. CR-02 + CR-03 together (both in `weekly-poc-alerts.ts`, same area)
3. WR-03 (fix the BST test assertion to validate the actual boundary)
4. Remaining warnings and info items can follow in a polish commit

---

_Reviewed: 2026-05-09T19:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
