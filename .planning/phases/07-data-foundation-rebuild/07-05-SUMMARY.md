---
plan: 07-05
phase: 07-data-foundation-rebuild
status: complete
completed_at: 2026-05-08T05:43:00Z
---

# Plan 07-05 Summary — UAT loop + prod cutover

Plan 07-05 = the destructive UAT→prod cutover loop for the Phase 7 data
foundation rebuild. Three tasks across two cutover gates.

## What shipped

**Task 1** — `scripts/verify-data-reset.ts` (commit `970bdb5`): read-only,
11-invariant suite that compares a database against the Phase 7 goldens
(95103 sales / £1,783,083.58 / sentinel correctness / customer_code coverage /
no orphans / assigned_at coverage / audit-log evidence).

**Task 2** — `07-UAT-RUNBOOK.md` (commit `e34fc7c`): operator-facing
step-by-step for the UAT→prod loop, with hard "no-go" conditions and the
go/no-go decision template at Step 5.

**Task 3** — UAT validation + operator gate + prod cutover, executed
2026-05-08:

1. Playwright specs validated post-07-06 schema migration (no
   `outlet_code` or `__LOCATION_NEEDED__` references in any spec).
2. UAT verify-data-reset: 8 PASS / 2 FAIL / 1 WARN — the 2 FAILs were
   `locations.active` count drift (509 vs golden 373) and `kiosks.active`
   count drift (392 vs golden 442 = 50-kiosk gap), both operator-accepted
   per `.continue-here` decision "accept Monday-current as the new
   baseline". Sales corpus byte-perfect (95103 / £1,783,083.58).
3. Vercel preview provisioned at the Vercel-truncated git-branch alias
   `wkg-command-centre-git-gsd-p-aec3bc-vedant-kalbag-wkgs-projects.vercel.app`
   (Vercel auto-truncates branch names exceeding the DNS label limit; the
   truncated alias is stable across redeploys for the same branch).
   Two preview env-var bugs were fixed during provisioning: the existing
   `BETTER_AUTH_URL` had a trailing `\n` AND pointed at the un-truncated
   full-branch URL Vercel never created, combining to surface as the
   13h-old preview's HTTP 500.
4. Live Playwright against the preview alias: 4 PASS / 2 FAIL / 2 SKIP.
   Failures are stale-fixture data drift (post-07-06 the importer's
   SAVEPOINT model means same-name dupes never enter the DB; spec was
   written assuming 2+ same-name rows for a merge demo). Not regressions.
5. 4 same-name + customer_code conflicts surfaced on UAT (Clayton Hotel
   Manchester Airport + 3 Australia DCM duplicates). Operator decision:
   resolve via `/settings/duplicates` post-cutover on prod (same
   conflict-recovery path runs in prod, surfaces same flags).
6. Operator authorised `go` after the synthesised report.
7. Migrations 0039 + 0040 applied to prod via `drizzle-kit migrate`
   (idempotent IF NOT EXISTS migrations; verified `locations.outlet_code`
   dropped on prod, `customer_code` + `monday_item_id` + `normalised_name`
   present).
8. `scripts/v2-wipe-and-reseed.ts --apply` ran against prod: Phase 1
   structural reseed COMMITTED (1856 location_products, 2 fee fallbacks),
   Phase 2 sales ETL COMMITTED (95103 rows from `GB_WKG_NetSuite_Jan2026.csv`),
   Phase 3 backfill-kiosk-install-dates --apply COMMITTED (254 assignments
   updated, 0 residual). Total runtime ~18 min.
9. Prod verify-data-reset: 8 PASS / 2 FAIL / 1 WARN — sales corpus
   byte-perfect (95103 / £1,783,083.58); 510 active locations / 400
   active kiosks (vs UAT 509 / 392); customer_code coverage 372 (vs UAT
   364 — 8 more on prod, narrowing the operator-data gap from 50 to 42
   kiosks). Reports committed as `07-VERIFY-REPORT-prod.{json,md}`.

## Final prod state

- `locations`: 510 active (372 with customer_code, 137 placeholders, 1 sentinel)
- `kiosks`: 400 active
- `kiosk_assignments`: all assigned_at backfilled (live_date primary, min_sales fallback)
- `sales_records`: 95103 rows / £1,783,083.58 gross (Jan 2026 corpus)
- `LOCATION_NEEDED` sentinel: 1 row, region=GLOBAL (new keying), 0 orphans
- 4 same-name + customer_code conflicts flagged via `[Phase 07-06]` notes for operator merge

## Decisions reached

See `07-06-SUMMARY.md` for the customer_code/Path-B refactor decisions; this
plan only added the runbook reliability fixes (canonical fee fallbacks,
Phase 1→Phase 2 connection swap) and the Heathrow + RTL imports.

## Known follow-ups

1. **4 same-name + customer_code merge UI resolution on prod** — Clayton
   Hotel Manchester Airport (UK, monday=1900537101), Holiday Inn Express
   Sydney Airport (AU, monday=2775714689), Holiday Inn Express Sydney
   Macquarie Park (AU, monday=2775714891), Melbourne Marriott Hotel
   Docklands (AU, monday=2866170551). Operator drives via
   `/settings/duplicates` on https://wkg-command-centre.vercel.app/.
2. **42-kiosk Monday operator-data gap** — hotels claim more SSMs (per
   "Number of SSMs" column) than have Assets-board entries. Pure
   operator data hygiene; no code fix possible. Detail in `/tmp/ssm-gap.log`
   from earlier session.
3. **Playwright `merge.spec.ts` stale fixtures** — post-07-06 the
   importer's SAVEPOINT model means same-name dupes never enter the DB,
   so the "Residence Inn cluster" assumption no longer holds. Spec
   should be rewritten to use `[Phase 07-06]` flagged rows OR moved
   behind `PLAYWRIGHT_DESTRUCTIVE` gating (operator imports a dupe,
   merges, asserts). Tracked for v1.1 / Phase 11 polish.
4. **`BETTER_AUTH_URL` trailing-`\n` on prod env** — also exists on
   prod's encrypted env var (not just the preview's). Prod auth currently
   works, so leaving it alone for now; revisit if prod auth misbehaves.
5. **UAT Neon branch teardown** (`phase-07-uat`, project
   `snowy-brook-77762738`) — runbook Step 7 deferred to a follow-up
   commit; the branch is no longer load-bearing now that prod is reseeded.

## Pre-flight tooling discovered during this plan

- `vercel env pull --environment=production` — pulls prod env to a tmp
  file; useful for one-shot scripts like the wipe-and-reseed runbook
  that aren't deployed on Vercel itself. **Always delete the tmp file
  immediately after use.**
- `(set -a; source .env.vercel-prod-tmp; source .env.test; set +a; …)`
  pattern — sources prod env first (sets DATABASE_URL), then `.env.test`
  (its MONDAY_API_TOKEN wins over prod's empty placeholder). Order
  matters: sourcing `.env.test` first then prod overwrites
  MONDAY_API_TOKEN to empty.

## Evidence

- `07-VERIFY-REPORT-uat.json` + `.md` (commit `14c6673`)
- `07-VERIFY-REPORT-prod.json` + `.md` (this commit)
- Prod audit_logs: 2 reseed entries from `system` actor (this session +
  the 2026-05-06 UAT reseed mirroring run)
