# v2 Carryover — items skipped or deferred during v1.0 Phase 6 cleanup

**Source:** Phase 6 close session 2026-04-28 (PR #30 merged, commit `3a261b7`).

**Purpose:** Structured handoff for incorporation into the v2 PROJECT.md when `/gsd:complete-milestone` runs. Each item below was either explicitly deferred during the session or surfaced as work-in-flight that exceeded v1.0 scope.

---

## Data-quality residuals (Phase 5.7 backlog)

### V2-DQ-01: 61 active locations have NULL latitude/longitude

**State:** 391 → 373 active locations after Wave 1+2; 312 with lat/lng populated; **61 still NULL**.

**Why deferred:** The 61 rows have no `address` value in either DB or Monday (`BOTH_BLANK` + some `NO_MONDAY` cases per `scripts/probe-monday-vs-db-addresses.ts` output at `/tmp/monday-vs-db-addresses.csv`). Geocoding cannot resolve them without a hand-entered address.

**Fix path:**
1. For each of the 61 outlets: open the matching Monday hotel-board item; enter the real street address in the `location` column on Monday; save.
2. Re-run `scripts/enrich-locations-from-monday.ts` to backfill DB `address`.
3. Re-run `/settings/geocoding` Apply with **Re-geocode all UNCHECKED** (skip-existing default) → the 61 rows surface as candidates → Apply.
4. Spot-check 5/61 against Google Maps web UI.

**Cost estimate:** ~1 hour of operator hand-research per 20 hotels (3-4 hours total). Plus the geocoding rerun (~$0.30 in API spend).

### V2-DQ-02: Cluster 10 — `0Y` Clayton London Wall has wrong sibling-copied address

**State:** Outlet `0Y` (Clayton London Wall hotel, Dalata group, 16-22 Copthall Avenue, EC2R 7DA London) has `address = "Maldron Hotel Shoreditch, Paul Street, London, UK"` — wrongly copied from sibling row `4R` (Maldron Shoreditch). Geocoded today to the Maldron's lat/lng = wrong. Currently `merge_proposals` cluster 10 has decision `address_fix` documenting the issue.

**Why deferred:** Different bug shape from the 17 dup-outlet-codes resolved in Wave 1+2. Both rows have UK names; only the address is wrong. Cannot fix from Monday alone (Monday doesn't have outlet `0Y` — `NO_MONDAY` in probe).

**Fix path:**
1. Look up Clayton London Wall's real address (Dalata group website confirms 16-22 Copthall Avenue, EC2R 7DA).
2. `UPDATE locations SET address = '16-22 Copthall Avenue, London EC2R 7DA, UK' WHERE id = 'fe37b407-6e7a-458d-a2e2-f90ac50af496'` + audit-log.
3. Re-run `/settings/geocoding` Apply with **Re-geocode all** ticked, scoped to that one ID (or accept that the dry-run will show all 312 populated rows as candidates and just apply with 1 actual change).
4. Mark `merge_proposals` cluster 10's note as resolved.

### V2-DQ-03: 60 NO_MONDAY locations — triage

**State:** 60 active outlets in DB have `outlet_code` values that don't match any item in Monday's 4 hotel boards (Live Estate, Ready to Launch, Removed, Australia DCM).

**Why deferred:** Mixed bag — some are legitimate locations not yet imported into Monday (e.g. airport mobile desks), some may be orphan/test data, some may be archived hotels never reflected in Monday. Each needs human triage to decide: link to Monday (create item), archive in DB, or accept as-is.

**Fix path:** Run `scripts/probe-monday-vs-db-addresses.ts`, filter CSV for `status=NO_MONDAY`, walk the 60 rows in /locations admin UI, decide each.

---

## Same-name location collapse (deferred per the late-session directive)

### V2-DM-01: Audit + collapse same-name active location pairs

**State:** 19 distinct hotel names with 2+ active `locations` rows currently exist on prod. The user's directive on 2026-04-28 was: "I do not want two separate locations with the same name — I want a single location that both kiosks are linked to" (codified in memory `data_model_locations_kiosks.md`).

| Name | Rows | Origin |
|---|---|---|
| Residence Inn by Marriott Kensington | 8 | Original cluster 14, KEPT under earlier multi-kiosk-per-site interpretation |
| CBS OTH | 3 | Original cluster 22 |
| ACC Liverpool, Courtyard by Marriott SSM, Dorsett London Shepherds Bush SSM, Heathrow Terminal 4, Holiday Inn London - Heathrow Bath Road, Hotel Berlin Berlin, Hotel Indigo® Gloucester- The Forum, Ibis Heathrow Airport, Manchester Central, Metrocentre, Radisson RED SSM, Sheraton Skyline SSM, St Giles London, T2 Mobile desk, Zedwell Piccadilly SSM | 2 each | Original 22-cluster CSV — REJECTED in operator review |
| **Sheraton Heathrow SSM** | 2 | NEW — `S3` always was; `1S` renamed in Wave 1 → same hotel |
| **Radisson Blu Edwardian SSM** | 2 | NEW — `S9` renamed in Wave 1; `9S` renamed in final cleanup → same hotel |

**Why deferred:** The user's directives evolved across the session:
1. Early: "There are no true duplicate locations" (about clusters 1-22) → multi-kiosk interpretation, kept all rows.
2. Mid: "Both T4 and 4T need to exist, as new sales will be attributed to both" (re cluster 20/21).
3. Late: "I do not want two separate locations with the same name" (re S5/S6 specifically).

The late directive contradicts the early one. The user explicitly applied the late rule only to S5/S6 in this session. Whether the other 19 same-name groups should also collapse is **a v2 scoping decision** — depends on whether the multi-kiosk-per-site interpretation is intentional (kiosks are tracked at location-row granularity) or accidental (Monday import created duplicates).

**Two new same-name pairs (Sheraton Heathrow SSM, Radisson Blu Edwardian SSM) are direct consequences of Wave 1 renames** — they should probably be collapsed early in v2 (or before-PR if user agrees), since they're our doing.

**Fix path:**
1. Decide policy: collapse-all vs keep-as-multi-kiosk.
2. If collapse: for each of the 19 groups, pick canonical (most data attached) and use `multi-pos-merge.ts` to absorb the others. Outlet codes remain on individual `kiosks` rows.
3. The `kiosks` schema needs verification — confirm `outlet_code` lives there and is the operational identity, not on `locations`.

---

## Test coverage gaps

### V2-TEST-01: multi-pos-merge integration test single-pair fixture

**State:** `tests/scripts/multi-pos-merge.integration.test.ts` covers multi-pair merges but not single-pair. The Drizzle bug at `scripts/multi-pos-merge.ts:121` (raw SQL `ANY(${ids}::uuid[])` failing on 1-element arrays under node-postgres) was not caught by the existing test. Fix landed in commit `b58a70b` using `inArray()`. **No regression test was added.**

**Why deferred:** Bug was found and fixed mid-session; adding the test was deprioritised in favour of completing the destructive UAT. The fix is structurally safer (`inArray()` handles both single + multi correctly) so the regression risk is low.

**Fix path:** Add a fixture-driven integration test that seeds exactly 1 pending merge_proposal pair and asserts (a) the merge transaction commits, (b) `applied_at` gets stamped on the single row.

### V2-TEST-02: Staging orphan-rate baseline

**State:** `src/lib/sales/reversal-matcher.test.ts` describe-block comment still has `<X>/<N> = <X.XX>%` placeholder for the staging measurement. Prod baseline is filled (11/36 = 30.56% on 2026-04-28).

**Why deferred:** Non-blocking per Phase 6.7 plan. SC6 contract is already met by the determinism fix + property-style tests + script existence.

**Fix path:** `DATABASE_URL='<staging>' npx tsx scripts/measure-reversal-orphan-rate.ts` then paste the printed line into the comment.

---

## Code refactoring items (carried forward from earlier deferred-items.md)

### V2-REF-01: Analytics dashboards — migrate `useEffect → loadData()` pattern

**State:** Two files in Phase 6.3 scope have `useEffect → loadData()` data-fetching pattern that fails ESLint `react-hooks/set-state-in-effect`:
- `src/app/(app)/analytics/commission/page.tsx:120` (commit `98a172a`, 2026-04-18)
- `src/app/(app)/analytics/maturity/page.tsx:61` (commit `a3b6c8e`, 2026-04-18)

Pattern repeats across every analytics dashboard.

**Fix path:** Dedicated "analytics dashboards: migrate data-loading effects off setState-in-effect" pass — bundle with the broader RSC-first refactor that post-v1 work implies.

---

## Monday integration follow-ups

### V2-MONDAY-01: Bidirectional Monday sync (drift detection)

**State:** Current `enrich-locations-from-monday.ts` only writes to NULL DB fields, never overwrites. No mechanism to detect or correct Monday → DB drift over time. The new probe (`scripts/probe-monday-vs-db-addresses.ts`) shows 0 DIFF rows today, but as Monday gets edited, drift will accumulate.

**Why deferred:** Out of scope for v1.0; the manual probe + targeted hand-fix loop is sufficient for the current operational tempo.

**Fix path:** Either (a) extend enrich script with `--overwrite-stale` flag that updates `address` (and other Monday-sourced fields) when DB diverges, with audit_log per change; or (b) build a /settings admin UI that shows current drift and lets operator approve fixes one-by-one; or (c) scheduled cron that runs the probe and surfaces drift in admin notifications.

---

## Vercel infrastructure

### V2-INFRA-01: GitHub auto-delete-after-merge for branches

**State:** Remote branch `gsd/phase-06-…` still exists on origin after PR #30 merge (squash). GitHub auto-delete-merged-branches is not enabled on this repo.

**Why deferred:** One-off cleanup; user can configure once.

**Fix path:** GitHub repo settings → "Automatically delete head branches" toggle on. Then manually delete the existing stale branches.

---

## Summary

| Class | Items | Estimated effort |
|---|---|---|
| Data quality | V2-DQ-01, V2-DQ-02, V2-DQ-03 | 4-6 hours operator + ~$1 API |
| Data model | V2-DM-01 | Depends on policy decision (1-2 days if collapse-all) |
| Test coverage | V2-TEST-01, V2-TEST-02 | 1-2 hours |
| Refactoring | V2-REF-01 | Bundle with broader RSC refactor |
| Integration | V2-MONDAY-01 | 1-3 days depending on path |
| Infra | V2-INFRA-01 | 5 minutes |

When `/gsd:complete-milestone` runs and creates v2 PROJECT.md, these items should be incorporated into the v2 requirements set + scope/non-goals discussion.
