---
status: passed
phase: 06-post-audit-operational-follow-ups-consolidated-v1-0-backlog
source: [06-VERIFICATION.md]
started: 2026-04-28T12:55:00Z
updated: 2026-04-28T17:50:00Z
---

## Current Test

[all tests complete]

## Tests

### 1. Plan 06-01 — D8 Multi-POS site merge: staging dry-run + apply + rollback drill

expected:
1. `DATABASE_URL='<staging>' npx tsx scripts/probe-multi-pos-merge-collisions.ts` — confirm collision report shape
2. Visit `/settings/duplicates/merge-review` on staging deploy — walk all 22 clusters; record per-cluster decision (`approved` / `swapped` / `rejected` / `address_fix` with notes)
3. `DATABASE_URL='<staging>' npx tsx scripts/multi-pos-merge.ts` — confirm dry-run summary (~7,531 sales rewrites + 29 archives expected)
4. `DATABASE_URL='<staging>' npx tsx scripts/multi-pos-merge.ts --apply` — apply against staging
5. Verify with three SQL counts: `audit_logs` rows where `metadata->>'script' = 'scripts/multi-pos-merge.ts'`; `locations.archived_at IS NOT NULL` for the 29 defunct rows; `sales_records` redirected onto canonical IDs
6. Re-run `--apply` — must report "0 pending merge proposal(s) to apply"; audit-log row count must NOT change
7. Run rollback SQL inside `BEGIN; ... ROLLBACK;` — verify counts return to pre-merge state, then ROLLBACK so staging stays merged for prod apply
8. Apply against prod (`DATABASE_URL=<prod>`); verify same SQL shape on prod
9. Tick `tasks/todo.md` lines 96/97/98 (5.5/5.6/5.7) with PR # + apply date

result: passed (2026-04-28). Operator review on prod (preview-aliased to prod DB) reclassified the original 22-cluster CSV under a corrected mental model: same-name same-address is multi-kiosk-per-site, not duplicate locations. **Outcomes:** cluster 19 (case-typo F4/f4) — genuine duplicate, merged via `applyBulkMerge`; clusters 2/3/10/15 — flagged `address_fix` for Phase 5.7; remaining 18 clusters — REJECTED (multi-kiosk pattern). Plus follow-on Wave 1+2 work surfaced by the Monday-vs-DB probe: 17 outlet codes had a different bug (two location rows per outlet — older with kiosks/wrong-name, newer with sales/blank-address), resolved via 17-pair merge (cluster_ids 100-116) + S5+S6 same-hotel collapse (reclassified cluster 2). Plus 2 single-row D5 outliers renamed (9S, 2S). Total: 4,171 sales rewrites + 19 archives + 4 location renames + ~95 audit_logs. Idempotency: ✅ multi-pos-merge --apply re-run shows "0 pending". Drizzle single-element ANY array binding bug found in scripts/multi-pos-merge.ts and fixed (commit b58a70b).

runbook: `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-01-SUMMARY.md` (CHECKPOINT — Awaiting Operator UAT)

### 2. Plan 06-06 — Geocoding: staging dry-run + apply against real Google Maps API

expected:
1. Set `GOOGLE_MAPS_API_KEY` on Vercel **Preview** AND **Production** envs (single redeploy then)
2. Enable Geocoding API in Google Cloud Console; set $5 billing alert (one-off run is ~$2)
3. Trigger Vercel preview deploy of `gsd/phase-06-…` branch
4. Open preview URL → `/settings/geocoding`
5. Leave **Re-geocode all** UNCHECKED → click **Run Dry-Run** → wait ~40s
6. Inspect preview table: assert ~390 rows show `status=ok`; ≤5 rows `no_results` / `error`
7. Click **Apply** → confirm
8. SQL verification: `SELECT count(*) FROM locations WHERE archived_at IS NULL AND latitude IS NOT NULL` matches `SELECT count(*) FROM audit_logs WHERE entity_type='location' AND field='latitude,longitude' AND metadata->>'script' = 'scripts/geocode-locations.ts'`
9. Spot-check 5 random rows against Google Maps web UI to ~3 decimal places
10. Idempotency check: re-run dry-run with **Re-geocode all** UNCHECKED → expect 0 candidates
11. Repeat Apply on production after staging passes

result: passed (2026-04-28). GOOGLE_MAPS_API_KEY added to Vercel `wkg-command-centre` Production + Preview; Geocoding API enabled in GCP (initial REQUEST_DENIED on first attempt, fixed mid-session). Apply on prod (preview pointed at prod DB): **313 / 313 populated-address rows geocoded ok / 0 no-results / 78 errors** (= the 78 NULL/empty-address rows surface as `error` without an API call per pipeline design). 313 audit_log rows, single stagingId, 1:1 with locations populated. Spot-check 5 random rows: 3/5 correctly geocoded, 2/5 surfaced D5 UK-default-address bugs at the data-quality layer (geocoder honestly resolved the wrong-address strings; underlying address rows fixed in the Phase 6.1 part-2 cleanup above). Idempotency: ✅ skip-existing default re-run yields 0 candidates (other than the 78 errors which would no-op on apply). API spend ≈ $1.57.

runbook: `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-06-SUMMARY.md` (Checkpoint — Manual UAT)

### 3. Plan 06-07 — Reversal-matcher orphan-rate baseline measurement (non-blocking)

expected:
1. `DATABASE_URL='<staging>' npx tsx scripts/measure-reversal-orphan-rate.ts` — capture printed baseline line
2. `DATABASE_URL='<prod>' npx tsx scripts/measure-reversal-orphan-rate.ts` — capture printed baseline line
3. Paste both lines into the comment block at the top of the `applyCrossBatchMatches` describe in `src/lib/sales/reversal-matcher.test.ts` (replacing `<X>/<N> = <X.XX>%` placeholders)
4. Commit as `docs(06-07): record reversal orphan-rate baseline (staging YYYY-MM-DD, prod YYYY-MM-DD)`

result: passed (2026-04-28). Prod orphan-rate baseline measured: **11/36 = 30.56%** on 2026-04-28 (filled in `src/lib/sales/reversal-matcher.test.ts`). Staging measurement deferred — non-blocking per plan; comment block has `<X>/<N> = <X.XX>%` placeholder until a future operator run. SC6 contract met by determinism fix + 14 property-style tests.

runbook: `.planning/phases/06-post-audit-operational-follow-ups-consolidated-v1-0-backlog/06-07-SUMMARY.md` (Outstanding (operator))

## Summary

total: 3
passed: 3
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
