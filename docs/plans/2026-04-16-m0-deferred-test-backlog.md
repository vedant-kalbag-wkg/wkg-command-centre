# M0 Deferred Playwright Test Backlog

Created: 2026-04-16 as part of M0 Task 0.5 (hybrid green-up).

This document tracks Playwright tests that are **red against a freshly-seeded
dev DB** but were **intentionally not fixed in Task 0.5** because they require
more than a trivial selector/setup tweak. Each entry lists what the failure
actually is, what's needed to fix it, and a rough effort estimate so the work
can be picked up as part of M1/M2 test-hardening.

> Scope reminder: M0 Task 0.5 rule was "quick-fix stale tests; never modify
> source under `src/` to make a test pass — if the test failure reveals a
> feature/app bug, defer it here."

---

## 1. `tests/kiosks/bulk-operations.spec.ts` — all 4 tests

Tests:

- `BULK-01: selecting rows shows bulk toolbar`
- `BULK-01: can bulk archive selected records`
- `BULK-02: toolbar has Export CSV button`
- `BULK-02: view toolbar Export CSV is enabled`

**Why they fail.** Playwright runs specs alphabetically with `fullyParallel: false`
and no per-test DB reset. `tests/kiosks/bulk-operations.spec.ts` sorts **before**
`tests/kiosks/kiosk-crud.spec.ts`, which is the file that actually creates kiosks
via the UI. So when bulk-operations runs, the `kiosks` table is empty, the UI
shows the "No kiosks yet" empty state (a `<div>`, not a `<table>`), and
`page.waitForSelector("table", { timeout: 10000 })` times out before the
in-test `test.skip()` guard can fire.

**What's needed to fix.** Give the bulk-operations spec its own deterministic
data. Two acceptable paths:

1. **Preferred:** expand the seed to include a handful of kiosks in varied
   states (different stages, regions, a couple unassigned, a couple venue-
   assigned). The kiosks only need to exist at DB level — no UI interaction
   needed. Add this to `src/db/seed.ts` (or a new `src/db/seed-kiosks.ts` that
   the seed pipeline calls). Keep the seed idempotent (`count() > 0 → skip`).
2. **Alternative:** add a `beforeAll` in `bulk-operations.spec.ts` that
   programmatically creates 2-3 kiosks via the UI helper
   (`tests/helpers/db.ts::createTestKiosk` — currently a stub that needs
   implementing against the `/kiosks/new` form).

**Effort.** ~2-4 hours. Mostly seed-script work + rerunning suite to confirm.

---

## 2. `tests/kiosks/kanban.spec.ts` — KANBAN-01 (count) + UAT-16 (x2) = 3 tests

Tests:

- `KANBAN-01: kanban column headers show stage name and count`
- `UAT-16: clicking a kiosk card opens detail sheet overlay`
- `UAT-16: kiosk detail sheet shows kiosk data`

**Why they fail.** Same alphabetical-ordering problem as bulk-operations:
when kanban.spec.ts runs, no kiosks have been created yet, so the Kanban
board renders with empty stage columns. `KANBAN-01` asserts that at least
one seeded stage name ("Prospect", "Live", etc.) is visible **as a column
header with cards beneath**; UAT-16 clicks `.cursor-pointer.select-none.bg-white`
which is a kiosk card and there are none to click.

Note: `KANBAN-01: kanban tab shows kiosk cards in stage columns`, `KANBAN-02`,
and `KANBAN-03` pass — they only assert the board shell and controls, not
actual card content.

**What's needed to fix.** Same seed expansion as item 1 — specifically kiosks
that carry an explicit `pipelineStageId` so they appear under the expected
stage columns. The seed needs to set at least one kiosk per expected stage
(minimally: one in "Prospect", one in "Live").

**Effort.** Included in item 1's seed-expansion effort. No extra work if item
1 is done first.

---

## 3. `tests/kiosks/pipeline-stages.spec.ts` — KIOSK-04 default stage (1 test)

Test: `KIOSK-04: admin can set a default pipeline stage`

**Why it fails.** Not a "default was mutated to On Hold" issue (Task 0.4's
diagnosis doesn't match the actual failure). The real failure is a DOM-
stability race: the test iterates rows, opens each kebab menu, checks if
"Set as default" is enabled, and when it finally finds an enabled one and
calls `menuItem.click()`, Playwright logs
`element was detached from the DOM, retrying` and ultimately times out
at 30s. The dropdown-menu reopens/reanimates between the enabled check and
the click, and the iteration loop keeps churning through menus.

**What's needed to fix.** Rework the test to either:

- Stop iterating: read the list of stage rows, find one with no "Default"
  badge in the DOM, open its kebab menu **once**, and directly click
  "Set as default" with `{ force: true }` after waiting for the menu to
  stabilize (`menuItem.waitFor({ state: 'visible' })` + explicit
  `page.waitForTimeout(100)` transition-settle).
- Or: bypass the UI entirely — call the server action directly to mark
  a stage default, then reload the page and assert the badge moved.

Ideally add a per-file `afterEach` that re-seeds pipeline stages (or a
server action that resets them) so the test order within the file doesn't
matter.

**Effort.** ~1-2 hours. Requires re-reading the MenuItem/DropdownMenu
implementation and a couple of iteration cycles to prove flake is gone.

---

## 4. `tests/locations/location-kiosks-tab.spec.ts` — LOC-05 shows assigned (1 test)

Test: `LOC-05: kiosks tab shows assigned kiosks`

**Why it fails.** The test creates a location, creates a kiosk, assigns the
kiosk to the location via the "Assign venue" dialog, then navigates to the
location's Kiosks tab — and the tab shows the "No kiosks assigned." empty
state. Error-context screenshot confirms the assignment didn't surface on
the location detail page.

This is ambiguous — could be:

- **App bug:** kiosk→location assignment isn't writing the join such that
  the location's `/kiosks` tab query picks it up (stale query, missing
  eager relation, write to wrong table).
- **Test bug:** the "Assign venue" dialog in the test is matching the
  wrong `locationName` option, or the assign action is completing but the
  detail page isn't being refreshed on navigation-back.

**What's needed to fix.** Reproduce manually with the dev server and verify:
1. Does the assignment actually persist? (Query `kiosks.location_id` in
   Postgres after the test runs.)
2. If yes → the Kiosks-tab query on location detail is broken → app bug.
3. If no → the Assign dialog's location-search or submit flow is broken →
   app bug **or** the test's search/select step is matching the wrong
   candidate.

Either way the fix almost certainly touches `src/`, which is out of
M0 scope.

**Effort.** ~2-3 hours (investigation + fix). Could be small if it's a
revalidation issue; larger if the assignment write path is wrong.

---

## 5. `tests/audit/audit-log.spec.ts` — AUDIT-02 (2 tests)

Tests:

- `AUDIT-02: kiosk detail audit tab shows timeline`
- `AUDIT-02: location detail audit tab shows timeline`

**Why they fail.** Both `waitForSelector("table", timeout: 10000)` on
`/kiosks` and `/locations` respectively — same empty-DB problem as
bulk-operations (audit-log.spec.ts sorts before any spec that creates
records). They bail before even touching the audit-specific assertions.

**What's needed to fix.** Two pieces:
1. **Data** — seed at least one kiosk and one location (covered by item 1's
   seed expansion).
2. **Feature gap** — per Task 0.4's notes, the detail-page audit timeline
   may not yet be fully implemented in the UI. Needs verification:
   - Navigate to an existing kiosk's detail page, click "Audit" tab.
   - Confirm the timeline renders (looking for "No activity yet" copy or
     `[data-slot=avatar-fallback]` markers). If the tab doesn't exist or
     renders blank, this is a feature gap, not a test bug — defer to the
     M1/M2 audit-log milestone.

**Effort.** ~1 hour to verify feature state after seed expansion; more if
the tab genuinely isn't implemented.

---

## 6. `tests/admin/invite-user.spec.ts` — invite new member user (1 test)

Test: `admin can invite a new member user`

**Note:** Not in the Task 0.5 scope list, but discovered as a 15th failure
in the baseline run. Recording here for completeness.

**Why it fails.** After submitting the invite form, the test waits for both
the success toast (`Invite sent to ${email}`) **and** the new row in the
users table. The row does appear — but so does the toast, which contains
the email. `page.getByText(testEmail)` then hits a Playwright strict-mode
violation because it matches two elements (toast + table cell).

**What's needed to fix.** Change the assertion to be row-specific, e.g.
`page.getByRole("cell", { name: testEmail })`, or wait for the toast to
dismiss before asserting the row.

**Effort.** ~5 minutes. Pure test-file change, zero source impact. Could
be folded into a follow-up test-cleanup pass alongside items 1-2.

---

## Rough totals

- Items 1 + 2 share a single seed-expansion fix → one chunk of work.
- Items 3, 6 are isolated test-file changes.
- Items 4, 5 may require source changes and should be triaged against
  M1/M2 audit-log + location-assignment milestones.

Total estimated effort across the backlog: **~6-10 engineering hours**,
half of which is seed work that M1/M2 will likely need anyway.
