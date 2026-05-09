---
status: testing
phase: 07-data-foundation-rebuild
source:
  - 07-02-SUMMARY.md
  - 07-04-SUMMARY.md
  - 07-05-SUMMARY.md
  - 07-06-SUMMARY.md
started: 2026-05-08T09:25:00.000Z
updated: 2026-05-08T09:25:00.000Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 1
name: Cold Start Smoke Test
expected: |
  Kill any running dev server. Clear .next + any local caches. Start the app
  from scratch (`npm run dev`) against prod DATABASE_URL (or UAT branch URL —
  whichever you intend to drive the rest of UAT against). Server boots without
  errors, no migration replay needed, sign-in succeeds, /dashboard loads and
  renders the Jan 2026 totals (~95,103 sales rows, ~£1,783,083.58 gross
  revenue).
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: |
  Kill any running dev server. Clear .next + any local caches. Start the app
  from scratch (`npm run dev`) against prod DATABASE_URL (or UAT branch URL —
  whichever you intend to drive the rest of UAT against). Server boots without
  errors, no migration replay needed, sign-in succeeds, /dashboard loads and
  renders the Jan 2026 totals (~95,103 sales rows, ~£1,783,083.58 gross
  revenue).
result: [pending]

### 2. Sales Analytics Reflect Prod-Canonical Reseed
expected: |
  /dashboard and the analytics pages (e.g. /analytics/heat-map,
  /analytics/regions) render against the post-cutover prod data: total sales
  count = 95,103 and gross revenue = £1,783,083.58 for Jan 2026. Region
  breakdowns load without orphan/unknown buckets dominating, since the new
  customer_code resolver covers 372 of 510 active locations.
result: [pending]

### 3. /locations Same-Name Banner Reflects Empty Group State
expected: |
  Open /locations as admin. The Plan 07-04 yellow Alert banner does NOT
  appear, because verify-data-reset reports zero active same-name groups
  (excluding the LOCATION_NEEDED sentinel). The locations table loads with
  ~510 active rows visible.
result: [pending]

### 4. Location Merge UI on /locations
expected: |
  On /locations, multi-select two same-region locations (any non-sentinel
  rows). Click Merge. Dialog opens with a consequences preview citing N-1
  archives + kiosk-reattach + sales-rewrite + snapshot-saved. Pick a canonical
  row, submit, and observe the merge complete inside a single transaction —
  defunct rows archived, kiosks reattach, an audit-log entry appears.
  (If you don't want to mutate prod data, run this against the UAT branch
  preview at the wkg-command-centre-git-gsd-p-... alias.)
result: [pending]

### 5. Undo Merge on /admin/audit-log/[id]
expected: |
  Open /admin/audit-log for the merge you just performed (or any prior merge
  with action='merge' and snapshot still present). Click into the row to
  /admin/audit-log/[id]. An "Undo merge" button is visible (not greyed out)
  for that entry. Clicking it replays the snapshot inside a single
  transaction; the previously-archived rows un-archive, kiosk_assignments
  flip back, a paired "undo" audit entry is written.
result: [pending]

### 6. /admin/health Status Cards
expected: |
  Open /admin/health as admin. Two status cards render: (a) a same-name
  groups card showing 0 active groups; (b) a LOCATION_NEEDED orphan-kiosks
  card showing 0 orphans (post-cutover state). Non-admin users get a 403 /
  forbidden.
result: [pending]

### 7. Dry-Import Warning Surfaces Same-Name Candidates
expected: |
  Run a Monday hotel-locations dry-import (e.g. via /settings/imports or the
  equivalent operator surface) for a board that contains a row whose
  normalised_name would collide with an existing active location. The
  preview/return value surfaces a same-name warning BEFORE any write, and
  the warning is also recorded in audit_logs as a dry-run entry.
result: [pending]

### 8. Audit-Log Row Click Navigation
expected: |
  /settings/audit-log loads as admin. Click any row in the list — page
  navigates to /admin/audit-log/[id] for that entry, rendering the detail
  view with action, actor, target, before/after diff (and Undo button on
  merges per Test 5).
result: [pending]

### 9. Phase 07-06 Operator-Flagged Conflicts Visible in Merge UI
expected: |
  Open the merge / duplicates UI (likely /settings/duplicates or surfaced
  from /locations). The 4 conflicts flagged by `[Phase 07-06]` notes during
  reseed are listed for operator triage:
    - Clayton Hotel Manchester Airport (UK, customer_code 2523 collision)
    - Holiday Inn Express Sydney Airport (same-name with Live Estate row)
    - Holiday Inn Express Sydney Macquarie Park (same-name with Live Estate row)
    - Melbourne Marriott Hotel Docklands (same-name with Live Estate row)
  These appear in the UI; you do NOT need to merge them now (deferred operator
  follow-up per phase plan).
result: [pending]

### 10. verify-data-reset Against Prod Reports Operator-Accepted State
expected: |
  Run `DATABASE_URL=<prod-url> npx tsx scripts/verify-data-reset.ts` and see:
    - 11 invariants total
    - 8 PASS / 2 FAIL / 1 WARN
    - PASS: sales count (95103), gross revenue (1783083.58), no orphan
      kiosk_assignments, 0 active same-name groups, sentinel exists,
      customer_code coverage ≥ 320 (actual 372), assigned_at coverage = 0
      NULLs, audit-log reseed entries ≥ 1
    - FAIL (operator-accepted): locations.active 510 vs golden 373;
      kiosks.active 400 vs golden 442
    - WARN: LOCATION_NEEDED orphan kiosks = 0 (informational)
  This matches 07-VERIFY-REPORT-prod.md byte-for-byte (or close to it; only
  drift is from any post-cutover operator activity).
result: [pending]

## Summary

total: 10
passed: 0
issues: 0
pending: 10
skipped: 0
blocked: 0

## Gaps

[none yet]
